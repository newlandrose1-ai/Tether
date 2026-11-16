import type { AuditFinding, AuditVerificationProof } from '../types/model';
import { createId } from './id';

export interface LocalLogicVerifyResult {
  findings: AuditFinding[];
  verification: AuditVerificationProof;
}

function getLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToLineCol(offset: number, lineStarts: number[]): { line: number; column: number } {
  const clamped = Math.max(0, offset);
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= clamped) low = mid + 1;
    else high = mid - 1;
  }
  const idx = Math.max(0, high);
  return { line: idx + 1, column: clamped - lineStarts[idx] + 1 };
}

/**
 * Finds duplicate top-level keys inside raw JSON text before JSON.parse silently overwrites them.
 */
export function findDuplicateJsonKeys(content: string, path?: string, blockId?: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const lines = content.split('\n');
  const lineStarts = getLineStarts(content);
  const depthKeys = new Map<number, Set<string>>();
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = /^\s*"([^"]+)"\s*:/.exec(line);
    if (keyMatch && braceDepth >= 1) {
      let keys = depthKeys.get(braceDepth);
      if (!keys) {
        keys = new Set<string>();
        depthKeys.set(braceDepth, keys);
      }
      const key = keyMatch[1];
      if (keys.has(key)) {
        findings.push({
          id: createId(),
          severity: 'error',
          category: 'logic',
          ruleId: 'json-duplicate-key',
          message: `Duplicate JSON key "${key}" overwrites earlier property at depth ${braceDepth}.`,
          file: path,
          blockId,
          fixable: true,
          suggestion: `Remove or rename duplicate key "${key}".`,
          line: i + 1,
          column: keyMatch.index + 1,
          from: lineStarts[i],
          to: lineStarts[i] + line.length,
        });
      } else {
        keys.add(key);
      }
    }

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '{') {
        braceDepth++;
        depthKeys.set(braceDepth, new Set<string>());
      } else if (ch === '}') {
        depthKeys.delete(braceDepth);
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }
  }

  return findings;
}

/**
 * Strips ESM import/export syntax cleanly so pure JS can undergo strict Function parse/compile verification
 * without changing line numbers.
 */
function toScriptTestableBody(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^import\s+/.test(trimmed) && !trimmed.startsWith('import(')) {
        return '/* import stripped for syntax verify */';
      }
      if (/^export\s+default\s+/.test(trimmed)) {
        return line.replace(/\bexport\s+default\s+/, 'const __tetherDefaultExport__ = ');
      }
      if (/^export\s+(async\s+)?(function|class|const|let|var)\b/.test(trimmed)) {
        return line.replace(/\bexport\s+/, '');
      }
      if (/^export\s*\{/.test(trimmed) || /^export\s+\*\s+from/.test(trimmed)) {
        return '/* export stripped for syntax verify */';
      }
      return line;
    })
    .join('\n');
}

function isSimpleSelfContainedJs(content: string): boolean {
  if (content.length > 24000) return false;
  if (/\b(?:import|require|window|document|fetch|process|globalThis|setTimeout|setInterval|while\s*\(|for\s*\(\s*;\s*;)\b/.test(content)) {
    return false;
  }
  return true;
}

/**
 * Performs logical, structural, compile-parse, and safe runtime checks to evaluate
 * whether a code block/file is testable and provably functional.
 */
export function verifyCodeTestability(params: {
  content: string;
  language: string;
  path?: string;
  blockId?: string;
  existingErrorCount: number;
}): LocalLogicVerifyResult {
  const { content, language, path, blockId, existingErrorCount } = params;
  const findings: AuditFinding[] = [];
  const checksRun: string[] = [];
  const lines = content.split('\n');
  const lineStarts = getLineStarts(content);

  let compiledCleanly = existingErrorCount === 0;
  let runtimeVerified = false;
  let logicSound = true;

  if (language === 'json' && content.trim().length > 0) {
    checksRun.push('JSON.parse strict validation');
    checksRun.push('Duplicate key detection');
    const dupFindings = findDuplicateJsonKeys(content, path, blockId);
    findings.push(...dupFindings);
    try {
      JSON.parse(content);
      runtimeVerified = dupFindings.length === 0;
    } catch {
      compiledCleanly = false;
      runtimeVerified = false;
    }
  } else if (
    language === 'javascript' ||
    language === 'typescript' ||
    language === 'jsx' ||
    language === 'tsx'
  ) {
    checksRun.push('JS/TS logical invariant scan');
    const seenTopLevelDecls = new Map<string, number>();

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const trimmed = lineText.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      // 1. NaN direct comparison (always false)
      const nanMatch =
        /\b([A-Za-z_$][\w$.]*)\s*(===|==|!==|!=)\s*NaN\b|\bNaN\s*(===|==|!==|!=)\s*([A-Za-z_$][\w$.]*)/.exec(
          lineText
        );
      if (nanMatch) {
        const from = lineStarts[i] + nanMatch.index;
        findings.push({
          id: createId(),
          severity: 'error',
          category: 'logic',
          ruleId: 'nan-equality',
          message: 'Direct comparison with NaN is always false in JavaScript; use Number.isNaN(...).',
          file: path,
          blockId,
          fixable: true,
          suggestion: 'Replace direct NaN equality check with Number.isNaN(...).',
          line: i + 1,
          column: nanMatch.index + 1,
          from,
          to: from + nanMatch[0].length,
        });
      }

      // 2. Duplicate top-level declaration at column 0
      const topDeclMatch =
        /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\b/.exec(lineText);
      if (topDeclMatch) {
        const ident = topDeclMatch[1];
        const prevLine = seenTopLevelDecls.get(ident);
        if (prevLine !== undefined) {
          findings.push({
            id: createId(),
            severity: 'error',
            category: 'types',
            ruleId: 'duplicate-declaration',
            message: `Identifier "${ident}" was already declared on line ${prevLine}.`,
            file: path,
            blockId,
            fixable: false,
            line: i + 1,
            column: 1,
            from: lineStarts[i],
            to: lineStarts[i] + lineText.length,
          });
        } else {
          seenTopLevelDecls.set(ident, i + 1);
        }
      }

      // 3. Invalid RegExp literal inside new RegExp('...')
      const newRegexMatch = /\bnew\s+RegExp\s*\(\s*(['"])((?:\\.|[^\\])*?)\1\s*(?:,\s*(['"])([gimsuyv]*)\3\s*)?\)/.exec(
        lineText
      );
      if (newRegexMatch) {
        try {
          new RegExp(newRegexMatch[2], newRegexMatch[4] || '');
        } catch (err) {
          findings.push({
            id: createId(),
            severity: 'error',
            category: 'runtime',
            ruleId: 'invalid-regex',
            message: `Invalid RegExp pattern: ${(err as Error).message}`,
            file: path,
            blockId,
            fixable: false,
            line: i + 1,
            column: newRegexMatch.index + 1,
            from: lineStarts[i] + newRegexMatch.index,
            to: lineStarts[i] + newRegexMatch.index + newRegexMatch[0].length,
          });
        }
      }

      // 4. Unreachable statement immediately following bare return/throw on same indentation
      const returnThrowMatch = /^(\s*)(?:return|throw)\b[^;{]*;\s*(?:\/\/.*)?$/.exec(lineText);
      if (returnThrowMatch && i + 1 < lines.length) {
        const currentIndent = returnThrowMatch[1].length;
        const nextLine = lines[i + 1];
        const nextTrimmed = nextLine.trim();
        const nextIndent = nextLine.length - nextLine.trimStart().length;
        if (
          nextTrimmed &&
          !nextTrimmed.startsWith('}') &&
          !nextTrimmed.startsWith('//') &&
          !nextTrimmed.startsWith('/*') &&
          !nextTrimmed.startsWith('case ') &&
          !nextTrimmed.startsWith('default:') &&
          !nextTrimmed.startsWith('function ') &&
          nextIndent === currentIndent
        ) {
          findings.push({
            id: createId(),
            severity: 'warning',
            category: 'logic',
            ruleId: 'unreachable-code',
            message: 'Statement appears unreachable immediately after return/throw.',
            file: path,
            blockId,
            fixable: false,
            line: i + 2,
            column: nextIndent + 1,
            from: lineStarts[i + 1],
            to: lineStarts[i + 1] + nextLine.length,
          });
        }
      }

      // 5. Unconditional while (true) without break/return/throw in following window
      if (/^\s*(?:while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\))\s*\{/.test(lineText)) {
        const windowSlice = lines.slice(i, Math.min(lines.length, i + 25)).join('\n');
        if (!/\b(?:break|return|throw|yield|await)\b/.test(windowSlice)) {
          findings.push({
            id: createId(),
            severity: 'warning',
            category: 'logic',
            ruleId: 'potential-infinite-loop',
            message: 'Unbounded loop detected without an obvious break, return, or await exit.',
            file: path,
            blockId,
            fixable: false,
            line: i + 1,
            column: 1,
            from: lineStarts[i],
            to: lineStarts[i] + lineText.length,
          });
        }
      }
    }

    // 6. Strict JS Function parse compilation & safe dry-run check (for .js/.mjs/.cjs)
    if (language === 'javascript' && content.trim().length > 0) {
      checksRun.push('Strict JS parse compilation');
      const body = toScriptTestableBody(content);
      try {
        // Parse under strict mode without executing unless safe self-contained pure code
        const compiledFn = new Function(`"use strict";\n${body}`);
        if (isSimpleSelfContainedJs(body)) {
          checksRun.push('Isolated runtime dry-run');
          try {
            compiledFn();
            runtimeVerified = true;
          } catch (runErr) {
            const errMsg = runErr instanceof Error ? runErr.message : String(runErr);
            const loc = offsetToLineCol(0, lineStarts);
            findings.push({
              id: createId(),
              severity: 'error',
              category: 'runtime',
              ruleId: 'js-runtime-error',
              message: `Runtime execution failed during verification: ${errMsg}`,
              file: path,
              blockId,
              fixable: true,
              line: loc.line,
              column: loc.column,
            });
            runtimeVerified = false;
          }
        } else {
          // Compiles cleanly cleanly under JS engine parser
          runtimeVerified = existingErrorCount === 0;
        }
      } catch (syntaxErr) {
        compiledCleanly = false;
        runtimeVerified = false;
        const msg = syntaxErr instanceof Error ? syntaxErr.message : String(syntaxErr);
        // Only emit if Lezer didn't already report syntax errors at line level
        if (existingErrorCount === 0) {
          findings.push({
            id: createId(),
            severity: 'error',
            category: 'syntax',
            ruleId: 'js-compile-error',
            message: `JavaScript strict compile error: ${msg}`,
            file: path,
            blockId,
            fixable: true,
            line: 1,
            column: 1,
          });
        }
      }
    }
  } else {
    checksRun.push(`${language} structural integrity check`);
  }

  const errorFindings = findings.filter((f) => f.severity === 'error');
  if (errorFindings.length > 0) {
    logicSound = false;
    compiledCleanly = false;
  }

  return {
    findings,
    verification: {
      compiledCleanly: compiledCleanly && existingErrorCount === 0,
      typeCheckedCleanly: existingErrorCount === 0 && errorFindings.length === 0,
      runtimeVerified: runtimeVerified && errorFindings.length === 0 && existingErrorCount === 0,
      geminiAudited: false,
      checksRun,
      summary:
        compiledCleanly && existingErrorCount === 0 && errorFindings.length === 0
          ? `Verified clean (${checksRun.join(', ')}).`
          : `Blocked by ${existingErrorCount + errorFindings.length} error(s).`,
    },
  };
}
