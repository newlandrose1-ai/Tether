import type {
  AuditFinding,
  AuditKnowledgeGap,
  AuditTargetType,
  AuditVerificationProof,
  AutofixSessionResult,
  AutofixStepLog,
  AutofixWebSource,
  Block,
  CodeBlockData,
  FileBlockData,
  Project,
  TargetAuditReport,
} from '../types/model';
import {
  resolveAuditLanguage,
  resolveRelativeProjectPath,
  runCodeAudit,
} from './codeAudit';
import { auditTarget } from './projectAudit';
import { createId } from './id';

export interface DeterministicFixResult {
  changed: boolean;
  content: string;
  appliedDescriptions: string[];
}

function repairMalformedJson(raw: string): string | null {
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    let candidate = raw.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    candidate = candidate
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    candidate = candidate.replace(/,\s*([}\]])/g, '$1');

    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      const stack: string[] = [];
      let inStr = false;
      for (let i = 0; i < candidate.length; i++) {
        const c = candidate[i];
        if (c === '"' && candidate[i - 1] !== '\\') {
          inStr = !inStr;
          continue;
        }
        if (inStr) continue;
        if (c === '{') stack.push('}');
        else if (c === '[') stack.push(']');
        else if ((c === '}' || c === ']') && stack[stack.length - 1] === c) {
          stack.pop();
        }
      }
      if (!inStr && stack.length > 0) {
        const closed = `${candidate.trimEnd()}\n${stack.reverse().join('\n')}\n`;
        try {
          JSON.parse(closed);
          return closed;
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

function appendMissingClosingDelimiters(raw: string): string | null {
  const stack: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    const prev = raw[i - 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'" && prev !== '\\') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== '\\') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '`' && prev !== '\\') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '`') inTemplate = true;
    else if (ch === '(') stack.push(')');
    else if (ch === '[') stack.push(']');
    else if (ch === '{') stack.push('}');
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  if (inSingle || inDouble || inTemplate || stack.length === 0) return null;
  return `${raw.trimEnd()}\n${stack.reverse().join('')}\n`;
}

/**
 * Applies deterministic, smallest-possible, intent-preserving fixes for known static & logic findings.
 */
export function applyDeterministicFixes(params: {
  content: string;
  path: string;
  language?: string;
  findings: AuditFinding[];
  projectPaths: string[];
  projectName?: string;
}): DeterministicFixResult {
  const { content, path, findings, projectPaths, projectName } = params;
  const lang = resolveAuditLanguage(params.language, path);
  const ruleIds = new Set(findings.map((f) => f.ruleId).filter(Boolean));
  const appliedDescriptions: string[] = [];
  let next = content;

  // 1. Secret exposure -> extract to env variable reference
  if (ruleIds.has('secret-exposure')) {
    const lines = next.split('\n');
    let replacedCount = 0;
    const updatedLines = lines.map((line) => {
      const secretAssign =
        /^(\s*(?:export\s+)?(?:const|let|var)?\s*[A-Za-z0-9_.-]+\s*[:=]\s*)(['"])(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|AIza[0-9A-Za-z_-]{16,})\2(.*)$/;
      const m = secretAssign.exec(line);
      if (m) {
        replacedCount++;
        const envExpr =
          lang === 'python'
            ? 'os.environ.get("TETHER_SECRET_KEY", "")'
            : lang === 'json'
            ? '"REPLACE_WITH_ENV_SECRET"'
            : 'process.env.TETHER_SECRET_KEY || ""';
        return `${m[1]}${envExpr}${m[3]}`;
      }
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)) {
        replacedCount++;
        return lang === 'python'
          ? '# Redacted private key: load from environment or secret manager'
          : '// Redacted private key: load from environment or secret manager';
      }
      return line;
    });
    if (replacedCount > 0) {
      next = updatedLines.join('\n');
      appliedDescriptions.push(`Replaced ${replacedCount} hardcoded secret literal(s) with env lookup`);
    }
  }

  // 2. Identical or single-sided merge conflict markers
  if (ruleIds.has('merge-conflict')) {
    const conflictPattern =
      /^<{7}[^\n]*\r?\n([\s\S]*?)^={7}\r?\n([\s\S]*?)^>{7}[^\n]*\r?\n?/gm;
    let resolvedAny = false;
    const candidate = next.replace(conflictPattern, (full, ours: string, theirs: string) => {
      if (ours.trim() === theirs.trim()) {
        resolvedAny = true;
        return ours;
      }
      if (!ours.trim()) {
        resolvedAny = true;
        return theirs;
      }
      if (!theirs.trim()) {
        resolvedAny = true;
        return ours;
      }
      return full;
    });
    if (resolvedAny && candidate !== next) {
      next = candidate;
      appliedDescriptions.push('Resolved non-conflicting merge conflict block(s)');
    }
  }

  // 3. Remove standalone debugger statements
  if (ruleIds.has('no-debugger')) {
    const stripped = next.replace(/^[ \t]*debugger;?[ \t]*\r?\n?/gm, '');
    if (stripped !== next) {
      next = stripped;
      appliedDescriptions.push('Removed leftover debugger statement(s)');
    }
  }

  // 4. JSON parse, duplicate key deduplication & package.json structure fixes
  if (lang === 'json') {
    if (ruleIds.has('json-parse-error')) {
      const repaired = repairMalformedJson(next);
      if (repaired && repaired !== next) {
        next = repaired;
        appliedDescriptions.push('Repaired malformed JSON syntax (trailing commas/comments/delimiters)');
      }
    }

    if (ruleIds.has('json-duplicate-key')) {
      try {
        const parsed = JSON.parse(next);
        const deduped = `${JSON.stringify(parsed, null, 2)}\n`;
        if (deduped !== next) {
          next = deduped;
          appliedDescriptions.push('Removed duplicate JSON key(s)');
        }
      } catch {
        // Defer until JSON parses cleanly
      }
    }

    if (
      ruleIds.has('package-json-missing-name') ||
      ruleIds.has('package-json-missing-version') ||
      ruleIds.has('package-json-missing-entry')
    ) {
      try {
        const parsed = JSON.parse(next) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          let touched = false;
          if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
            const slug = (projectName || 'tether-app')
              .toLowerCase()
              .replace(/[^a-z0-9-_]+/g, '-')
              .replace(/^-+|-+$/g, '');
            parsed.name = slug || 'tether-app';
            touched = true;
          }
          if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
            parsed.version = '0.1.0';
            touched = true;
          }
          if (
            ruleIds.has('package-json-missing-entry') &&
            typeof parsed.main === 'string' &&
            projectPaths.length > 0
          ) {
            const normalizedMain =
              parsed.main.startsWith('./') || parsed.main.startsWith('../')
                ? parsed.main
                : `./${parsed.main}`;
            const res = resolveRelativeProjectPath(path, normalizedMain, projectPaths);
            if (!res.resolved && res.bestCandidate) {
              parsed.main = res.bestCandidate;
              touched = true;
            }
          }
          if (touched) {
            next = `${JSON.stringify(parsed, null, 2)}\n`;
            appliedDescriptions.push('Updated package.json metadata/entry fields');
          }
        }
      } catch {
        // Skip if still unparseable
      }
    }
  }

  // 5. Cargo.toml fixes
  if (
    ruleIds.has('toml-unclosed-section') ||
    ruleIds.has('cargo-missing-package') ||
    ruleIds.has('cargo-missing-name') ||
    ruleIds.has('cargo-missing-version')
  ) {
    let cargo = next;
    if (ruleIds.has('toml-unclosed-section')) {
      cargo = cargo
        .split('\n')
        .map((line) => {
          const t = line.trim();
          if (t.startsWith('[') && !t.endsWith(']')) return `${line.trimEnd()}]`;
          return line;
        })
        .join('\n');
    }
    if (ruleIds.has('cargo-missing-package')) {
      cargo = `[package]\nname = "tether_project"\nversion = "0.1.0"\nedition = "2021"\n\n${cargo}`;
    } else {
      if (ruleIds.has('cargo-missing-name')) {
        cargo = cargo.replace(/^(\s*\[package\]\s*)$/m, '$1\nname = "tether_project"');
      }
      if (ruleIds.has('cargo-missing-version')) {
        cargo = cargo.replace(/^(\s*\[package\]\s*)$/m, '$1\nversion = "0.1.0"');
      }
    }
    if (cargo !== next) {
      next = cargo;
      appliedDescriptions.push('Repaired Cargo.toml [package] section and headers');
    }
  }

  // 6. requirements.txt fixes
  if (ruleIds.has('requirements-invalid-operator') || ruleIds.has('requirements-duplicate-pkg')) {
    const seen = new Set<string>();
    const fixedLines: string[] = [];
    for (const line of next.split('\n')) {
      const cur = line.replace(/\s*=>\s*/g, '>=');
      const t = cur.trim();
      const m = /^([A-Za-z0-9_.-]+)/.exec(t);
      if (m && !t.startsWith('#') && !t.startsWith('-')) {
        const key = m[1].toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
      }
      fixedLines.push(cur);
    }
    const joined = fixedLines.join('\n');
    if (joined !== next) {
      next = joined;
      appliedDescriptions.push('Fixed version operators and duplicate entries in requirements.txt');
    }
  }

  // 7. Python indentation & missing header colons
  if (lang === 'python') {
    let pyChanged = false;
    const pyLines = next.split('\n').map((line) => {
      let updated = line;
      if (/^\t+/.test(updated) || /^\t+ +|^ +\t+/.test(updated)) {
        updated = updated.replace(/\t/g, '    ');
        pyChanged = true;
      }
      const trimmed = updated.trim();
      const headerMatch =
        /^(?:async\s+)?(def|class|if|elif|else|for|while|try|except|finally|with)\b(.*)$/.exec(
          trimmed
        );
      if (headerMatch) {
        const codeOnly = trimmed.replace(/#.*$/, '').trimEnd();
        const openP = (codeOnly.match(/\(/g) || []).length;
        const closeP = (codeOnly.match(/\)/g) || []).length;
        if (openP === closeP && !codeOnly.endsWith(':') && !codeOnly.endsWith('\\')) {
          updated = `${updated.trimEnd()}:`;
          pyChanged = true;
        }
      }
      return updated;
    });
    if (pyChanged) {
      next = pyLines.join('\n');
      appliedDescriptions.push('Fixed Python tab indentation and missing header colons');
    }
  }

  // 8. JS/TS const-no-init, nan-equality, assignment-in-condition & relative import path repair
  if (
    lang === 'javascript' ||
    lang === 'typescript' ||
    lang === 'jsx' ||
    lang === 'tsx'
  ) {
    if (ruleIds.has('const-no-init')) {
      const updated = next.replace(
        /^(\s*(?:export\s+)?)const(\s+[A-Za-z_$][\w$]*\s*(?::[^=;]+)?;\s*(?:\/\/.*)?)$/gm,
        '$1let$2'
      );
      if (updated !== next) {
        next = updated;
        appliedDescriptions.push('Converted uninitialized const declaration(s) to let');
      }
    }

    if (ruleIds.has('nan-equality')) {
      let nanFixed = next
        .replace(/\b([A-Za-z_$][\w$.]*)\s*(?:===|==)\s*NaN\b/g, 'Number.isNaN($1)')
        .replace(/\bNaN\s*(?:===|==)\s*([A-Za-z_$][\w$.]*)\b/g, 'Number.isNaN($1)')
        .replace(/\b([A-Za-z_$][\w$.]*)\s*(?:!==|!=)\s*NaN\b/g, '!Number.isNaN($1)')
        .replace(/\bNaN\s*(?:!==|!=)\s*([A-Za-z_$][\w$.]*)\b/g, '!Number.isNaN($1)');
      if (nanFixed !== next) {
        next = nanFixed;
        appliedDescriptions.push('Replaced direct NaN comparison(s) with Number.isNaN(...)');
      }
    }

    if (ruleIds.has('assignment-in-condition')) {
      const updated = next.replace(
        /\bif\s*\(\s*([A-Za-z_$][\w$]*)\s*=\s*([^=][^)]*)\)/g,
        'if ($1 === $2)'
      );
      if (updated !== next) {
        next = updated;
        appliedDescriptions.push('Converted assignment inside if() condition to strict equality ===');
      }
    }

    if (ruleIds.has('missing-relative-import') && projectPaths.length > 0) {
      let updatedImportCount = 0;
      const lines = next.split('\n').map((line) => {
        return line.replace(
          /((?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*|import\s*\(\s*))(['"])(\.\.?\/[^'"]+)\2/g,
          (full, prefix: string, quote: string, spec: string) => {
            const res = resolveRelativeProjectPath(path, spec, projectPaths);
            if (!res.resolved && res.bestCandidate) {
              updatedImportCount++;
              return `${prefix}${quote}${res.bestCandidate}${quote}`;
            }
            return full;
          }
        );
      });
      if (updatedImportCount > 0) {
        next = lines.join('\n');
        appliedDescriptions.push(
          `Updated ${updatedImportCount} relative import path(s) to match live folder structure`
        );
      }
    }
  }

  // 9. HTML structure, unclosed <script>, and asset refs
  if (lang === 'html') {
    if (ruleIds.has('html-missing-doctype') && !/<!doctype\s+html>/i.test(next)) {
      next = `<!DOCTYPE html>\n${next}`;
      appliedDescriptions.push('Prepended <!DOCTYPE html> declaration');
    }
    if (ruleIds.has('html-unclosed-script')) {
      const opens = (next.match(/<script\b[^>]*>/gi) || []).length;
      const closes = (next.match(/<\/script>/gi) || []).length;
      if (opens > closes) {
        next = `${next.trimEnd()}\n${'</script>\n'.repeat(opens - closes)}`;
        appliedDescriptions.push('Closed unclosed <script> tag');
      }
    }
    if (ruleIds.has('missing-asset-ref') && projectPaths.length > 0) {
      let fixedAssets = 0;
      const updated = next.replace(
        /\b(src|href)\s*=\s*(["'])([^"']+)\2/gi,
        (full, attr: string, quote: string, ref: string) => {
          if (
            !ref ||
            ref.startsWith('#') ||
            ref.startsWith('http') ||
            ref.startsWith('data:')
          ) {
            return full;
          }
          const normalizedRef = ref.startsWith('./') || ref.startsWith('../') ? ref : `./${ref}`;
          const res = resolveRelativeProjectPath(path, normalizedRef, projectPaths);
          if (!res.resolved && res.bestCandidate) {
            fixedAssets++;
            return `${attr}=${quote}${res.bestCandidate}${quote}`;
          }
          return full;
        }
      );
      if (fixedAssets > 0) {
        next = updated;
        appliedDescriptions.push(`Repaired ${fixedAssets} local asset reference(s)`);
      }
    }
  }

  // 10. Unclosed delimiter repair at EOF when Lezer syntax error still exists
  if (ruleIds.has('syntax-error')) {
    const preCheck = runCodeAudit({ content: next, language: lang, path });
    if (preCheck.errorCount > 0) {
      const closed = appendMissingClosingDelimiters(next);
      if (closed) {
        const postCheck = runCodeAudit({ content: closed, language: lang, path });
        if (postCheck.errorCount < preCheck.errorCount) {
          next = closed;
          appliedDescriptions.push('Added missing closing brace/bracket/parenthesis');
        }
      }
    }
  }

  return {
    changed: next !== content,
    content: next,
    appliedDescriptions,
  };
}

export type WebResolveHandler = (params: {
  filePath: string;
  language: string;
  content: string;
  findings: AuditFinding[];
  knowledgeGaps: AuditKnowledgeGap[];
  projectPaths: string[];
}) => Promise<{
  available: boolean;
  changed: boolean;
  patchedContent?: string;
  knowledgeSummary?: string;
  explanation?: string;
  sources?: AutofixWebSource[];
  reason?: string;
}>;

export type DeepVerifyHandler = (params: {
  targetFiles: Array<{ blockId: string; path: string; language: string; content: string }>;
  allProjectFiles: Array<{ blockId: string; path: string; language: string; content: string }>;
}) => Promise<{
  available: boolean;
  diagnostics: AuditFinding[];
  verification?: AuditVerificationProof;
  reason?: string;
}>;

export type GeminiAuditHandler = (params: {
  files: Array<{ blockId: string; filePath: string; language: string; content: string }>;
  projectPaths: string[];
}) => Promise<{
  available: boolean;
  connected?: boolean;
  testable?: boolean;
  summary?: string;
  findings: AuditFinding[];
  reason?: string;
}>;

export async function defaultWebResolve(params: {
  filePath: string;
  language: string;
  content: string;
  findings: AuditFinding[];
  knowledgeGaps: AuditKnowledgeGap[];
  projectPaths: string[];
}) {
  const res = await fetch('/api/audit/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return (await res.json()) as {
    available: boolean;
    changed: boolean;
    patchedContent?: string;
    knowledgeSummary?: string;
    explanation?: string;
    sources?: AutofixWebSource[];
    reason?: string;
  };
}

export async function defaultDeepVerify(params: {
  targetFiles: Array<{ blockId: string; path: string; language: string; content: string }>;
  allProjectFiles: Array<{ blockId: string; path: string; language: string; content: string }>;
}) {
  const res = await fetch('/api/audit/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return (await res.json()) as {
    available: boolean;
    diagnostics: AuditFinding[];
    verification?: AuditVerificationProof;
    reason?: string;
  };
}

export async function defaultGeminiAudit(params: {
  files: Array<{ blockId: string; filePath: string; language: string; content: string }>;
  projectPaths: string[];
}) {
  const res = await fetch('/api/audit/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return (await res.json()) as {
    available: boolean;
    connected?: boolean;
    testable?: boolean;
    summary?: string;
    findings: AuditFinding[];
    reason?: string;
  };
}

function getBlockTextContent(block: Block): string {
  if (block.kind === 'code') {
    return (block.data as CodeBlockData)?.currentContent ?? '';
  }
  if (block.kind === 'file') {
    return (block.data as FileBlockData)?.content ?? '';
  }
  return (block.data as { content?: string })?.content ?? '';
}

function mergeExternalDiagnostics(
  report: TargetAuditReport,
  extraFindings: AuditFinding[],
  verificationPatch?: Partial<AuditVerificationProof>
): TargetAuditReport {
  if (extraFindings.length === 0 && !verificationPatch) return report;

  const mergedFindings = [...report.findings];
  const fileReportMap = new Map(report.fileReports.map((fr) => [fr.blockId, { ...fr, findings: [...fr.findings] }]));

  for (const ef of extraFindings) {
    const targetFr =
      (ef.blockId && fileReportMap.get(ef.blockId)) ||
      Array.from(fileReportMap.values()).find((fr) => fr.path === ef.file);
    const alreadyExists = mergedFindings.some(
      (existing) =>
        existing.file === ef.file &&
        (existing.line ?? 1) === (ef.line ?? 1) &&
        existing.message === ef.message
    );
    if (!alreadyExists) {
      const normalized = targetFr && !ef.blockId ? { ...ef, blockId: targetFr.blockId } : ef;
      mergedFindings.push(normalized);
      if (targetFr) {
        targetFr.findings.push(normalized);
        targetFr.errorCount = targetFr.findings.filter((f) => f.severity === 'error').length;
        targetFr.warningCount = targetFr.findings.filter((f) => f.severity === 'warning').length;
        targetFr.passed = targetFr.errorCount === 0;
        targetFr.testable = targetFr.passed;
      }
    }
  }

  const nextFileReports = Array.from(fileReportMap.values());
  const errorCount = nextFileReports.reduce((sum, r) => sum + r.errorCount, 0);
  const warningCount = nextFileReports.reduce((sum, r) => sum + r.warningCount, 0);
  const passed = errorCount === 0;

  const baseVerification = report.verification || {
    compiledCleanly: passed,
    typeCheckedCleanly: passed,
    runtimeVerified: passed,
    geminiAudited: false,
    checksRun: [],
    summary: '',
  };

  const nextChecks = Array.from(
    new Set([...baseVerification.checksRun, ...(verificationPatch?.checksRun || [])])
  );

  const nextVerification: AuditVerificationProof = {
    compiledCleanly:
      passed &&
      (verificationPatch?.compiledCleanly ?? baseVerification.compiledCleanly),
    typeCheckedCleanly:
      passed &&
      (verificationPatch?.typeCheckedCleanly ?? baseVerification.typeCheckedCleanly),
    runtimeVerified:
      passed &&
      (verificationPatch?.runtimeVerified ?? baseVerification.runtimeVerified),
    geminiAudited: verificationPatch?.geminiAudited ?? baseVerification.geminiAudited,
    checksRun: nextChecks,
    summary: verificationPatch?.summary || baseVerification.summary,
  };

  return {
    ...report,
    passed,
    testable: passed && nextVerification.compiledCleanly,
    errorCount,
    warningCount,
    fileReports: nextFileReports,
    findings: mergedFindings,
    verification: nextVerification,
  };
}

export interface RunAutofixLoopParams {
  /** Must be explicitly true from a user consent action */
  confirmedByUser: boolean;
  targetType: AuditTargetType;
  projectId: string;
  blockId?: string;
  folderPath?: string;
  selectedBlockIds?: string[];
  includeUntethered?: boolean;
  maxIterations?: number;
  getProject: () => Project | undefined;
  getBlocks: () => Block[];
  updateBlockContent: (blockId: string, newContent: string) => Promise<void>;
  webResolveFn?: WebResolveHandler;
  deepVerifyFn?: DeepVerifyHandler;
  geminiAuditFn?: GeminiAuditHandler;
  onProgress?: (step: AutofixStepLog, latestReport: TargetAuditReport) => void;
  shouldStop?: () => boolean;
}

/**
 * Executes the iterative Audit -> Safe Fix -> Verify -> Re-audit loop until the target passes
 * cleanly and is provably testable, or halts cleanly when stopped / no further safe edits exist.
 */
export async function runAutofixLoop(
  params: RunAutofixLoopParams
): Promise<AutofixSessionResult> {
  const {
    confirmedByUser,
    targetType,
    blockId,
    folderPath,
    selectedBlockIds,
    includeUntethered = true,
    maxIterations = 8,
    getProject,
    getBlocks,
    updateBlockContent,
    webResolveFn,
    deepVerifyFn,
    geminiAuditFn,
    onProgress,
    shouldStop,
  } = params;

  if (!confirmedByUser) {
    const project = getProject();
    if (!project) {
      throw new Error('Active project not found.');
    }
    const report = auditTarget({
      targetType,
      project,
      blocks: getBlocks(),
      blockId,
      folderPath,
      selectedBlockIds,
      includeUntethered,
    });
    return {
      status: 'declined',
      iterations: 0,
      report,
      steps: [],
      modifiedBlockIds: [],
      webSources: [],
      remainingReason: 'User declined automatic corrections.',
      verification: report.verification,
    };
  }

  const steps: AutofixStepLog[] = [];
  const modifiedBlockIds = new Set<string>();
  const webSources: AutofixWebSource[] = [];
  const seenSourceUris = new Set<string>();
  const attemptedWebForHash = new Set<string>();
  const auditedGeminiSignature = new Set<string>();

  const pushStep = (
    step: Omit<AutofixStepLog, 'id' | 'timestamp'>,
    report: TargetAuditReport
  ) => {
    const full: AutofixStepLog = {
      ...step,
      id: createId(),
      timestamp: Date.now(),
    };
    steps.push(full);
    onProgress?.(full, report);
  };

  let iteration = 0;
  let lastReport!: TargetAuditReport;

  while (iteration < maxIterations) {
    iteration++;
    const project = getProject();
    if (!project) {
      throw new Error('Active project no longer exists.');
    }
    const blocks = getBlocks();
    lastReport = auditTarget({
      targetType,
      project,
      blocks,
      blockId,
      folderPath,
      selectedBlockIds,
      includeUntethered,
    });

    const projectBlockMap = new Map(blocks.map((b) => [b.id, b]));
    const allProjectFiles = blocks
      .filter((b) => b.projectId === project.id && b.kind !== 'upload')
      .map((b) => ({
        blockId: b.id,
        path: (b.sourcePath || (b.data as { path?: string })?.path || b.title).replace(/^\/+/, ''),
        language: (b.data as { language?: string })?.language || 'javascript',
        content: getBlockTextContent(b),
      }));

    // Run deep TypeScript compiler + VM runtime verification when static errors are cleared (or during audit)
    if (deepVerifyFn && lastReport.fileReports.length > 0 && lastReport.passed) {
      try {
        const targetFiles = lastReport.fileReports.map((fr) => {
          const blk = projectBlockMap.get(fr.blockId);
          return {
            blockId: fr.blockId,
            path: fr.path,
            language: fr.language,
            content: blk ? getBlockTextContent(blk) : '',
          };
        });
        const verifyRes = await deepVerifyFn({
          targetFiles,
          allProjectFiles,
        });
        if (verifyRes.available) {
          lastReport = mergeExternalDiagnostics(
            lastReport,
            verifyRes.diagnostics || [],
            verifyRes.verification
          );
          pushStep(
            {
              iteration,
              phase: 'verify',
              message:
                verifyRes.diagnostics.filter((d) => d.severity === 'error').length === 0
                  ? verifyRes.verification?.summary ||
                    'Compiler & runtime verification confirmed target is testable.'
                  : `Compiler/runtime check caught ${verifyRes.diagnostics.filter((d) => d.severity === 'error').length} issue(s).`,
              errorCount: lastReport.errorCount,
              warningCount: lastReport.warningCount,
            },
            lastReport
          );
        }
      } catch {
        // Keep local verification result if network call fails
      }
    }

    // Run Gemini AI deep semantic audit once per clean static+compiler state hash
    const stateSignature = Object.entries(lastReport.contentHashes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join('|');

    if (
      geminiAuditFn &&
      lastReport.passed &&
      lastReport.testable &&
      lastReport.fileReports.length > 0 &&
      !auditedGeminiSignature.has(stateSignature)
    ) {
      auditedGeminiSignature.add(stateSignature);
      try {
        const filesPayload = lastReport.fileReports.slice(0, 6).map((fr) => {
          const blk = projectBlockMap.get(fr.blockId);
          return {
            blockId: fr.blockId,
            filePath: fr.path,
            language: fr.language,
            content: blk ? getBlockTextContent(blk) : '',
          };
        });
        const gemRes = await geminiAuditFn({
          files: filesPayload,
          projectPaths: allProjectFiles.map((f) => f.path),
        });
        if (gemRes.available) {
          lastReport = mergeExternalDiagnostics(lastReport, gemRes.findings || [], {
            geminiAudited: true,
            checksRun: ['Gemini AI Deep Semantic Audit'],
            summary: gemRes.summary,
          });
          pushStep(
            {
              iteration,
              phase: 'gemini-audit',
              message:
                gemRes.findings.filter((f) => f.severity === 'error').length === 0
                  ? gemRes.summary || 'Gemini AI deep audit confirmed logic & types are sound.'
                  : `Gemini AI flagged ${gemRes.findings.filter((f) => f.severity === 'error').length} error(s) for targeted repair.`,
              errorCount: lastReport.errorCount,
              warningCount: lastReport.warningCount,
            },
            lastReport
          );
        }
      } catch {
        // Non-fatal if Gemini endpoint is unreachable
      }
    }

    pushStep(
      {
        iteration,
        phase: iteration === 1 ? 'audit' : 're-audit',
        message: `${iteration === 1 ? 'Initial audit' : 'Re-audit'}: ${lastReport.errorCount} error(s), ${lastReport.warningCount} warning(s) across ${lastReport.filesAudited} file(s).`,
        errorCount: lastReport.errorCount,
        warningCount: lastReport.warningCount,
      },
      lastReport
    );

    if (lastReport.passed && lastReport.testable) {
      pushStep(
        {
          iteration,
          phase: 'clean',
          message: `All checks passed. Target "${lastReport.targetLabel}" compiles cleanly and is provably testable.`,
          errorCount: 0,
          warningCount: lastReport.warningCount,
        },
        lastReport
      );
      return {
        status: 'clean',
        iterations: iteration,
        report: lastReport,
        steps,
        modifiedBlockIds: Array.from(modifiedBlockIds),
        webSources,
        verification: lastReport.verification,
      };
    }

    if (shouldStop?.()) {
      pushStep(
        {
          iteration,
          phase: 'stopped',
          message: 'Autofix loop stopped by user request.',
          errorCount: lastReport.errorCount,
          warningCount: lastReport.warningCount,
        },
        lastReport
      );
      return {
        status: 'stopped',
        iterations: iteration,
        report: lastReport,
        steps,
        modifiedBlockIds: Array.from(modifiedBlockIds),
        webSources,
        verification: lastReport.verification,
      };
    }

    const projectPaths = Array.from(new Set(allProjectFiles.map((f) => f.path)));
    let madeProgress = false;
    const filesWithErrors = lastReport.fileReports.filter((f) => f.errorCount > 0);

    for (const fileReport of filesWithErrors) {
      if (shouldStop?.()) break;
      const liveBlock = getBlocks().find((b) => b.id === fileReport.blockId);
      if (!liveBlock) continue;

      const currentContent = getBlockTextContent(liveBlock);

      // Pass A: Deterministic minimal repair
      const det = applyDeterministicFixes({
        content: currentContent,
        path: fileReport.path,
        language: fileReport.language,
        findings: fileReport.findings,
        projectPaths,
        projectName: project.name,
      });

      if (det.changed) {
        await updateBlockContent(liveBlock.id, det.content);
        modifiedBlockIds.add(liveBlock.id);
        madeProgress = true;
        pushStep(
          {
            iteration,
            phase: 'fix',
            filePath: fileReport.path,
            message: `${fileReport.path}: ${det.appliedDescriptions.join('; ')}.`,
          },
          lastReport
        );
        continue;
      }

      // Pass B: Gemini AI + Web-Grounded resolution for remaining compiler/semantic/logic/gap errors
      const attemptKey = `${liveBlock.id}:${fileReport.contentHash}:${fileReport.findings.map((f) => f.message).join('|')}`;
      if (webResolveFn && !attemptedWebForHash.has(attemptKey)) {
        attemptedWebForHash.add(attemptKey);
        pushStep(
          {
            iteration,
            phase: 'web-search',
            filePath: fileReport.path,
            message:
              fileReport.knowledgeGaps.length > 0
                ? `${fileReport.path}: Recognized knowledge gap (${fileReport.knowledgeGaps[0].frameworkOrTopic}). Querying Gemini + web references...`
                : `${fileReport.path}: Invoking Gemini repair for ${fileReport.errorCount} unresolved error(s)...`,
          },
          lastReport
        );

        try {
          const webRes = await webResolveFn({
            filePath: fileReport.path,
            language: fileReport.language,
            content: currentContent,
            findings: fileReport.findings,
            knowledgeGaps: fileReport.knowledgeGaps,
            projectPaths,
          });

          if (webRes.sources && webRes.sources.length > 0) {
            for (const src of webRes.sources) {
              if (!seenSourceUris.has(src.uri)) {
                seenSourceUris.add(src.uri);
                webSources.push(src);
              }
            }
          }

          if (
            webRes.available &&
            webRes.changed &&
            typeof webRes.patchedContent === 'string' &&
            webRes.patchedContent.trim().length > 0
          ) {
            await updateBlockContent(liveBlock.id, webRes.patchedContent);
            modifiedBlockIds.add(liveBlock.id);
            madeProgress = true;
            pushStep(
              {
                iteration,
                phase: 'fix',
                filePath: fileReport.path,
                message: `${fileReport.path}: ${webRes.explanation || 'Applied Gemini minimal fix.'}`,
                sources: webRes.sources,
              },
              lastReport
            );
          } else if (webRes.reason) {
            pushStep(
              {
                iteration,
                phase: 'unresolved',
                filePath: fileReport.path,
                message: `${fileReport.path}: ${webRes.reason}`,
              },
              lastReport
            );
          }
        } catch (err) {
          pushStep(
            {
              iteration,
              phase: 'unresolved',
              filePath: fileReport.path,
              message: `${fileReport.path}: Gemini repair failed (${err instanceof Error ? err.message : 'network error'}).`,
            },
            lastReport
          );
        }
      }
    }

    if (shouldStop?.()) {
      pushStep(
        {
          iteration,
          phase: 'stopped',
          message: 'Autofix loop stopped by user.',
        },
        lastReport
      );
      return {
        status: 'stopped',
        iterations: iteration,
        report: lastReport,
        steps,
        modifiedBlockIds: Array.from(modifiedBlockIds),
        webSources,
        verification: lastReport.verification,
      };
    }

    if (!madeProgress) {
      const finalReason =
        lastReport.knowledgeGaps.length > 0
          ? `Remaining issues involve ${lastReport.knowledgeGaps.map((g) => g.language).join(', ')} or require manual intent confirmation.`
          : 'Remaining errors require manual review (no further safe minimal autofixes available).';
      pushStep(
        {
          iteration,
          phase: 'unresolved',
          message: finalReason,
          errorCount: lastReport.errorCount,
          warningCount: lastReport.warningCount,
        },
        lastReport
      );
      return {
        status: 'unresolved',
        iterations: iteration,
        report: lastReport,
        steps,
        modifiedBlockIds: Array.from(modifiedBlockIds),
        webSources,
        remainingReason: finalReason,
        verification: lastReport.verification,
      };
    }
  }

  const finalProject = getProject();
  if (finalProject) {
    lastReport = auditTarget({
      targetType,
      project: finalProject,
      blocks: getBlocks(),
      blockId,
      folderPath,
      selectedBlockIds,
      includeUntethered,
    });
  }

  const finalStatus = lastReport.passed && lastReport.testable ? 'clean' : 'unresolved';
  pushStep(
    {
      iteration,
      phase: finalStatus,
      message:
        finalStatus === 'clean'
          ? 'All checks passed on final verification.'
          : `Reached max iterations (${maxIterations}) with ${lastReport.errorCount} error(s) remaining.`,
      errorCount: lastReport.errorCount,
      warningCount: lastReport.warningCount,
    },
    lastReport
  );

  return {
    status: finalStatus,
    iterations: iteration,
    report: lastReport,
    steps,
    modifiedBlockIds: Array.from(modifiedBlockIds),
    webSources,
    remainingReason:
      finalStatus === 'clean' ? undefined : 'Iteration limit reached before all errors cleared.',
    verification: lastReport.verification,
  };
}
