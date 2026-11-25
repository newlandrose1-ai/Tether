import { NextRequest, NextResponse } from 'next/server';
import {
  INTENT_PROMPT_VERSION,
  INTENT_SYSTEM_INSTRUCTION,
  buildIntentPrompt,
  validateIntentSchemaWithReason,
} from '@/src/ai/prompts/intentClassification';
import { INTENT_RESPONSE_SCHEMA } from '@/src/ai/schemas/geminiSchemas.server';
import { executeStructuredGeminiCall } from '@/src/lib/geminiClient';
import {
  MAX_GEMINI_PAYLOAD_CHARS,
  MAX_GEMINI_WRAPPED_PROMPT_CHARS,
  formatUntrustedFileBlock,
  stripUnsafeControlAndBidiChars,
} from '@/src/lib/securityGuards';

function sanitizeServerIntentInputs(rawSummary: Record<string, unknown>): {
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
    languages: Array.isArray(rawSummary.languages) ? rawSummary.languages.slice(0, 8) : [],
    packageManagers: Array.isArray(rawSummary.packageManagers)
      ? rawSummary.packageManagers.slice(0, 8)
      : [],
    entryPoints: Array.isArray(rawSummary.entryPoints) ? rawSummary.entryPoints.slice(0, 20) : [],
    configFiles: Array.isArray(rawSummary.configFiles) ? rawSummary.configFiles.slice(0, 20) : [],
    dependencies: Array.isArray(rawSummary.dependencies) ? rawSummary.dependencies.slice(0, 40) : [],
    frameworks: Array.isArray(rawSummary.frameworks) ? rawSummary.frameworks.slice(0, 12) : [],
    bundlers: Array.isArray(rawSummary.bundlers) ? rawSummary.bundlers.slice(0, 8) : [],
    hygiene: rawSummary.hygiene && typeof rawSummary.hygiene === 'object' ? rawSummary.hygiene : {},
    assetExtensionsPresent: Array.isArray(rawSummary.assetExtensionsPresent)
      ? rawSummary.assetExtensionsPresent
      : [],
    codePatternsMatched: Array.isArray(rawSummary.codePatternsMatched)
      ? rawSummary.codePatternsMatched
      : [],
    suggestedModifiers: Array.isArray(rawSummary.suggestedModifiers)
      ? rawSummary.suggestedModifiers
      : [],
    rankedCandidates: Array.isArray(rawSummary.rankedCandidates)
      ? rawSummary.rankedCandidates
      : [],
  };

  const samplePrompt = buildIntentPrompt(structuredSummary, sanitizedFileBlocks);
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
    evidenceSummary?: unknown;
    jobId?: unknown;
    aiEnabled?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  if (!body.evidenceSummary || typeof body.evidenceSummary !== 'object') {
    return NextResponse.json(
      { error: 'Sanitized evidenceSummary object is required.' },
      { status: 400 }
    );
  }

  const jobId =
    typeof body.jobId === 'string' && body.jobId.trim() ? body.jobId.trim() : 'default-job';
  const aiEnabled = body.aiEnabled !== false;

  const { structuredSummary, sanitizedFileBlocks, cacheKey, oversized } =
    sanitizeServerIntentInputs(body.evidenceSummary as Record<string, unknown>);

  if (oversized) {
    return NextResponse.json(
      {
        error: `Gemini payload exceeds the ${MAX_GEMINI_PAYLOAD_CHARS.toLocaleString()} character safety limit.`,
      },
      { status: 413 }
    );
  }

  const outcome = await executeStructuredGeminiCall({
    callType: 'intent-classify',
    promptVersion: INTENT_PROMPT_VERSION,
    cacheKey,
    jobId,
    aiEnabled,
    responseSchema: INTENT_RESPONSE_SCHEMA,
    systemInstruction: INTENT_SYSTEM_INSTRUCTION,
    buildPrompt: (retryErr) => buildIntentPrompt(structuredSummary, sanitizedFileBlocks, retryErr),
    validate: (parsed) => validateIntentSchemaWithReason(parsed),
  });

  if (!outcome.ok) {
    return NextResponse.json({
      advice: null,
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
    advice: {
      ...outcome.data,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
    },
    skipped: false,
    status: outcome.status,
    model: outcome.model,
    promptVersion: outcome.promptVersion,
    cacheHit: outcome.cacheHit,
    attempts: outcome.attempts,
    budget: outcome.budget,
  });
}
