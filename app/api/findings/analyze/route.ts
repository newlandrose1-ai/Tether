import { NextRequest, NextResponse } from 'next/server';
import {
  GAP_ANALYSIS_PROMPT_VERSION,
  GAP_ANALYSIS_SYSTEM_INSTRUCTION,
  buildGapAnalysisPrompt,
  validateGapAnalysisSchemaWithReason,
} from '@/src/ai/prompts/gapAnalysis';
import { GAP_ANALYSIS_RESPONSE_SCHEMA } from '@/src/ai/schemas/geminiSchemas.server';
import { getForbiddenRegistryPackageSet } from '@/src/lib/findingsEngine';
import { executeStructuredGeminiCall } from '@/src/lib/geminiClient';
import {
  MAX_GEMINI_PAYLOAD_CHARS,
  MAX_GEMINI_WRAPPED_PROMPT_CHARS,
  formatUntrustedFileBlock,
  stripUnsafeControlAndBidiChars,
} from '@/src/lib/securityGuards';

function sanitizeServerFindingsInputs(rawSummary: Record<string, unknown>): {
  structuredSummary: Record<string, unknown>;
  sanitizedFileBlocks: string[];
  cacheKey: string;
  oversized: boolean;
} {
  const serializedInput = JSON.stringify(rawSummary);
  if (serializedInput.length > MAX_GEMINI_PAYLOAD_CHARS + 512) {
    return {
      structuredSummary: {},
      sanitizedFileBlocks: [],
      cacheKey: '',
      oversized: true,
    };
  }

  const fileBlocksRaw = Array.isArray(rawSummary.fileBlocks) ? rawSummary.fileBlocks : [];
  const sanitizedFileBlocks: string[] = [];

  for (const entry of fileBlocksRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.path !== 'string' || typeof obj.block !== 'string') continue;
    const cleanPath = stripUnsafeControlAndBidiChars(obj.path, false);
    const inner = obj.block
      .replace(/^<file\b[^>]*>\n?/i, '')
      .replace(/\n?<\/file>\s*$/i, '');
    sanitizedFileBlocks.push(formatUntrustedFileBlock(cleanPath, inner));
  }

  const structuredSummary = {
    archiveName:
      typeof rawSummary.archiveName === 'string'
        ? stripUnsafeControlAndBidiChars(rawSummary.archiveName, false)
        : 'archive.zip',
    lockedProfile:
      rawSummary.lockedProfile && typeof rawSummary.lockedProfile === 'object'
        ? rawSummary.lockedProfile
        : {},
    activeModifiers: Array.isArray(rawSummary.activeModifiers) ? rawSummary.activeModifiers : [],
    languages: Array.isArray(rawSummary.languages) ? rawSummary.languages.slice(0, 6) : [],
    frameworks: Array.isArray(rawSummary.frameworks) ? rawSummary.frameworks.slice(0, 12) : [],
    bundlers: Array.isArray(rawSummary.bundlers) ? rawSummary.bundlers.slice(0, 8) : [],
    dependencies: Array.isArray(rawSummary.dependencies) ? rawSummary.dependencies.slice(0, 40) : [],
    entryPoints: Array.isArray(rawSummary.entryPoints) ? rawSummary.entryPoints.slice(0, 15) : [],
    alreadyDetectedFindings: Array.isArray(rawSummary.alreadyDetectedFindings)
      ? rawSummary.alreadyDetectedFindings
      : [],
  };

  const samplePrompt = buildGapAnalysisPrompt(structuredSummary, sanitizedFileBlocks);
  if (samplePrompt.length > MAX_GEMINI_WRAPPED_PROMPT_CHARS) {
    return {
      structuredSummary: {},
      sanitizedFileBlocks: [],
      cacheKey: '',
      oversized: true,
    };
  }

  const cacheKey =
    typeof rawSummary.contentHashKey === 'string' && rawSummary.contentHashKey.trim()
      ? rawSummary.contentHashKey.trim()
      : `${structuredSummary.archiveName}:${samplePrompt.length}`;

  return {
    structuredSummary,
    sanitizedFileBlocks,
    cacheKey,
    oversized: false,
  };
}

export async function POST(req: NextRequest) {
  let body: {
    projectSummary?: unknown;
    jobId?: unknown;
    aiEnabled?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  if (!body.projectSummary || typeof body.projectSummary !== 'object') {
    return NextResponse.json(
      { error: 'Sanitized projectSummary object is required.' },
      { status: 400 }
    );
  }

  const jobId =
    typeof body.jobId === 'string' && body.jobId.trim() ? body.jobId.trim() : 'default-job';
  const aiEnabled = body.aiEnabled !== false;

  const { structuredSummary, sanitizedFileBlocks, cacheKey, oversized } =
    sanitizeServerFindingsInputs(body.projectSummary as Record<string, unknown>);

  if (oversized) {
    return NextResponse.json(
      {
        error: `Gemini payload exceeds the ${MAX_GEMINI_PAYLOAD_CHARS.toLocaleString()} character safety limit.`,
      },
      { status: 413 }
    );
  }

  const forbiddenPackages = getForbiddenRegistryPackageSet();
  const outcome = await executeStructuredGeminiCall({
    callType: 'gap-analysis',
    promptVersion: GAP_ANALYSIS_PROMPT_VERSION,
    cacheKey,
    jobId,
    aiEnabled,
    responseSchema: GAP_ANALYSIS_RESPONSE_SCHEMA,
    systemInstruction: GAP_ANALYSIS_SYSTEM_INSTRUCTION,
    buildPrompt: (retryErr) =>
      buildGapAnalysisPrompt(structuredSummary, sanitizedFileBlocks, retryErr),
    validate: (parsed) => validateGapAnalysisSchemaWithReason(parsed, forbiddenPackages),
  });

  if (!outcome.ok) {
    return NextResponse.json({
      suggestions: [],
      skipped: true,
      status: outcome.status,
      skipReason: outcome.skipReason,
      errorCode: outcome.errorCode,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      cacheHit: outcome.cacheHit,
      attempts: outcome.attempts,
      budget: outcome.budget,
    });
  }

  return NextResponse.json({
    suggestions: outcome.data.suggestions,
    skipped: false,
    status: outcome.status,
    model: outcome.model,
    promptVersion: outcome.promptVersion,
    cacheHit: outcome.cacheHit,
    attempts: outcome.attempts,
    budget: outcome.budget,
  });
}
