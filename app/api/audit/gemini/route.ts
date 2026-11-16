import { ThinkingLevel, Type } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  GEMINI_AUDIT_MODEL,
  createServerGeminiClient,
  formatGeminiErrorMessage,
  getConfiguredGeminiApiKey,
  withGeminiRetry,
} from '@/src/lib/geminiServer';
import type { AuditFinding } from '@/src/types/model';
import { createId } from '@/src/lib/id';

interface GeminiAuditFileInput {
  blockId?: string;
  filePath: string;
  language: string;
  content: string;
}

interface GeminiAuditRequest {
  files: GeminiAuditFileInput[];
  projectPaths?: string[];
}

export async function GET() {
  const connected = Boolean(getConfiguredGeminiApiKey());
  return NextResponse.json({
    connected,
    model: GEMINI_AUDIT_MODEL,
  });
}

export async function POST(req: NextRequest) {
  const ai = createServerGeminiClient();
  if (!ai) {
    return NextResponse.json(
      {
        available: false,
        connected: false,
        findings: [],
        reason:
          'Gemini API is not connected on the server. Set GEMINI_API_KEY in Settings > Secrets to enable AI deep auditing.',
      },
      { status: 200 }
    );
  }

  try {
    const body = (await req.json()) as GeminiAuditRequest;
    const files = Array.isArray(body?.files) ? body.files.slice(0, 8) : [];
    const projectPaths = Array.isArray(body?.projectPaths) ? body.projectPaths : [];

    if (files.length === 0) {
      return NextResponse.json(
        { available: true, connected: true, findings: [], summary: 'No files provided.' },
        { status: 200 }
      );
    }

    const fileBundle = files
      .map(
        (f, idx) =>
          `=== FILE ${idx + 1}: ${f.filePath} (lang: ${f.language}, blockId: ${f.blockId || 'n/a'}) ===\n${f.content.slice(0, 12000)}`
      )
      .join('\n\n');

    const prompt = [
      'Audit the following live project file(s) for defects that prevent compilation, testing, or functional correctness.',
      'Check specifically for:',
      '- Syntax errors',
      '- Logical and edge-case bugs (wrong operators, off-by-one, inverted conditions, unreachable code)',
      '- Missing dependencies or broken cross-file imports',
      '- Type mismatches and undefined variables/functions/properties',
      '- Structural or runtime issues that block testing or execution',
      '',
      'Do NOT invent stylistic preferences or nitpicks. Only report real functional, syntax, type, import, or testability issues.',
      projectPaths.length > 0
        ? `Live project file paths:\n${projectPaths.slice(0, 80).join('\n')}`
        : '',
      '',
      fileBundle,
    ]
      .filter(Boolean)
      .join('\n');

    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: GEMINI_AUDIT_MODEL,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a strict static and semantic code auditor. Return accurate line numbers (1-indexed), exact categories, and concrete minimal fix suggestions. Only flag genuine errors or functional risks.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: 'Concise overall assessment of testability and functional soundness.',
              },
              testable: {
                type: Type.BOOLEAN,
                description: 'True only if all audited files can compile/parse and run safely without errors.',
              },
              findings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    filePath: { type: Type.STRING },
                    severity: {
                      type: Type.STRING,
                      enum: ['error', 'warning'],
                    },
                    category: {
                      type: Type.STRING,
                      enum: [
                        'syntax',
                        'logic',
                        'types',
                        'imports',
                        'structure',
                        'security',
                        'runtime',
                      ],
                    },
                    line: { type: Type.INTEGER },
                    column: { type: Type.INTEGER },
                    message: { type: Type.STRING },
                    suggestion: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      })
    );

    const parsed = JSON.parse((response.text || '{}').trim()) as {
      summary?: string;
      testable?: boolean;
      findings?: Array<{
        filePath?: string;
        severity?: 'error' | 'warning';
        category?: AuditFinding['category'];
        line?: number;
        column?: number;
        message?: string;
        suggestion?: string;
      }>;
    };

    const fileByPath = new Map(files.map((f) => [f.filePath, f]));
    const normalizedFindings: AuditFinding[] = (parsed.findings || [])
      .filter((item) => item && typeof item.message === 'string' && item.message.trim().length > 0)
      .map((item) => {
        const matchedFile =
          (item.filePath && fileByPath.get(item.filePath)) ||
          files.find((f) => item.filePath && f.filePath.endsWith(item.filePath)) ||
          files[0];

        return {
          id: createId(),
          severity: item.severity === 'warning' ? 'warning' : 'error',
          category: item.category || 'logic',
          ruleId: 'gemini-semantic-audit',
          message: item.message!.trim(),
          file: matchedFile?.filePath || item.filePath,
          blockId: matchedFile?.blockId,
          fixable: true,
          suggestion: item.suggestion,
          line: typeof item.line === 'number' && item.line > 0 ? item.line : 1,
          column: typeof item.column === 'number' && item.column > 0 ? item.column : 1,
        };
      });

    return NextResponse.json({
      available: true,
      connected: true,
      model: GEMINI_AUDIT_MODEL,
      testable:
        Boolean(parsed.testable) &&
        normalizedFindings.every((f) => f.severity !== 'error'),
      summary:
        parsed.summary ||
        (normalizedFindings.length === 0
          ? 'Gemini deep audit found zero semantic or testability defects.'
          : `Gemini deep audit flagged ${normalizedFindings.length} finding(s).`),
      findings: normalizedFindings,
    });
  } catch (err) {
    return NextResponse.json(
      {
        available: false,
        connected: true,
        findings: [],
        reason: formatGeminiErrorMessage(err),
      },
      { status: 500 }
    );
  }
}
