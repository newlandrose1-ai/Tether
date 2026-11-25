import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from '@codemirror/lang-javascript';
import { BUILD_OUTPUT_DIRS, IGNORED_DEPENDENCY_AND_VCS_DIRS } from '../config/ingestConfig';
import registryData from '../data/registry.json';
import type { RegistryEntry } from '../types/pipeline';

export const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

export function isIgnoredOrBuildPath(filePath: string): boolean {
  const segments = filePath.split('/');
  const parents = segments.slice(0, -1);
  return parents.some(
    (seg) => IGNORED_DEPENDENCY_AND_VCS_DIRS.has(seg) || BUILD_OUTPUT_DIRS.has(seg)
  );
}

function getBaseNameLower(filePath: string): string {
  return (filePath.split('/').pop() ?? filePath).toLowerCase();
}

function getExtensionLower(filePath: string): string {
  const base = getBaseNameLower(filePath);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx) : '';
}

function stripJsonCommentsForTsConfig(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
}

export function validateJsonContent(filePath: string, content: string): { valid: true } | { valid: false; error: string } {
  const base = getBaseNameLower(filePath);
  try {
    if (/^(?:ts|js)config(?:\.[^.]+)?\.json$/.test(base)) {
      JSON.parse(stripJsonCommentsForTsConfig(content));
    } else {
      JSON.parse(content);
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid JSON syntax',
    };
  }
}

export function isJsOrTsPath(filePath: string): boolean {
  const ext = getExtensionLower(filePath);
  return ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(ext);
}

export function validateJsTsSyntax(
  filePath: string,
  content: string
): { valid: true } | { valid: false; error: string } {
  const ext = getExtensionLower(filePath);
  const lang =
    ext === '.tsx'
      ? tsxLanguage
      : ext === '.ts' || ext === '.mts' || ext === '.cts'
      ? typescriptLanguage
      : ext === '.jsx'
      ? jsxLanguage
      : javascriptLanguage;

  const tree = lang.parser.parse(content);
  let firstErrorFrom: number | null = null;

  tree.cursor().iterate((node) => {
    if (node.type.isError && firstErrorFrom === null) {
      firstErrorFrom = node.from;
      return false;
    }
    return undefined;
  });

  if (firstErrorFrom !== null) {
    const before = content.slice(0, firstErrorFrom);
    const lines = before.split(/\r?\n/);
    const line = lines.length;
    const col = (lines[lines.length - 1]?.length ?? 0) + 1;
    return {
      valid: false,
      error: `Syntax error at line ${line}, column ${col}`,
    };
  }

  return { valid: true };
}

/**
 * Scans raw JSON text for duplicate keys inside `dependencies`, `devDependencies`, `peerDependencies`,
 * and `optionalDependencies` blocks before JSON.parse collapses duplicates.
 */
function findDuplicateKeysInDepBlocks(rawPackageJson: string): string[] {
  const duplicates: string[] = [];
  const blockNames = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

  for (const block of blockNames) {
    const blockRegex = new RegExp(`"${block}"\\s*:\\s*\\{`);
    const match = blockRegex.exec(rawPackageJson);
    if (!match) continue;

    let idx = match.index + match[0].length;
    let depth = 1;
    let inString = false;
    let escaped = false;
    let currentKey = '';
    const seenKeys = new Set<string>();
    let readingKeyAtDepth1 = false;
    let expectingKey = true;

    while (idx < rawPackageJson.length && depth > 0) {
      const ch = rawPackageJson[idx];
      if (inString) {
        if (escaped) {
          escaped = false;
          if (readingKeyAtDepth1) currentKey += ch;
        } else if (ch === '\\') {
          escaped = true;
          if (readingKeyAtDepth1) currentKey += ch;
        } else if (ch === '"') {
          inString = false;
          if (readingKeyAtDepth1) {
            readingKeyAtDepth1 = false;
            // Verify next non-space char is ':'
            let look = idx + 1;
            while (look < rawPackageJson.length && /\s/.test(rawPackageJson[look])) look += 1;
            if (rawPackageJson[look] === ':') {
              if (seenKeys.has(currentKey)) {
                duplicates.push(`${block}: "${currentKey}" appears multiple times`);
              } else {
                seenKeys.add(currentKey);
              }
            }
          }
        } else if (readingKeyAtDepth1) {
          currentKey += ch;
        }
      } else {
        if (ch === '"') {
          inString = true;
          if (depth === 1 && expectingKey) {
            readingKeyAtDepth1 = true;
            currentKey = '';
          }
        } else if (ch === '{' || ch === '[') {
          depth += 1;
          expectingKey = false;
        } else if (ch === '}' || ch === ']') {
          depth -= 1;
        } else if (depth === 1 && ch === ',') {
          expectingKey = true;
        } else if (depth === 1 && ch === ':') {
          expectingKey = false;
        }
      }
      idx += 1;
    }
  }

  return duplicates;
}

export interface DependencyConflictResult {
  passed: boolean;
  issues: string[];
  declaredPackages: Set<string>;
}

export function checkPackageJsonDependencies(
  textFilesByPath: Record<string, string>
): DependencyConflictResult {
  const issues: string[] = [];
  const declaredPackages = new Set<string>();
  const registry = registryData as RegistryEntry[];

  for (const [path, content] of Object.entries(textFilesByPath)) {
    if (isIgnoredOrBuildPath(path)) continue;
    if (getBaseNameLower(path) !== 'package.json') continue;

    // 1. Raw duplicate key scan
    for (const dup of findDuplicateKeysInDepBlocks(content)) {
      issues.push(`${path}: duplicate dependency entry (${dup})`);
    }

    // 2. Cross-section duplicate & registry conflicts_with checks
    try {
      const parsed = JSON.parse(content) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
        peerDependencies?: Record<string, unknown>;
        optionalDependencies?: Record<string, unknown>;
      };

      const runtimeDeps = new Set(Object.keys(parsed.dependencies ?? {}));
      const devDeps = new Set(Object.keys(parsed.devDependencies ?? {}));
      const peerDeps = new Set(Object.keys(parsed.peerDependencies ?? {}));
      const optDeps = new Set(Object.keys(parsed.optionalDependencies ?? {}));

      for (const name of [...runtimeDeps, ...devDeps, ...peerDeps, ...optDeps]) {
        declaredPackages.add(name);
      }

      for (const name of runtimeDeps) {
        if (devDeps.has(name)) {
          issues.push(`${path}: "${name}" is listed in both dependencies and devDependencies`);
        }
      }

      const lowerSet = new Set(Array.from(declaredPackages).map((d) => d.toLowerCase()));
      for (const entry of registry) {
        const pkgLower = entry.package.toLowerCase();
        if (!lowerSet.has(pkgLower)) continue;
        for (const conflict of entry.conflicts_with) {
          const conflictLower = conflict.toLowerCase();
          if (lowerSet.has(conflictLower)) {
            issues.push(
              `${path}: conflicting packages "${entry.package}" and "${conflict}" declared together`
            );
          }
        }
      }
    } catch {
      // JSON parse errors are caught by validateJsonContent
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    declaredPackages,
  };
}

function stripJsCommentsPreserveStrings(code: string): string {
  // Remove // and /* */ comments while leaving quoted strings intact enough for import extraction
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

export function extractImportSpecifiers(code: string): string[] {
  const clean = stripJsCommentsPreserveStrings(code);
  const specifiers = new Set<string>();

  const patterns = [
    // Side-effect import: import './file';
    /(?:^|[\s;{}()])import\s+['"]([^'"]+)['"]/gm,
    // Named / default / namespace import: import x, { y } from 'pkg';
    /(?:^|[\s;{}()])import\s+(?:type\s+)?[^;'"`]+\s+from\s+['"]([^'"]+)['"]/gm,
    // Re-export: export { x } from 'pkg'; / export * from 'pkg';
    /(?:^|[\s;{}()])export\s+(?:type\s+)?[^;'"`]+\s+from\s+['"]([^'"]+)['"]/gm,
    // Dynamic import() / CommonJS require()
    /(?:^|[\s;=(,])(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/gm,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(clean)) !== null) {
      const spec = match[1]?.trim();
      if (spec) specifiers.add(spec);
    }
  }

  return Array.from(specifiers);
}

function resolvePosixPath(baseFilePath: string, relativeSpecifier: string): string {
  const baseParts = baseFilePath.split('/').slice(0, -1);
  const relParts = relativeSpecifier.split('/');
  const out = [...baseParts];

  for (const part of relParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length > 0) out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

function resolveRelativeTargetInFiles(
  resolvedNoTrailingSlash: string,
  allFilePathsSet: Set<string>
): boolean {
  if (allFilePathsSet.has(resolvedNoTrailingSlash)) return true;

  const candidateExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];
  for (const ext of candidateExtensions) {
    if (allFilePathsSet.has(`${resolvedNoTrailingSlash}${ext}`)) return true;
  }

  // Handle TypeScript ESM `.js` import pointing to `.ts` / `.tsx` source
  if (resolvedNoTrailingSlash.endsWith('.js')) {
    const stem = resolvedNoTrailingSlash.slice(0, -3);
    if (
      allFilePathsSet.has(`${stem}.ts`) ||
      allFilePathsSet.has(`${stem}.tsx`) ||
      allFilePathsSet.has(`${stem}.jsx`)
    ) {
      return true;
    }
  }

  const indexCandidates = [
    '/index.ts',
    '/index.tsx',
    '/index.js',
    '/index.jsx',
    '/index.mjs',
  ];
  for (const idxSuffix of indexCandidates) {
    if (allFilePathsSet.has(`${resolvedNoTrailingSlash}${idxSuffix}`)) return true;
  }

  return false;
}

function extractPackageRoot(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0] ?? specifier;
}

export interface ImportResolutionResult {
  passed: boolean;
  unresolvedImports: Array<{ file: string; specifier: string; reason: string }>;
}

export function checkAllImportsResolve(
  textFilesByPath: Record<string, string>,
  allOutputPaths: Set<string>,
  declaredPackages: Set<string>,
  hasPackageJson: boolean
): ImportResolutionResult {
  const unresolvedImports: Array<{ file: string; specifier: string; reason: string }> = [];

  // Collect tsconfig/jsconfig path alias prefixes (e.g. `@/` or `~/`) so aliases aren't flagged as missing packages
  const aliasPrefixes: string[] = [];
  for (const [path, content] of Object.entries(textFilesByPath)) {
    if (/^(?:ts|js)config(?:\.[^.]+)?\.json$/.test(getBaseNameLower(path))) {
      try {
        const parsed = JSON.parse(stripJsonCommentsForTsConfig(content)) as {
          compilerOptions?: { paths?: Record<string, unknown> };
        };
        const pathsObj = parsed.compilerOptions?.paths;
        if (pathsObj && typeof pathsObj === 'object') {
          for (const key of Object.keys(pathsObj)) {
            aliasPrefixes.push(key.replace(/\*$/, ''));
          }
        }
      } catch {
        // ignore invalid tsconfig
      }
    }
  }

  for (const [filePath, content] of Object.entries(textFilesByPath)) {
    if (isIgnoredOrBuildPath(filePath)) continue;
    if (!isJsOrTsPath(filePath)) continue;

    const specifiers = extractImportSpecifiers(content);
    for (const spec of specifiers) {
      if (/^(?:https?:|data:|virtual:|node:)/.test(spec)) continue;

      if (spec.startsWith('./') || spec.startsWith('../')) {
        const resolved = resolvePosixPath(filePath, spec);
        if (!resolveRelativeTargetInFiles(resolved, allOutputPaths)) {
          unresolvedImports.push({
            file: filePath,
            specifier: spec,
            reason: `Relative import "${spec}" does not resolve to any file in the archive.`,
          });
        }
        continue;
      }

      if (spec.startsWith('/') || spec.startsWith('#')) continue;
      if (aliasPrefixes.some((prefix) => spec.startsWith(prefix))) continue;

      const pkgRoot = extractPackageRoot(spec);
      if (NODE_BUILTINS.has(pkgRoot)) continue;

      if (hasPackageJson && !declaredPackages.has(pkgRoot)) {
        unresolvedImports.push({
          file: filePath,
          specifier: spec,
          reason: `Imported package "${pkgRoot}" is not declared in package.json dependencies.`,
        });
      }
    }
  }

  return {
    passed: unresolvedImports.length === 0,
    unresolvedImports,
  };
}
