import { findDangerousInstallScriptsInPackageJson } from './securityGuards';
import type {
  DependencyRecord,
  DeterministicAnalysis,
  IngestResult,
  LanguageStat,
  ManifestEntry,
  ProjectHygieneSignals,
} from '../types/pipeline';

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.pyw': 'Python',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.sass': 'CSS',
  '.less': 'CSS',
  '.gd': 'GDScript',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.svelte': 'Svelte',
  '.vue': 'Vue',
  '.astro': 'Astro',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.md': 'Markdown',
};

const CODE_EXTENSIONS_FOR_PRIMARY = new Set<string>([
  'TypeScript',
  'JavaScript',
  'Python',
  'HTML',
  'CSS',
  'GDScript',
  'Go',
  'Rust',
  'Java',
  'Kotlin',
  'C#',
  'Ruby',
  'PHP',
  'Svelte',
  'Vue',
  'Astro',
]);

const ENTRY_POINT_FILENAMES = new Set<string>([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'pipfile',
  'cargo.toml',
  'go.mod',
  'project.godot',
  'index.html',
  'manifest.json',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'server.ts',
  'server.js',
  'app.py',
  'main.py',
  'manage.py',
  'main.go',
]);

const ENTRY_POINT_EXACT_PATHS = new Set<string>([
  'src/main.ts',
  'src/main.tsx',
  'src/main.js',
  'src/main.jsx',
  'src/index.ts',
  'src/index.tsx',
  'src/index.js',
  'src/index.jsx',
  'src/app.tsx',
  'src/app.jsx',
  'src/app.ts',
  'src/app.js',
  'src/main.rs',
  'app/page.tsx',
  'app/page.jsx',
  'app/layout.tsx',
]);

const CONFIG_FILENAMES = new Set<string>([
  'tsconfig.json',
  'jsconfig.json',
  'manifest.json',
  'project.godot',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'pyproject.toml',
  'pytest.ini',
  'openapi.json',
  'openapi.yaml',
  'openapi.yml',
  'swagger.json',
  'eslint.config.js',
  'eslint.config.mjs',
  '.eslintrc.json',
  '.prettierrc',
]);

const LOCKFILE_NAMES = new Set<string>([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'poetry.lock',
  'uv.lock',
  'pipfile.lock',
  'cargo.lock',
  'go.sum',
]);

const CODE_PATTERN_PROBES: readonly string[] = [
  'requestAnimationFrame',
  "getContext('2d')",
  'getContext("2d")',
  'AudioContext',
  'webkitAudioContext',
  'Gamepad',
  'webgl',
  'Phaser.Game',
  'PIXI.Application',
  'new Application(',
  '<canvas',
  'document.querySelector',
  'customElements.define',
  'createRoot(',
  'ReactDOM',
  'createApp(',
  '@import "tailwindcss"',
  'media (max-width',
  'app.get(',
  'app.post(',
  'router.get(',
  'router.post(',
  'FastAPI(',
  '@app.route(',
  '@Get(',
  'http.createServer',
  '/health',
  'express()',
];

function getBaseName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

function getExtension(filePath: string): string {
  const base = getBaseName(filePath).toLowerCase();
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return '';
  return base.slice(idx);
}

/**
 * Strip a single top-level wrapper folder if the entire zip was packed inside e.g. `my-app/package.json`.
 */
function stripOptionalRootPrefix(manifest: ManifestEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  if (manifest.length === 0) return map;

  const firstSegs = new Set(manifest.map((m) => m.path.split('/')[0]));
  const allNestedUnderSingleDir =
    firstSegs.size === 1 && manifest.every((m) => m.path.includes('/'));

  for (const m of manifest) {
    const logical = allNestedUnderSingleDir ? m.path.split('/').slice(1).join('/') : m.path;
    map.set(m.path, logical);
  }
  return map;
}

function parsePackageJson(content: string, sourceFile: string): {
  deps: DependencyRecord[];
  scripts: Record<string, string>;
  packageManagerField: string | null;
} {
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      scripts?: Record<string, unknown>;
      packageManager?: unknown;
    };
    const deps: DependencyRecord[] = [];

    if (parsed.dependencies && typeof parsed.dependencies === 'object') {
      for (const [name, version] of Object.entries(parsed.dependencies)) {
        deps.push({
          name,
          version: typeof version === 'string' ? version : '*',
          scope: 'runtime',
          sourceFile,
        });
      }
    }
    if (parsed.devDependencies && typeof parsed.devDependencies === 'object') {
      for (const [name, version] of Object.entries(parsed.devDependencies)) {
        deps.push({
          name,
          version: typeof version === 'string' ? version : '*',
          scope: 'dev',
          sourceFile,
        });
      }
    }

    const scripts: Record<string, string> = {};
    if (parsed.scripts && typeof parsed.scripts === 'object') {
      for (const [k, v] of Object.entries(parsed.scripts)) {
        if (typeof v === 'string') scripts[k] = v;
      }
    }

    const packageManagerField =
      typeof parsed.packageManager === 'string' ? parsed.packageManager : null;

    return { deps, scripts, packageManagerField };
  } catch {
    return { deps: [], scripts: {}, packageManagerField: null };
  }
}

function parseRequirementsTxt(content: string, sourceFile: string): DependencyRecord[] {
  const deps: DependencyRecord[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue;
    const match = /^([A-Za-z0-9_.\-\[\]]+)\s*([=<>!~].*)?$/.exec(line);
    if (match) {
      deps.push({
        name: match[1].toLowerCase(),
        version: (match[2] ?? '*').trim() || '*',
        scope: 'runtime',
        sourceFile,
      });
    }
  }
  return deps;
}

function parsePyprojectToml(content: string, sourceFile: string): DependencyRecord[] {
  const deps: DependencyRecord[] = [];
  const lines = content.split(/\r?\n/);
  let inDependenciesArray = false;
  let inPoetryDeps = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('[')) {
      inDependenciesArray = false;
      inPoetryDeps = trimmed === '[tool.poetry.dependencies]';
      continue;
    }

    if (/^dependencies\s*=\s*\[/.test(trimmed)) {
      inDependenciesArray = !trimmed.includes(']');
      const inlineMatches = trimmed.match(/['"]([A-Za-z0-9_.\-]+)([^'"]*)['"]/g) ?? [];
      for (const item of inlineMatches) {
        const clean = item.slice(1, -1);
        const m = /^([A-Za-z0-9_.\-\[\]]+)\s*(.*)$/.exec(clean);
        if (m) {
          deps.push({
            name: m[1].toLowerCase(),
            version: m[2].trim() || '*',
            scope: 'runtime',
            sourceFile,
          });
        }
      }
      continue;
    }

    if (inDependenciesArray) {
      if (trimmed.includes(']')) inDependenciesArray = false;
      const m = /['"]([A-Za-z0-9_.\-\[\]]+)\s*([^'"]*)['"]/.exec(trimmed);
      if (m) {
        deps.push({
          name: m[1].toLowerCase(),
          version: m[2].trim() || '*',
          scope: 'runtime',
          sourceFile,
        });
      }
      continue;
    }

    if (inPoetryDeps) {
      const m = /^([A-Za-z0-9_.\-]+)\s*=\s*(.+)$/.exec(trimmed);
      if (m && m[1].toLowerCase() !== 'python') {
        deps.push({
          name: m[1].toLowerCase(),
          version: m[2].replace(/['"]/g, '').trim() || '*',
          scope: 'runtime',
          sourceFile,
        });
      }
    }
  }

  return deps;
}

function parseCargoToml(content: string, sourceFile: string): DependencyRecord[] {
  const deps: DependencyRecord[] = [];
  let section: 'none' | 'deps' | 'dev' = 'none';
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) {
      if (trimmed === '[dependencies]') section = 'deps';
      else if (trimmed === '[dev-dependencies]') section = 'dev';
      else section = 'none';
      continue;
    }
    if (section === 'none') continue;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (m) {
      deps.push({
        name: m[1],
        version: m[2].replace(/['"]/g, '').trim(),
        scope: section === 'dev' ? 'dev' : 'runtime',
        sourceFile,
      });
    }
  }
  return deps;
}

export function runDeterministicAnalysis(ingest: IngestResult): DeterministicAnalysis {
  const logicalPaths = stripOptionalRootPrefix(ingest.manifest);
  const nonIgnoredEntries = ingest.manifest.filter(
    (entry) => entry.analysisStatus !== 'ignored-dir' && entry.analysisStatus !== 'build-output'
  );

  // 1. Languages by extension
  const langCounts = new Map<string, { count: number; exts: Set<string> }>();
  const assetExtensionsSet = new Set<string>();
  let totalLangFiles = 0;

  for (const entry of nonIgnoredEntries) {
    const ext = getExtension(entry.path);
    if (entry.isBinary && ext) {
      assetExtensionsSet.add(ext);
    } else if (
      ext &&
      ['.svg', '.tmx', '.tmj', '.fnt', '.atlas', '.sql', '.prisma', '.proto'].includes(ext)
    ) {
      assetExtensionsSet.add(ext);
    }

    const lang = EXTENSION_LANGUAGE_MAP[ext];
    if (lang) {
      totalLangFiles += 1;
      const current = langCounts.get(lang) ?? { count: 0, exts: new Set<string>() };
      current.count += 1;
      current.exts.add(ext);
      langCounts.set(lang, current);
    }
  }

  const languages: LanguageStat[] = Array.from(langCounts.entries())
    .map(([language, data]) => ({
      language,
      fileCount: data.count,
      percentage: totalLangFiles > 0 ? Number(((data.count / totalLangFiles) * 100).toFixed(1)) : 0,
      extensions: Array.from(data.exts).sort(),
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.language.localeCompare(b.language));

  const primaryLanguage =
    languages.find((l) => CODE_EXTENSIONS_FOR_PRIMARY.has(l.language))?.language ??
    languages[0]?.language ??
    null;

  // 2. Entry points, configs, lockfiles, tests, CI, README, LICENSE, .env.example
  const entryPoints = new Set<string>();
  const manifestFiles = new Set<string>();
  const configFiles = new Set<string>();
  const lockfilePaths = new Set<string>();
  const testPaths = new Set<string>();
  const ciPaths = new Set<string>();
  const readmePaths = new Set<string>();
  const licensePaths = new Set<string>();
  const envExamplePaths = new Set<string>();
  const packageManagers = new Set<string>();

  for (const entry of nonIgnoredEntries) {
    const logical = logicalPaths.get(entry.path) ?? entry.path;
    const logicalLower = logical.toLowerCase();
    const base = getBaseName(logical);
    const baseLower = base.toLowerCase();

    if (ENTRY_POINT_FILENAMES.has(baseLower) || ENTRY_POINT_EXACT_PATHS.has(logicalLower)) {
      entryPoints.add(entry.path);
    }

    if (
      baseLower === 'package.json' ||
      baseLower === 'requirements.txt' ||
      baseLower === 'pyproject.toml' ||
      baseLower === 'cargo.toml' ||
      baseLower === 'go.mod' ||
      baseLower === 'project.godot' ||
      baseLower === 'manifest.json'
    ) {
      manifestFiles.add(entry.path);
    }

    if (
      CONFIG_FILENAMES.has(baseLower) ||
      baseLower.startsWith('vite.config.') ||
      baseLower.startsWith('webpack.config.') ||
      baseLower.startsWith('rollup.config.') ||
      baseLower.startsWith('tailwind.config.') ||
      baseLower.startsWith('next.config.') ||
      baseLower.startsWith('astro.config.') ||
      baseLower.startsWith('svelte.config.') ||
      baseLower.startsWith('vitest.config.') ||
      baseLower.startsWith('jest.config.') ||
      baseLower.startsWith('playwright.config.')
    ) {
      configFiles.add(entry.path);
    }

    if (LOCKFILE_NAMES.has(baseLower)) {
      lockfilePaths.add(entry.path);
      if (baseLower === 'package-lock.json') packageManagers.add('npm');
      if (baseLower === 'pnpm-lock.yaml') packageManagers.add('pnpm');
      if (baseLower === 'yarn.lock') packageManagers.add('yarn');
      if (baseLower === 'bun.lock' || baseLower === 'bun.lockb') packageManagers.add('bun');
      if (baseLower === 'poetry.lock') packageManagers.add('poetry');
      if (baseLower === 'uv.lock') packageManagers.add('uv');
      if (baseLower === 'pipfile.lock') packageManagers.add('pipenv');
      if (baseLower === 'cargo.lock') packageManagers.add('cargo');
      if (baseLower === 'go.sum') packageManagers.add('go');
    }

    if (
      /(?:^|\/)(?:tests?|__tests__|spec|e2e)\//.test(logicalLower) ||
      /\.(?:test|spec)\.[a-z0-9]+$/i.test(baseLower) ||
      /^test_.*\.py$/i.test(baseLower) ||
      /_test\.(?:py|go)$/i.test(baseLower)
    ) {
      testPaths.add(entry.path);
    }

    if (
      /^\.github\/workflows\/[^/]+\.(?:yml|yaml)$/.test(logicalLower) ||
      logicalLower === '.gitlab-ci.yml' ||
      logicalLower === '.circleci/config.yml' ||
      baseLower === 'jenkinsfile' ||
      logicalLower === 'azure-pipelines.yml'
    ) {
      ciPaths.add(entry.path);
    }

    if (/^readme(?:\.[a-z0-9]+)?$/i.test(baseLower)) {
      readmePaths.add(entry.path);
    }

    if (/^(?:license|licence|copying)(?:\.[a-z0-9]+)?$/i.test(baseLower)) {
      licensePaths.add(entry.path);
    }

    if (
      baseLower === '.env.example' ||
      baseLower === '.env.sample' ||
      baseLower === '.env.template'
    ) {
      envExamplePaths.add(entry.path);
    }
  }

  // 3. Parse dependencies & scripts
  const dependencies: DependencyRecord[] = [];
  let packageJsonScripts: Record<string, string> = {};
  const detectedInstallScripts: Array<{ file: string; scriptName: string; command: string }> = [];

  for (const [path, textEntry] of Object.entries(ingest.textFiles)) {
    const baseLower = getBaseName(path).toLowerCase();
    if (baseLower === 'package.json') {
      const parsed = parsePackageJson(textEntry.content, path);
      dependencies.push(...parsed.deps);
      if (Object.keys(packageJsonScripts).length === 0) {
        packageJsonScripts = parsed.scripts;
      }
      for (const hit of findDangerousInstallScriptsInPackageJson(textEntry.content)) {
        detectedInstallScripts.push({
          file: path,
          scriptName: hit.scriptName,
          command: hit.command,
        });
      }
      if (parsed.packageManagerField) {
        const pmName = parsed.packageManagerField.split('@')[0];
        if (pmName) packageManagers.add(pmName);
      } else if (packageManagers.size === 0) {
        packageManagers.add('npm');
      }
    } else if (baseLower === 'requirements.txt') {
      dependencies.push(...parseRequirementsTxt(textEntry.content, path));
      packageManagers.add('pip');
    } else if (baseLower === 'pyproject.toml') {
      dependencies.push(...parsePyprojectToml(textEntry.content, path));
      if (!packageManagers.has('poetry') && !packageManagers.has('uv')) {
        packageManagers.add('pip / pyproject');
      }
    } else if (baseLower === 'cargo.toml') {
      dependencies.push(...parseCargoToml(textEntry.content, path));
      packageManagers.add('cargo');
    } else if (baseLower === 'go.mod') {
      packageManagers.add('go');
    } else if (baseLower === 'project.godot') {
      packageManagers.add('godot');
    }
  }

  // 4. Frameworks & bundlers
  const depNames = new Set(dependencies.map((d) => d.name.toLowerCase()));
  const frameworks = new Set<string>();
  const bundlers = new Set<string>();

  if (depNames.has('phaser')) frameworks.add('Phaser');
  if (depNames.has('pixi.js') || depNames.has('pixijs')) frameworks.add('PixiJS');
  if (depNames.has('kaplay') || depNames.has('kaboom')) frameworks.add('KAPLAY / Kaboom');
  if (depNames.has('littlejsengine')) frameworks.add('LittleJS');
  if (depNames.has('pygame')) frameworks.add('Pygame');
  if (depNames.has('next')) frameworks.add('Next.js');
  if (depNames.has('react') || depNames.has('react-dom')) frameworks.add('React');
  if (depNames.has('vue')) frameworks.add('Vue');
  if (depNames.has('svelte')) frameworks.add('Svelte');
  if (depNames.has('solid-js')) frameworks.add('SolidJS');
  if (depNames.has('preact')) frameworks.add('Preact');
  if (depNames.has('astro')) frameworks.add('Astro');
  if (depNames.has('express')) frameworks.add('Express');
  if (depNames.has('fastify')) frameworks.add('Fastify');
  if (depNames.has('hono')) frameworks.add('Hono');
  if (depNames.has('@nestjs/core')) frameworks.add('NestJS');
  if (depNames.has('fastapi')) frameworks.add('FastAPI');
  if (depNames.has('flask')) frameworks.add('Flask');
  if (depNames.has('django')) frameworks.add('Django');

  if (Array.from(manifestFiles).some((p) => getBaseName(p).toLowerCase() === 'project.godot')) {
    frameworks.add('Godot');
  }

  if (
    depNames.has('vite') ||
    Array.from(configFiles).some((p) => getBaseName(p).toLowerCase().startsWith('vite.config.'))
  ) {
    bundlers.add('Vite');
  }
  if (
    depNames.has('webpack') ||
    Array.from(configFiles).some((p) => getBaseName(p).toLowerCase().startsWith('webpack.config.'))
  ) {
    bundlers.add('Webpack');
  }
  if (depNames.has('esbuild')) bundlers.add('esbuild');
  if (
    depNames.has('rollup') ||
    Array.from(configFiles).some((p) => getBaseName(p).toLowerCase().startsWith('rollup.config.'))
  ) {
    bundlers.add('Rollup');
  }
  if (depNames.has('parcel')) bundlers.add('Parcel');
  if (depNames.has('tsup')) bundlers.add('tsup');
  if (depNames.has('next')) bundlers.add('Next.js / Turbopack');

  // 5. Code pattern probes across analyzable text files
  const codePatternsMatched = new Set<string>();
  for (const textEntry of Object.values(ingest.textFiles)) {
    const lowerPath = textEntry.path.toLowerCase();
    if (
      lowerPath.endsWith('.md') ||
      lowerPath.endsWith('.txt') ||
      lowerPath.endsWith('.lock') ||
      lowerPath.endsWith('.json')
    ) {
      continue;
    }
    for (const pattern of CODE_PATTERN_PROBES) {
      if (textEntry.content.includes(pattern)) {
        codePatternsMatched.add(pattern);
      }
    }
  }

  // Test runner deps also prove test setup presence if paired with test script or files
  const hasTestRunnerDep =
    depNames.has('vitest') ||
    depNames.has('jest') ||
    depNames.has('@playwright/test') ||
    depNames.has('pytest') ||
    depNames.has('mocha');

  const hygiene: ProjectHygieneSignals = {
    hasTests: testPaths.size > 0 || (hasTestRunnerDep && Boolean(packageJsonScripts.test)),
    testPaths: Array.from(testPaths).sort(),
    hasCI: ciPaths.size > 0,
    ciPaths: Array.from(ciPaths).sort(),
    hasLockfile: lockfilePaths.size > 0,
    lockfilePaths: Array.from(lockfilePaths).sort(),
    hasReadme: readmePaths.size > 0,
    readmePaths: Array.from(readmePaths).sort(),
    hasLicense: licensePaths.size > 0,
    licensePaths: Array.from(licensePaths).sort(),
    hasEnvExample: envExamplePaths.size > 0,
    envExamplePaths: Array.from(envExamplePaths).sort(),
  };

  return {
    analyzedAt: new Date().toISOString(),
    analyzableFileCount: Object.keys(ingest.textFiles).length,
    languages,
    primaryLanguage,
    packageManagers: Array.from(packageManagers).sort(),
    entryPoints: Array.from(entryPoints).sort(),
    manifestFiles: Array.from(manifestFiles).sort(),
    configFiles: Array.from(configFiles).sort(),
    dependencies: dependencies.sort((a, b) => a.name.localeCompare(b.name)),
    frameworks: Array.from(frameworks).sort(),
    bundlers: Array.from(bundlers).sort(),
    hygiene,
    assetExtensionsPresent: Array.from(assetExtensionsSet).sort(),
    codePatternsMatched: Array.from(codePatternsMatched).sort(),
    packageJsonScripts,
    detectedInstallScripts,
  };
}
