import {
  javascriptLanguage,
  jsxLanguage,
  typescriptLanguage,
  tsxLanguage,
} from '@codemirror/lang-javascript';
import { jsonLanguage } from '@codemirror/lang-json';
import { htmlLanguage } from '@codemirror/lang-html';
import { cssLanguage } from '@codemirror/lang-css';
import type { AuditFinding } from '../types/model';
import { computeContentHash, containsSensitiveContent } from './hash';
import { createId } from './id';

export interface CodeAuditResult {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  findings: AuditFinding[];
  contentHash: string;
}

function getLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLineCol(
  offset: number,
  lineStarts: number[]
): { line: number; column: number } {
  const clamped = Math.max(0, offset);
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= clamped) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: clamped - lineStarts[lineIndex] + 1,
  };
}

function resolveLanguage(language?: string, path?: string): string {
  const ext = path?.split('.').pop()?.toLowerCase();
  if (ext === 'tsx') return 'tsx';
  if (ext === 'jsx') return 'jsx';
  if (ext === 'ts') return 'typescript';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'json') return 'json';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return 'markdown';
  return (language || 'javascript').toLowerCase();
}

function getParserForLanguage(lang: string) {
  switch (lang) {
    case 'tsx':
      return tsxLanguage.parser;
    case 'typescript':
    case 'ts':
      return typescriptLanguage.parser;
    case 'jsx':
      return jsxLanguage.parser;
    case 'javascript':
    case 'js':
      return javascriptLanguage.parser;
    case 'json':
      return jsonLanguage.parser;
    case 'html':
      return htmlLanguage.parser;
    case 'css':
      return cssLanguage.parser;
    default:
      return null;
  }
}

/**
 * Runs deterministic static syntax, structural, and secret checks on a block's content.
 */
export function runCodeAudit(params: {
  content: string;
  language?: string;
  path?: string;
}): CodeAuditResult {
  const { content, path } = params;
  const lang = resolveLanguage(params.language, path);
  const contentHash = computeContentHash(content);
  const findings: AuditFinding[] = [];
  const lineStarts = getLineStarts(content);
  const lines = content.split('\n');

  // 1. Line-by-line security, conflict-marker, and suspicious-construct checks
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineNumber = i + 1;
    const lineFrom = lineStarts[i];
    const lineTo = lineFrom + lineText.length;

    if (/^(<{7}|={7}|>{7})/.test(lineText.trim())) {
      findings.push({
        id: createId(),
        severity: 'error',
        ruleId: 'merge-conflict',
        message: 'Unresolved merge conflict marker detected.',
        file: path,
        line: lineNumber,
        column: 1,
        endLine: lineNumber,
        endColumn: lineText.length + 1,
        from: lineFrom,
        to: lineTo,
      });
    }

    if (containsSensitiveContent(lineText)) {
      findings.push({
        id: createId(),
        severity: 'error',
        ruleId: 'secret-exposure',
        message: 'Potential private key or raw API token detected in code.',
        file: path,
        line: lineNumber,
        column: 1,
        endLine: lineNumber,
        endColumn: lineText.length + 1,
        from: lineFrom,
        to: lineTo,
      });
    }

    if (lang !== 'markdown' && lang !== 'text' && lang !== 'json') {
      const evalMatch = /\beval\s*\(/.exec(lineText);
      if (evalMatch && !lineText.trim().startsWith('//') && !lineText.trim().startsWith('*')) {
        const from = lineFrom + evalMatch.index;
        findings.push({
          id: createId(),
          severity: 'warning',
          ruleId: 'no-eval',
          message: 'Avoid using eval(); it introduces runtime security and scoping risks.',
          file: path,
          line: lineNumber,
          column: evalMatch.index + 1,
          endLine: lineNumber,
          endColumn: evalMatch.index + evalMatch[0].length + 1,
          from,
          to: from + evalMatch[0].length,
        });
      }

      const dbgMatch = /\bdebugger\b/.exec(lineText);
      if (dbgMatch && !lineText.trim().startsWith('//') && !lineText.trim().startsWith('*')) {
        const from = lineFrom + dbgMatch.index;
        findings.push({
          id: createId(),
          severity: 'warning',
          ruleId: 'no-debugger',
          message: 'Remove leftover debugger statement before promoting.',
          file: path,
          line: lineNumber,
          column: dbgMatch.index + 1,
          endLine: lineNumber,
          endColumn: dbgMatch.index + dbgMatch[0].length + 1,
          from,
          to: from + dbgMatch[0].length,
        });
      }
    }
  }

  // 2. Strict JSON parse validation
  if (lang === 'json' && content.trim().length > 0) {
    try {
      JSON.parse(content);
    } catch (err) {
      const msg = (err as Error).message || 'Invalid JSON syntax';
      const posMatch = /position\s+(\d+)/i.exec(msg);
      const offset = posMatch ? Math.min(Number(posMatch[1]), content.length) : 0;
      const loc = offsetToLineCol(offset, lineStarts);
      findings.push({
        id: createId(),
        severity: 'error',
        ruleId: 'json-parse-error',
        message: msg,
        file: path,
        line: loc.line,
        column: loc.column,
        endLine: loc.line,
        endColumn: loc.column + 1,
        from: offset,
        to: Math.min(content.length, Math.max(offset + 1, offset)),
      });
    }
  }

  // 3. Real Lezer incremental syntax tree check (JS, JSX, TS, TSX, HTML, CSS, JSON)
  const parser = getParserForLanguage(lang);
  if (parser && content.trim().length > 0) {
    const tree = parser.parse(content);
    const cursor = tree.cursor();
    const seenErrorLines = new Set<number>();

    do {
      if (cursor.type.isError) {
        const from = cursor.from;
        const to = Math.max(cursor.to, Math.min(content.length, from + 1));
        const startLoc = offsetToLineCol(from, lineStarts);
        const endLoc = offsetToLineCol(to, lineStarts);

        // Avoid reporting duplicate Lezer recovery errors on the same line
        if (seenErrorLines.has(startLoc.line)) continue;
        // Skip if JSON.parse already reported this exact line
        if (
          lang === 'json' &&
          findings.some((f) => f.ruleId === 'json-parse-error' && f.line === startLoc.line)
        ) {
          continue;
        }

        seenErrorLines.add(startLoc.line);

        const rawLine = lines[startLoc.line - 1] ?? '';
        const tokenSnippet = content.slice(from, Math.min(content.length, from + 18)).trim();
        const contextDesc = tokenSnippet
          ? `Unexpected syntax near "${tokenSnippet}"`
          : rawLine.trim()
          ? `Syntax error on line ${startLoc.line}: "${rawLine.trim().slice(0, 40)}"`
          : `Incomplete or invalid syntax at line ${startLoc.line}`;

        findings.push({
          id: createId(),
          severity: 'error',
          ruleId: 'syntax-error',
          message: contextDesc,
          file: path,
          line: startLoc.line,
          column: startLoc.column,
          endLine: endLoc.line,
          endColumn: endLoc.column,
          from,
          to,
        });
      }
    } while (cursor.next());
  }

  // Sort findings by line then column
  findings.sort((a, b) => {
    const lineDiff = (a.line ?? 0) - (b.line ?? 0);
    if (lineDiff !== 0) return lineDiff;
    return (a.column ?? 0) - (b.column ?? 0);
  });

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  return {
    passed: errorCount === 0,
    errorCount,
    warningCount,
    findings,
    contentHash,
  };
}
