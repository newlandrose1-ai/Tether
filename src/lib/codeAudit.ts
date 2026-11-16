import {
  javascriptLanguage,
  jsxLanguage,
  typescriptLanguage,
  tsxLanguage,
} from '@codemirror/lang-javascript';
import { jsonLanguage } from '@codemirror/lang-json';
import { htmlLanguage } from '@codemirror/lang-html';
import { cssLanguage } from '@codemirror/lang-css';
import type {
  AuditFinding,
  AuditKnowledgeGap,
  AuditVerificationProof,
} from '../types/model';
import { computeContentHash, containsSensitiveContent } from './hash';
import { verifyCodeTestability } from './codeVerify';
import { createId } from './id';

export interface CodeAuditProjectContext {
  /** All canonical POSIX paths present in the live project (e.g., ['src/main.ts', 'package.json']) */
  allPaths: string[];
  /** Declared npm dependency names if package.json exists in the project */
  declaredDependencies?: string[];
}

export interface CodeAuditResult {
  passed: boolean;
  testable: boolean;
  errorCount: number;
  warningCount: number;
  findings: AuditFinding[];
  knowledgeGaps: AuditKnowledgeGap[];
  language: string;
  contentHash: string;
  verification?: AuditVerificationProof;
}

const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

const SPECIALIZED_LANGUAGES: Record<
  string,
  { label: string; topic: string; reason: string }
> = {
  py: {
    label: 'python',
    topic: 'Python syntax, imports, and runtime typing',
    reason:
      'Local analyzer checks indentation and header colons, but does not run a full Python AST/mypy typechecker.',
  },
  rs: {
    label: 'rust',
    topic: 'Rust ownership, lifetimes, and Cargo crate rules',
    reason:
      'Rust borrow-checking and macro syntax require authoritative rustc/crate verification beyond local static rules.',
  },
  go: {
    label: 'go',
    topic: 'Go package imports, interfaces, and module syntax',
    reason:
      'Go compiler type rules and package resolution require authoritative Go specification lookup.',
  },
  gd: {
    label: 'gdscript',
    topic: 'Godot GDScript node signals and engine APIs',
    reason:
      'GDScript syntax and Godot 4 engine class APIs are not verified by the local JS/TS parser.',
  },
  lua: {
    label: 'lua',
    topic: 'Lua/Love2D/Roblox Luau syntax and stdlib',
    reason:
      'Lua block scoping and game-engine bindings are outside the local parser rule set.',
  },
  cs: {
    label: 'csharp',
    topic: 'C# / Unity / Godot .NET compilation rules',
    reason:
      'C# static typing, namespaces, and Unity/Godot APIs require external language verification.',
  },
  cpp: {
    label: 'cpp',
    topic: 'C++ headers, templates, and standard library rules',
    reason:
      'C++ preprocessing and template semantics require compiler/spec reference lookup.',
  },
  c: {
    label: 'c',
    topic: 'C headers, pointers, and memory safety rules',
    reason:
      'C preprocessor macros and pointer type rules are outside the local parser.',
  },
  glsl: {
    label: 'glsl',
    topic: 'GLSL shader uniforms, stages, and built-ins',
    reason:
      'Shader stage qualifiers and GLSL version syntax require Khronos specification lookup.',
  },
  wgsl: {
    label: 'wgsl',
    topic: 'WebGPU WGSL shader syntax and bindings',
    reason:
      'WGSL group/binding attributes and types require W3C WebGPU spec lookup.',
  },
  sql: {
    label: 'sql',
    topic: 'SQL dialect syntax and schema constraints',
    reason:
      'SQL dialect-specific queries and constraints are not parsed locally.',
  },
  yaml: {
    label: 'yaml',
    topic: 'YAML indentation, anchors, and schema structure',
    reason:
      'Full YAML schema and multi-document anchor semantics are not parsed locally.',
  },
  yml: {
    label: 'yaml',
    topic: 'YAML indentation, anchors, and schema structure',
    reason:
      'Full YAML schema and multi-document anchor semantics are not parsed locally.',
  },
  vue: {
    label: 'vue',
    topic: 'Vue Single-File Component template & script setup rules',
    reason:
      'Vue SFC compiler macros and template directives require Vue documentation lookup.',
  },
  svelte: {
    label: 'svelte',
    topic: 'Svelte runes/reactivity & template syntax',
    reason:
      'Svelte compiler reactivity rules are outside the local JS/HTML parser.',
  },
  sh: {
    label: 'shell',
    topic: 'POSIX/Bash shell quoting and exit behavior',
    reason:
      'Shell expansion and subshell edge cases require ShellCheck/Bash reference verification.',
  },
};

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

export function resolveAuditLanguage(language?: string, path?: string): string {
  const normalizedPath = (path || '').toLowerCase();
  const base = normalizedPath.split('/').pop() || '';
  if (base === '.gitignore' || base === '.gitattributes' || base === '.gitkeep') {
    return 'gitignore';
  }
  if (base === 'cargo.toml') return 'toml';
  if (base === 'requirements.txt') return 'requirements';
  if (base === 'license' || base === 'notice' || base === 'authors') return 'text';
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';

  const ext = base.includes('.') ? base.split('.').pop() || '' : '';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'jsx') return 'jsx';
  if (ext === 'ts') return 'typescript';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'json') return 'json';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'py') return 'python';
  if (ext === 'toml') return 'toml';
  if (ext === 'rs') return 'rust';
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return 'markdown';
  if (ext && SPECIALIZED_LANGUAGES[ext]) return SPECIALIZED_LANGUAGES[ext].label;
  if (ext) return ext;
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

function normalizePosixPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function computeRelativePosix(fromDir: string, toFile: string): string {
  const fromParts = fromDir ? fromDir.split('/').filter(Boolean) : [];
  const toParts = toFile.split('/').filter(Boolean);
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const ups = fromParts.length - common;
  const relParts = [
    ...Array.from({ length: ups }, () => '..'),
    ...toParts.slice(common),
  ];
  const joined = relParts.join('/');
  return joined.startsWith('.') ? joined : `./${joined}`;
}

export function resolveRelativeProjectPath(
  fromFilePath: string,
  specifier: string,
  allPaths: string[]
): { resolved: string | null; bestCandidate?: string } {
  const cleanAll = allPaths.map(normalizePosixPath);
  const pathSet = new Set(cleanAll);
  const fromNorm = normalizePosixPath(fromFilePath);
  const fromDir = fromNorm.includes('/')
    ? fromNorm.split('/').slice(0, -1).join('/')
    : '';

  // Resolve '..' and '.' relative to fromDir
  const rawJoined = fromDir ? `${fromDir}/${specifier}` : specifier;
  const segments: string[] = [];
  for (const part of rawJoined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  const targetBase = segments.join('/');
  const candidates = [
    targetBase,
    `${targetBase}.ts`,
    `${targetBase}.tsx`,
    `${targetBase}.js`,
    `${targetBase}.jsx`,
    `${targetBase}.json`,
    `${targetBase}.css`,
    `${targetBase}/index.ts`,
    `${targetBase}/index.tsx`,
    `${targetBase}/index.js`,
    `${targetBase}/index.jsx`,
  ];

  for (const c of candidates) {
    if (pathSet.has(c)) {
      return { resolved: c };
    }
  }

  // Look for a unique filename match anywhere in live project paths (helps when files moved via tether!)
  const specLeaf = specifier.split('/').pop()?.replace(/\.(ts|tsx|js|jsx)$/i, '') || '';
  if (specLeaf) {
    const matches = cleanAll.filter((p) => {
      const pLeaf = p.split('/').pop() || '';
      const pStem = pLeaf.replace(/\.(ts|tsx|js|jsx)$/i, '');
      return (pLeaf === specifier.split('/').pop() || pStem === specLeaf) && p !== fromNorm;
    });
    if (matches.length === 1) {
      const rel = computeRelativePosix(fromDir, matches[0]);
      const stripped = /\.(css|json|html|png|svg|jpg|webp|mp3|wav)$/i.test(matches[0])
        ? rel
        : rel.replace(/\.(ts|tsx|js|jsx)$/i, '');
      return { resolved: null, bestCandidate: stripped };
    }
  }

  return { resolved: null };
}

function getPackageBaseName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0] || specifier;
}

function hasUnbalancedDelimiters(content: string): {
  unbalanced: boolean;
  missingClosers: string;
} {
  const stack: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    const prev = content[i - 1];

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
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '(') stack.push(')');
    else if (ch === '[') stack.push(']');
    else if (ch === '{') stack.push('}');
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  return {
    unbalanced: stack.length > 0 || inSingle || inDouble || inTemplate,
    missingClosers: stack.reverse().join(''),
  };
}

/**
 * Runs deterministic static syntax, structural, semantic, import, and secret checks on a block's content.
 */
export function runCodeAudit(params: {
  content: string;
  language?: string;
  path?: string;
  blockId?: string;
  projectContext?: CodeAuditProjectContext;
}): CodeAuditResult {
  const { content, path, blockId, projectContext } = params;
  const lang = resolveAuditLanguage(params.language, path);
  const contentHash = computeContentHash(content);
  const findings: AuditFinding[] = [];
  const knowledgeGaps: AuditKnowledgeGap[] = [];
  const lineStarts = getLineStarts(content);
  const lines = content.split('\n');
  const normalizedPath = normalizePosixPath(path || 'untitled');
  const baseName = normalizedPath.split('/').pop()?.toLowerCase() || '';

  // 1. Line-by-line security, conflict-marker, and suspicious-construct checks
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineNumber = i + 1;
    const lineFrom = lineStarts[i];
    const lineTo = lineFrom + lineText.length;
    const trimmed = lineText.trim();

    if (/^(<{7}|={7}|>{7})/.test(trimmed)) {
      findings.push({
        id: createId(),
        severity: 'error',
        category: 'syntax',
        ruleId: 'merge-conflict',
        message: 'Unresolved merge conflict marker detected.',
        file: path,
        blockId,
        fixable: true,
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
        category: 'security',
        ruleId: 'secret-exposure',
        message: 'Potential private key or raw API token detected in code.',
        file: path,
        blockId,
        fixable: true,
        suggestion: 'Replace hardcoded secret with an environment variable reference.',
        line: lineNumber,
        column: 1,
        endLine: lineNumber,
        endColumn: lineText.length + 1,
        from: lineFrom,
        to: lineTo,
      });
    }

    if (
      lang !== 'markdown' &&
      lang !== 'text' &&
      lang !== 'json' &&
      lang !== 'gitignore' &&
      lang !== 'requirements'
    ) {
      const isCommentLine =
        trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#');
      if (!isCommentLine) {
        const evalMatch = /\beval\s*\(/.exec(lineText);
        if (evalMatch) {
          const from = lineFrom + evalMatch.index;
          findings.push({
            id: createId(),
            severity: 'warning',
            category: 'security',
            ruleId: 'no-eval',
            message: 'Avoid using eval(); it introduces runtime security and scoping risks.',
            file: path,
            blockId,
            line: lineNumber,
            column: evalMatch.index + 1,
            endLine: lineNumber,
            endColumn: evalMatch.index + evalMatch[0].length + 1,
            from,
            to: from + evalMatch[0].length,
          });
        }

        const dbgMatch = /\bdebugger\b/.exec(lineText);
        if (dbgMatch) {
          const from = lineFrom + dbgMatch.index;
          findings.push({
            id: createId(),
            severity: 'warning',
            category: 'semantic',
            ruleId: 'no-debugger',
            message: 'Remove leftover debugger statement before promoting.',
            file: path,
            blockId,
            fixable: true,
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
  }

  // 2. Strict JSON parse + package.json structural checks
  if (lang === 'json' && content.trim().length > 0) {
    let parsedJson: unknown = undefined;
    let jsonValid = false;
    try {
      parsedJson = JSON.parse(content);
      jsonValid = true;
    } catch (err) {
      const msg = (err as Error).message || 'Invalid JSON syntax';
      const posMatch = /position\s+(\d+)/i.exec(msg);
      const offset = posMatch ? Math.min(Number(posMatch[1]), content.length) : 0;
      const loc = offsetToLineCol(offset, lineStarts);
      findings.push({
        id: createId(),
        severity: 'error',
        category: 'syntax',
        ruleId: 'json-parse-error',
        message: msg,
        file: path,
        blockId,
        fixable: true,
        line: loc.line,
        column: loc.column,
        endLine: loc.line,
        endColumn: loc.column + 1,
        from: offset,
        to: Math.min(content.length, Math.max(offset + 1, offset)),
      });
    }

    if (jsonValid && baseName === 'package.json') {
      if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
        findings.push({
          id: createId(),
          severity: 'error',
          category: 'structure',
          ruleId: 'package-json-not-object',
          message: 'package.json root value must be a JSON object.',
          file: path,
          blockId,
          line: 1,
          column: 1,
        });
      } else {
        const pkg = parsedJson as Record<string, unknown>;
        if (typeof pkg.name !== 'string' || !pkg.name.trim()) {
          findings.push({
            id: createId(),
            severity: 'error',
            category: 'structure',
            ruleId: 'package-json-missing-name',
            message: 'package.json is missing a valid "name" string field.',
            file: path,
            blockId,
            fixable: true,
            line: 1,
            column: 1,
          });
        }
        if (typeof pkg.version !== 'string' || !pkg.version.trim()) {
          findings.push({
            id: createId(),
            severity: 'warning',
            category: 'structure',
            ruleId: 'package-json-missing-version',
            message: 'package.json is missing a "version" field (recommended e.g. "0.1.0").',
            file: path,
            blockId,
            fixable: true,
            line: 1,
            column: 1,
          });
        }
        if (
          pkg.scripts !== undefined &&
          (typeof pkg.scripts !== 'object' || pkg.scripts === null || Array.isArray(pkg.scripts))
        ) {
          findings.push({
            id: createId(),
            severity: 'error',
            category: 'structure',
            ruleId: 'package-json-invalid-scripts',
            message: 'package.json "scripts" must be a key-value object.',
            file: path,
            blockId,
            line: 1,
            column: 1,
          });
        }
        if (
          typeof pkg.main === 'string' &&
          pkg.main.trim() &&
          projectContext &&
          projectContext.allPaths.length > 0
        ) {
          const rawMain = pkg.main.trim();
          const normalizedMain =
            rawMain.startsWith('./') || rawMain.startsWith('../') ? rawMain : `./${rawMain}`;
          const mainRes = resolveRelativeProjectPath(
            normalizedPath,
            normalizedMain,
            projectContext.allPaths
          );
          if (!mainRes.resolved) {
            findings.push({
              id: createId(),
              severity: 'warning',
              category: 'structure',
              ruleId: 'package-json-missing-entry',
              message: mainRes.bestCandidate
                ? `package.json "main" entry "${rawMain}" was not found (matching file exists at "${mainRes.bestCandidate}").`
                : `package.json "main" entry "${rawMain}" does not exist in live project files.`,
              file: path,
              blockId,
              fixable: Boolean(mainRes.bestCandidate),
              suggestion: mainRes.bestCandidate
                ? `Update "main" to "${mainRes.bestCandidate}".`
                : undefined,
              line: 1,
              column: 1,
            });
          }
        }
      }
    }
  }

  // 3. Cargo.toml & TOML structural validation
  if (baseName === 'cargo.toml' || lang === 'toml') {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('[') && !trimmed.endsWith(']')) {
        findings.push({
          id: createId(),
          severity: 'error',
          category: 'syntax',
          ruleId: 'toml-unclosed-section',
          message: 'Unclosed TOML table header (missing closing "]").',
          file: path,
          blockId,
          fixable: true,
          line: i + 1,
          column: 1,
          from: lineStarts[i],
          to: lineStarts[i] + lines[i].length,
        });
      }
    }
    if (baseName === 'cargo.toml' && content.trim().length > 0) {
      if (!/^\s*\[package\]/m.test(content)) {
        findings.push({
          id: createId(),
          severity: 'error',
          category: 'structure',
          ruleId: 'cargo-missing-package',
          message: 'Cargo.toml is missing required [package] section.',
          file: path,
          blockId,
          fixable: true,
          line: 1,
          column: 1,
        });
      } else {
        if (!/^\s*name\s*=\s*"[^"]+"/m.test(content)) {
          findings.push({
            id: createId(),
            severity: 'error',
            category: 'structure',
            ruleId: 'cargo-missing-name',
            message: 'Cargo.toml [package] is missing a quoted name = "...".',
            file: path,
            blockId,
            fixable: true,
            line: 1,
            column: 1,
          });
        }
        if (!/^\s*version\s*=\s*"[^"]+"/m.test(content)) {
          findings.push({
            id: createId(),
            severity: 'warning',
            category: 'structure',
            ruleId: 'cargo-missing-version',
            message: 'Cargo.toml [package] is missing version = "0.1.0".',
            file: path,
            blockId,
            fixable: true,
            line: 1,
            column: 1,
          });
        }
      }
    }
  }

  // 4. requirements.txt validation
  if (lang === 'requirements' || baseName === 'requirements.txt') {
    const seenPackages = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      if (/\s*=>\s*/.test(trimmed)) {
        findings.push({
          id: createId(),
          severity: 'error',
          category: 'syntax',
          ruleId: 'requirements-invalid-operator',
          message: 'Invalid version operator "=>" in requirements.txt (did you mean ">="?).',
          file: path,
          blockId,
          fixable: true,
          line: i + 1,
          column: 1,
          from: lineStarts[i],
          to: lineStarts[i] + raw.length,
        });
      }
      const pkgNameMatch = /^([A-Za-z0-9_.-]+)/.exec(trimmed);
      if (pkgNameMatch) {
        const pkg = pkgNameMatch[1].toLowerCase();
        if (seenPackages.has(pkg)) {
          findings.push({
            id: createId(),
            severity: 'warning',
            category: 'structure',
            ruleId: 'requirements-duplicate-pkg',
            message: `Duplicate package entry "${pkgNameMatch[1]}" in requirements.txt.`,
            file: path,
            blockId,
            fixable: true,
            line: i + 1,
            column: 1,
            from: lineStarts[i],
            to: lineStarts[i] + raw.length,
          });
        }
        seenPackages.add(pkg);
      }
    }
  }

  // 5. Python syntax, indentation, and colon checks
  if (lang === 'python') {
    const { unbalanced } = hasUnbalancedDelimiters(content);
    if (unbalanced) {
      findings.push({
        id: createId(),
        severity: 'error',
        category: 'syntax',
        ruleId: 'py-unbalanced-delimiters',
        message: 'Unclosed parentheses, brackets, braces, or string literal in Python file.',
        file: path,
        blockId,
        fixable: true,
        line: lines.length,
        column: 1,
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const trimmed = lineText.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (/^\t+ +|^ +\t+/.test(lineText) || /^\t/.test(lineText)) {
        findings.push({
          id: createId(),
          severity: 'error',
          category: 'syntax',
          ruleId: 'py-mixed-indent',
          message: 'Tab indentation detected in Python (use 4 spaces for PEP 8 consistency).',
          file: path,
          blockId,
          fixable: true,
          line: i + 1,
          column: 1,
          from: lineStarts[i],
          to: lineStarts[i] + lineText.length,
        });
      }

      // Header statements missing trailing ':' (only single-line headers without unclosed '(')
      const headerMatch = /^(?:async\s+)?(def|class|if|elif|else|for|while|try|except|finally|with)\b(.*)$/.exec(
        trimmed
      );
      if (headerMatch) {
        const codeOnly = trimmed.replace(/#.*$/, '').trimEnd();
        const openParens = (codeOnly.match(/\(/g) || []).length;
        const closeParens = (codeOnly.match(/\)/g) || []).length;
        if (openParens === closeParens && !codeOnly.endsWith(':') && !codeOnly.endsWith('\\')) {
          findings.push({
            id: createId(),
            severity: 'error',
            category: 'syntax',
            ruleId: 'py-missing-colon',
            message: `Missing trailing ":" on Python ${headerMatch[1]} statement.`,
            file: path,
            blockId,
            fixable: true,
            line: i + 1,
            column: lineText.length,
            from: lineStarts[i],
            to: lineStarts[i] + lineText.length,
          });
        }
      }
    }
  }

  // 6. JS / JSX / TS / TSX semantic, syntax & cross-file import checks
  if (
    lang === 'javascript' ||
    lang === 'typescript' ||
    lang === 'jsx' ||
    lang === 'tsx'
  ) {
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const trimmed = lineText.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      // const declaration missing initializer (excluding declare const / for-of / for-in)
      const constMatch = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?;\s*(?:\/\/.*)?$/.exec(
        lineText
      );
      if (constMatch && !/\bdeclare\b/.test(lineText)) {
        findings.push({
          id: createId(),
          severity: 'error',
          category: 'syntax',
          ruleId: 'const-no-init',
          message: `Missing initializer in const declaration "${constMatch[1]}".`,
          file: path,
          blockId,
          fixable: true,
          suggestion: `Change "const ${constMatch[1]}" to "let ${constMatch[1]}" or initialize it.`,
          line: i + 1,
          column: 1,
          from: lineStarts[i],
          to: lineStarts[i] + lineText.length,
        });
      }

      // Accidental assignment in if (a = b)
      const assignCondMatch = /\bif\s*\(\s*([A-Za-z_$][\w$]*)\s*=\s*([^=][^)]*)\)/.exec(
        lineText
      );
      if (assignCondMatch) {
        const from = lineStarts[i] + assignCondMatch.index;
        findings.push({
          id: createId(),
          severity: 'warning',
          category: 'semantic',
          ruleId: 'assignment-in-condition',
          message: `Possible accidental assignment "${assignCondMatch[1]} = ..." inside if() condition.`,
          file: path,
          blockId,
          fixable: true,
          suggestion: 'Use "===" comparison instead of "=" assignment.',
          line: i + 1,
          column: assignCondMatch.index + 1,
          from,
          to: from + assignCondMatch[0].length,
        });
      }

      // Cross-file import / require validation when projectContext is provided
      if (projectContext && projectContext.allPaths.length > 0) {
        const importRegex =
          /(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
        let match: RegExpExecArray | null;
        while ((match = importRegex.exec(lineText)) !== null) {
          const specifier = match[1];
          const from = lineStarts[i] + match.index;
          if (specifier.startsWith('./') || specifier.startsWith('../')) {
            const resolution = resolveRelativeProjectPath(
              normalizedPath,
              specifier,
              projectContext.allPaths
            );
            if (!resolution.resolved) {
              findings.push({
                id: createId(),
                severity: 'error',
                category: 'imports',
                ruleId: 'missing-relative-import',
                message: resolution.bestCandidate
                  ? `Broken relative import "${specifier}" (matching project file exists at "${resolution.bestCandidate}").`
                  : `Cannot resolve relative import "${specifier}" in current project structure.`,
                file: path,
                blockId,
                fixable: Boolean(resolution.bestCandidate),
                suggestion: resolution.bestCandidate
                  ? `Update import path to "${resolution.bestCandidate}".`
                  : undefined,
                line: i + 1,
                column: match.index + 1,
                from,
                to: from + match[0].length,
              });
            }
          } else if (
            projectContext.declaredDependencies &&
            !specifier.startsWith('node:') &&
            !specifier.startsWith('@/')
          ) {
            const pkgName = getPackageBaseName(specifier);
            if (
              !NODE_BUILTINS.has(pkgName) &&
              !projectContext.declaredDependencies.includes(pkgName)
            ) {
              findings.push({
                id: createId(),
                severity: 'warning',
                category: 'imports',
                ruleId: 'undeclared-dependency',
                message: `Package "${pkgName}" is imported but not declared in package.json dependencies.`,
                file: path,
                blockId,
                suggestion: `Add "${pkgName}" to package.json dependencies or replace the import.`,
                line: i + 1,
                column: match.index + 1,
                from,
                to: from + match[0].length,
              });
            }
          }
        }
      }
    }
  }

  // 7. HTML structural & relative asset checks
  if (lang === 'html' && content.trim().length > 0) {
    if (baseName === 'index.html' && !/<!doctype\s+html>/i.test(content)) {
      findings.push({
        id: createId(),
        severity: 'warning',
        category: 'structure',
        ruleId: 'html-missing-doctype',
        message: 'index.html is missing a <!DOCTYPE html> declaration.',
        file: path,
        blockId,
        fixable: true,
        line: 1,
        column: 1,
      });
    }

    const scriptOpens = (content.match(/<script\b[^>]*>/gi) || []).length;
    const scriptCloses = (content.match(/<\/script>/gi) || []).length;
    if (scriptOpens > scriptCloses) {
      findings.push({
        id: createId(),
        severity: 'error',
        category: 'syntax',
        ruleId: 'html-unclosed-script',
        message: 'Unclosed <script> tag in HTML document.',
        file: path,
        blockId,
        fixable: true,
        line: lines.length,
        column: 1,
      });
    }

    if (projectContext && projectContext.allPaths.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        const assetRegex = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
        let m: RegExpExecArray | null;
        while ((m = assetRegex.exec(lineText)) !== null) {
          const ref = m[1];
          if (
            !ref ||
            ref.startsWith('#') ||
            ref.startsWith('http://') ||
            ref.startsWith('https://') ||
            ref.startsWith('data:') ||
            ref.startsWith('mailto:')
          ) {
            continue;
          }
          const normalizedRef = ref.startsWith('./') || ref.startsWith('../') ? ref : `./${ref}`;
          const res = resolveRelativeProjectPath(
            normalizedPath,
            normalizedRef,
            projectContext.allPaths
          );
          if (!res.resolved) {
            findings.push({
              id: createId(),
              severity: 'error',
              category: 'imports',
              ruleId: 'missing-asset-ref',
              message: res.bestCandidate
                ? `Missing local asset reference "${ref}" (matching file found at "${res.bestCandidate}").`
                : `Referenced local file "${ref}" does not exist in project structure.`,
              file: path,
              blockId,
              fixable: Boolean(res.bestCandidate),
              line: i + 1,
              column: m.index + 1,
              from: lineStarts[i] + m.index,
              to: lineStarts[i] + m.index + m[0].length,
            });
          }
        }
      }
    }
  }

  // 8. Real Lezer incremental syntax tree check (JS, JSX, TS, TSX, HTML, CSS, JSON)
  const parser = getParserForLanguage(lang);
  if (parser && content.trim().length > 0) {
    const tree = parser.parse(content);
    const cursor = tree.cursor();
    const seenErrorLines = new Set<number>();
    const balance = hasUnbalancedDelimiters(content);

    do {
      if (cursor.type.isError) {
        const from = cursor.from;
        const to = Math.max(cursor.to, Math.min(content.length, from + 1));
        const startLoc = offsetToLineCol(from, lineStarts);
        const endLoc = offsetToLineCol(to, lineStarts);

        if (seenErrorLines.has(startLoc.line)) continue;
        if (
          lang === 'json' &&
          findings.some((f) => f.ruleId === 'json-parse-error' && f.line === startLoc.line)
        ) {
          continue;
        }
        if (
          findings.some(
            (f) => f.ruleId === 'merge-conflict' && f.line === startLoc.line
          )
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
          category: 'syntax',
          ruleId: 'syntax-error',
          message: contextDesc,
          file: path,
          blockId,
          fixable: balance.unbalanced && Boolean(balance.missingClosers),
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

  // 9. Explicit Knowledge Gap Recognition
  const ext = baseName.includes('.') ? baseName.split('.').pop() || '' : '';
  const specialized = SPECIALIZED_LANGUAGES[ext];
  if (specialized && content.trim().length > 0) {
    knowledgeGaps.push({
      id: createId(),
      blockId,
      file: path || normalizedPath,
      language: specialized.label,
      frameworkOrTopic: specialized.topic,
      reason: specialized.reason,
      suggestedQuery: `${specialized.label} ${baseName} syntax reference common errors`,
    });
  } else if (
    !parser &&
    lang !== 'markdown' &&
    lang !== 'text' &&
    lang !== 'gitignore' &&
    lang !== 'requirements' &&
    lang !== 'toml' &&
    content.trim().length > 0
  ) {
    knowledgeGaps.push({
      id: createId(),
      blockId,
      file: path || normalizedPath,
      language: lang,
      frameworkOrTopic: `${lang} file format and syntax rules`,
      reason: `No local AST parser is configured for "${lang}" files.`,
      suggestedQuery: `${lang} ${baseName} file syntax specification`,
    });
  }

  // 10. Static logic, compile-parse & safe testability verification
  const preVerifyErrors = findings.filter((f) => f.severity === 'error').length;
  const verifyResult = verifyCodeTestability({
    content,
    language: lang,
    path,
    blockId,
    existingErrorCount: preVerifyErrors,
  });

  for (const vf of verifyResult.findings) {
    const duplicate = findings.some(
      (f) => f.ruleId === vf.ruleId && (f.line ?? 0) === (vf.line ?? 0)
    );
    if (!duplicate) {
      findings.push(vf);
    }
  }

  // Sort findings by line then column
  findings.sort((a, b) => {
    const lineDiff = (a.line ?? 0) - (b.line ?? 0);
    if (lineDiff !== 0) return lineDiff;
    return (a.column ?? 0) - (b.column ?? 0);
  });

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const passed = errorCount === 0;
  const testable = passed && verifyResult.verification.compiledCleanly;

  return {
    passed,
    testable,
    errorCount,
    warningCount,
    findings,
    knowledgeGaps,
    language: lang,
    contentHash,
    verification: verifyResult.verification,
  };
}
