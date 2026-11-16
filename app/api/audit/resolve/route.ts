import { ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  GEMINI_AUDIT_MODEL,
  createServerGeminiClient,
  formatGeminiErrorMessage,
  withGeminiRetry,
} from '@/src/lib/geminiServer';
import type { AuditFinding, AuditKnowledgeGap, AutofixWebSource } from '@/src/types/model';

interface ResolveAuditRequest {
  filePath: string;
  language: string;
  content: string;
  findings: AuditFinding[];
  knowledgeGaps: AuditKnowledgeGap[];
  projectPaths?: string[];
}

function extractTagContent(text: string, startTag: string, endTag: string): string | null {
  const startIdx = text.indexOf(startTag);
  if (startIdx === -1) return null;
  const bodyStart = startIdx + startTag.length;
  const endIdx = text.indexOf(endTag, bodyStart);
  if (endIdx === -1) return null;
  return text.slice(bodyStart, endIdx).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

export async function POST(req: NextRequest) {
  const ai = createServerGeminiClient();
  if (!ai) {
    return NextResponse.json(
      {
        available: false,
        reason:
          'Server GEMINI_API_KEY is not configured; Gemini AI autofix & web grounding is unavailable.',
      },
      { status: 200 }
    );
  }

  try {
    const body = (await req.json()) as ResolveAuditRequest;
    const {
      filePath,
      language,
      content,
      findings = [],
      knowledgeGaps = [],
      projectPaths = [],
    } = body;

    if (!filePath || typeof content !== 'string') {
      return NextResponse.json(
        { available: false, reason: 'Missing filePath or content payload.' },
        { status: 400 }
      );
    }

    const gapSummary =
      knowledgeGaps.length > 0
        ? knowledgeGaps
            .map((g) => `- ${g.frameworkOrTopic}: ${g.reason} (Search focus: ${g.suggestedQuery})`)
            .join('\n')
        : '';

    const findingsSummary =
      findings.length > 0
        ? findings
            .map(
              (f) =>
                `- [${f.severity}] L${f.line ?? 1}:${f.column ?? 1} (${f.ruleId ?? 'check'}): ${f.message}${f.suggestion ? ` [Suggestion: ${f.suggestion}]` : ''}`
            )
            .join('\n')
        : '- General syntax, import, type, and functional testability review';

    const siblingList =
      projectPaths.length > 0
        ? projectPaths.slice(0, 60).join('\n')
        : '(single file context)';

    const prompt = [
      `Target file: ${filePath} (language: ${language})`,
      '',
      'Detected issues to repair:',
      findingsSummary,
      ...(gapSummary
        ? ['', 'Recognized knowledge gaps (verify via Google Search before editing):', gapSummary]
        : []),
      '',
      'Sibling files in live project:',
      siblingList,
      '',
      'Current file content:',
      '```',
      content,
      '```',
      '',
      'Instructions:',
      knowledgeGaps.length > 0
        ? '1. Use Google Search to verify authoritative syntax, dependency, or API rules for this language/format.'
        : '1. Diagnose each error carefully (syntax, types, undefined references, broken imports, logic, or runtime issues).',
      '2. Apply the SMALLEST possible intent-preserving fix that makes the file compile, pass checks, and execute cleanly.',
      '3. Do NOT delete or rewrite unrelated user functions or bulk-replace user code.',
      '4. Respond using ONLY these exact sections:',
      '<<<KNOWLEDGE_SUMMARY>>>',
      'Brief note on the rule or root cause verified.',
      '<<<END_KNOWLEDGE_SUMMARY>>>',
      '<<<PATCH_EXPLANATION>>>',
      'Concise description of the exact minimal edits made.',
      '<<<END_PATCH_EXPLANATION>>>',
      '<<<FIXED_CODE>>>',
      '<full corrected file content without markdown code fences>',
      '<<<END_FIXED_CODE>>>',
    ].join('\n');

    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: GEMINI_AUDIT_MODEL,
        contents: prompt,
        config: {
          systemInstruction:
            'You are an authoritative code-repair engineer. Preserve original user intent and formatting while applying the smallest fix needed so code compiles, type-checks, and executes cleanly. Never wrap FIXED_CODE in markdown fences.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          tools: [{ googleSearch: {} }],
        },
      })
    );

    const rawText = response.text || '';
    const knowledgeSummary =
      extractTagContent(rawText, '<<<KNOWLEDGE_SUMMARY>>>', '<<<END_KNOWLEDGE_SUMMARY>>>') || '';
    const explanation =
      extractTagContent(rawText, '<<<PATCH_EXPLANATION>>>', '<<<END_PATCH_EXPLANATION>>>') ||
      'Applied Gemini-verified minimal code repair.';
    let patchedContent = extractTagContent(
      rawText,
      '<<<FIXED_CODE>>>',
      '<<<END_FIXED_CODE>>>'
    );

    if (patchedContent) {
      patchedContent = patchedContent
        .replace(/^```[A-Za-z0-9_-]*\r?\n/, '')
        .replace(/\r?\n```$/, '');
    }

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources: AutofixWebSource[] = [];
    const seenUris = new Set<string>();
    for (const chunk of chunks) {
      const web = (chunk as { web?: { uri?: string; title?: string } })?.web;
      if (web?.uri && !seenUris.has(web.uri)) {
        seenUris.add(web.uri);
        sources.push({
          title: web.title || web.uri,
          uri: web.uri,
        });
      }
    }

    if (!patchedContent || patchedContent.trim().length === 0) {
      return NextResponse.json({
        available: true,
        changed: false,
        knowledgeSummary,
        explanation:
          explanation || 'Gemini analysis completed, but no safe automated patch could be produced.',
        sources,
      });
    }

    return NextResponse.json({
      available: true,
      changed: patchedContent !== content,
      patchedContent,
      knowledgeSummary,
      explanation,
      sources,
    });
  } catch (err) {
    return NextResponse.json(
      {
        available: false,
        reason: formatGeminiErrorMessage(err),
      },
      { status: 500 }
    );
  }
}
