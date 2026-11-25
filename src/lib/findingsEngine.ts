import licencePolicyData from '../data/licence-policy.json';
import profilesData from '../data/profiles.json';
import registryData from '../data/registry.json';
import {
  GAP_ANALYSIS_PROMPT_VERSION,
  validateGapAnalysisSchemaWithReason,
} from '../ai/prompts/gapAnalysis';
import { chunkRankedFilesForBudget } from './aiChunking';
import {
  MAX_GEMINI_PAYLOAD_CHARS,
  enforceJsonPayloadCharLimit,
  getRegistryPackageSet,
  isCiOrSecretsAdjacentPath,
  sanitizeDiffHeaderPath,
  sanitizeUntrustedDiffBodyLine,
  stripUnsafeControlAndBidiChars,
  validateWriteTargetPath,
} from './securityGuards';
import { NODE_BUILTINS, extractImportSpecifiers } from './staticChecks';
import type {
  DeterministicAnalysis,
  FindingItem,
  FindingSeverity,
  GeminiGapSuggestion,
  IngestResult,
  LicencePolicyRule,
  ProfileId,
  ProposalFileChange,
  ProposalItem,
  RegistryEntry,
  RegistryExclusionNote,
  RiskTier,
} from '../types/pipeline';

interface ProfileChecklistDef {
  id: string;
  label: string;
}

interface ProfileDef {
  id: ProfileId;
  name: string;
  description: string;
  completeness_checklist: ProfileChecklistDef[];
  vertical_slice: string[];
  registry_categories: string[];
}

export function getLoadedLicencePolicies(): LicencePolicyRule[] {
  return licencePolicyData as LicencePolicyRule[];
}

export function getLoadedRegistry(): RegistryEntry[] {
  return registryData as RegistryEntry[];
}

function getProfileDefinition(profileId: ProfileId): ProfileDef {
  const found = (profilesData.profiles as ProfileDef[]).find((p) => p.id === profileId);
  return found ?? (profilesData.profiles[0] as ProfileDef);
}

function getBaseName(filePath: string): string {
  return (filePath.split('/').pop() ?? filePath).toLowerCase();
}

/**
 * Detects a shared single top-level wrapper folder (e.g. `my-app/package.json`) so
 * generated files are placed at the project root inside that folder.
 */
function detectRootPrefix(ingest: IngestResult): string {
  if (ingest.manifest.length === 0) return '';
  const firstSegs = new Set(ingest.manifest.map((m) => m.path.split('/')[0]));
  const allNestedUnderSingleDir =
    firstSegs.size === 1 && ingest.manifest.every((m) => m.path.includes('/'));
  if (!allNestedUnderSingleDir) return '';
  const root = ingest.manifest[0]?.path.split('/')[0] ?? '';
  return root ? `${root}/` : '';
}

function withRootPrefix(prefix: string, relativePath: string): string {
  return `${prefix}${relativePath.replace(/^\/+/, '')}`;
}

export function resolveLicencePolicy(licenseStated: string): LicencePolicyRule | null {
  const normalized = licenseStated.trim().toLowerCase();
  const policies = getLoadedLicencePolicies();
  return (
    policies.find((rule) => rule.license.toLowerCase() === normalized) ??
    policies.find((rule) => rule.license.toLowerCase() === 'not stated') ??
    null
  );
}

export function checkRegistryEntryEligibility(
  entry: RegistryEntry,
  profileId: ProfileId,
  analysis: DeterministicAnalysis,
  ingest: IngestResult
): { eligible: boolean; reason: string } {
  const depNames = new Set(analysis.dependencies.map((d) => d.name.toLowerCase()));
  const bundlersLower = new Set(analysis.bundlers.map((b) => b.toLowerCase()));
  const frameworksLower = new Set(analysis.frameworks.map((f) => f.toLowerCase()));
  const configBases = new Set(analysis.configFiles.map((p) => getBaseName(p)));
  const codePatterns = new Set(analysis.codePatternsMatched);

  // 1. Tier check: only core or alternative
  if (entry.tier !== 'core' && entry.tier !== 'alternative') {
    return {
      eligible: false,
      reason: `Tier "${entry.tier}" is excluded from automatic proposals.`,
    };
  }

  // 2. Status check: never propose review, excluded, or rejected entries
  if (entry.status === 'excluded' || entry.status === 'rejected' || entry.status === 'needs-review') {
    return {
      eligible: false,
      reason: `Registry status "${entry.status}" prohibits automatic proposals.`,
    };
  }

  // 3. Licence policy check: never propose Warn, Block, Unverified, or Not stated
  if (!entry.license_stated || entry.license_stated.toLowerCase() === 'not stated') {
    return {
      eligible: false,
      reason: 'Licence is "Not stated" (unverified).',
    };
  }

  const policyRule = resolveLicencePolicy(entry.license_stated);
  if (!policyRule || policyRule.policy !== 'Allow' || entry.license_policy !== 'Allow') {
    return {
      eligible: false,
      reason: `Licence policy "${policyRule?.policy ?? entry.license_policy}" is not Allow.`,
    };
  }

  // 4. Profile match
  const matchesProfile = entry.profiles.some((p) => {
    if (p === 'any') return true;
    if (p === profileId) return true;
    if (profileId === 'api-service' && p === 'api') return true;
    return false;
  });

  if (!matchesProfile) {
    return {
      eligible: false,
      reason: `Entry profiles (${entry.profiles.join(', ')}) do not match ${profileId}.`,
    };
  }

  // 5. Requires check
  if (entry.requires.engine) {
    const reqEngine = entry.requires.engine.toLowerCase();
    const hasEngine =
      (reqEngine === 'pixi' && (depNames.has('pixi.js') || depNames.has('pixijs') || frameworksLower.has('pixijs'))) ||
      (reqEngine === 'phaser' && (depNames.has('phaser') || frameworksLower.has('phaser'))) ||
      (reqEngine === 'littlejs' && (depNames.has('littlejsengine') || frameworksLower.has('littlejs')));
    if (!hasEngine) {
      return {
        eligible: false,
        reason: `Requires engine "${entry.requires.engine}" which is not present in the project.`,
      };
    }
  }

  if (entry.requires.build) {
    const reqBuild = entry.requires.build.toLowerCase();
    const hasBuild = depNames.has(reqBuild) || bundlersLower.has(reqBuild);
    if (!hasBuild) {
      return {
        eligible: false,
        reason: `Requires build tool "${entry.requires.build}" which is not present in the project.`,
      };
    }
  }

  if (entry.requires.test) {
    const reqTest = entry.requires.test.toLowerCase();
    const hasTest =
      depNames.has(reqTest) || Array.from(configBases).some((b) => b.startsWith(`${reqTest}.config.`));
    if (!hasTest) {
      return {
        eligible: false,
        reason: `Requires test runner "${entry.requires.test}" which is not present.`,
      };
    }
  }

  if (entry.requires.framework) {
    const reqFw = entry.requires.framework.toLowerCase();
    const hasFw = depNames.has(reqFw) || frameworksLower.has(reqFw);
    if (!hasFw) {
      return {
        eligible: false,
        reason: `Requires framework "${entry.requires.framework}" which is not present.`,
      };
    }
  }

  // 6. Conflicts check
  for (const conflict of entry.conflicts_with) {
    const conflictLower = conflict.toLowerCase();
    if (
      depNames.has(conflictLower) ||
      Array.from(configBases).some((b) => b.includes(conflictLower)) ||
      Array.from(codePatterns).some((pat) => pat.toLowerCase().includes(conflictLower))
    ) {
      return {
        eligible: false,
        reason: `Conflicts with "${conflict}" detected in the project.`,
      };
    }
    if (
      conflictLower === 'history-api-routing' &&
      Object.values(ingest.textFiles).some((f) => /history\.pushState|BrowserRouter|createBrowserRouter/.test(f.content))
    ) {
      return {
        eligible: false,
        reason: 'Conflicts with History API routing in the project.',
      };
    }
  }

  // 7. Avoid proposing libraries already installed
  if (depNames.has(entry.package.toLowerCase())) {
    return {
      eligible: false,
      reason: `Package "${entry.package}" is already declared in project dependencies.`,
    };
  }

  // 8. Do not swap an already-configured bundler or test runner
  if (entry.category === 'build/bundling' && entry.id !== 'build-vite-plugin-pwa' && analysis.bundlers.length > 0) {
    return {
      eligible: false,
      reason: `Project already uses bundler (${analysis.bundlers.join(', ')}); avoid swapping bundlers.`,
    };
  }

  if (entry.id === 'test-jest' && (bundlersLower.has('vite') || depNames.has('vitest'))) {
    return {
      eligible: false,
      reason: 'Vite project should prefer Vitest over Jest to match existing tooling.',
    };
  }

  return { eligible: true, reason: 'Eligible (Allow licence, tier, and requirements satisfied).' };
}

/**
 * Generates a readable unified diff between `beforeContent` (null when adding a new file) and `afterContent`.
 */
export function createUnifiedDiff(
  filePath: string,
  beforeContent: string | null,
  afterContent: string
): string {
  const safePath = sanitizeDiffHeaderPath(filePath);
  const afterLines = afterContent.split(/\r?\n/).map(sanitizeUntrustedDiffBodyLine);

  if (beforeContent === null) {
    const body = afterLines.map((l) => `+${l}`).join('\n');
    return [
      `--- /dev/null`,
      `+++ b/${safePath}`,
      `@@ -0,0 +1,${afterLines.length} @@`,
      body,
    ].join('\n');
  }

  const beforeLines = beforeContent.split(/\r?\n/).map(sanitizeUntrustedDiffBodyLine);
  if (beforeContent === afterContent) {
    return `--- a/${safePath}\n+++ b/${safePath}\n(no textual changes)`;
  }

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const contextLines = 2;
  const ctxBeforeStart = Math.max(0, prefix - contextLines);
  const ctxAfterEndOffset = Math.min(suffix, contextLines);

  const oldMidStart = prefix;
  const oldMidEnd = beforeLines.length - suffix;
  const newMidStart = prefix;
  const newMidEnd = afterLines.length - suffix;

  const hunkLines: string[] = [];
  for (let i = ctxBeforeStart; i < oldMidStart; i += 1) {
    hunkLines.push(` ${beforeLines[i]}`);
  }
  for (let i = oldMidStart; i < oldMidEnd; i += 1) {
    hunkLines.push(`-${beforeLines[i]}`);
  }
  for (let i = newMidStart; i < newMidEnd; i += 1) {
    hunkLines.push(`+${afterLines[i]}`);
  }
  for (let i = oldMidEnd; i < oldMidEnd + ctxAfterEndOffset; i += 1) {
    hunkLines.push(` ${beforeLines[i]}`);
  }

  const oldCount = oldMidEnd - ctxBeforeStart + ctxAfterEndOffset;
  const newCount = newMidEnd - ctxBeforeStart + ctxAfterEndOffset;

  return [
    `--- a/${safePath}`,
    `+++ b/${safePath}`,
    `@@ -${ctxBeforeStart + 1},${oldCount} +${ctxBeforeStart + 1},${newCount} @@`,
    ...hunkLines,
  ].join('\n');
}

function buildFileChange(
  path: string,
  beforeContent: string | null,
  afterContent: string
): ProposalFileChange {
  return {
    path,
    action: beforeContent === null ? 'add' : 'modify',
    beforeContent,
    afterContent,
    unifiedDiff: createUnifiedDiff(path, beforeContent, afterContent),
  };
}

function findTextFile(
  ingest: IngestResult,
  predicate: (pathLower: string, baseLower: string) => boolean
): { path: string; content: string } | null {
  for (const [path, entry] of Object.entries(ingest.textFiles)) {
    const pathLower = path.toLowerCase();
    const baseLower = getBaseName(path);
    if (predicate(pathLower, baseLower)) {
      return { path, content: entry.content };
    }
  }
  return null;
}

function allCodeContent(ingest: IngestResult): string {
  return Object.values(ingest.textFiles)
    .filter((f) => !/\.(md|lock|png|jpg|svg)$/i.test(f.path))
    .map((f) => f.content)
    .join('\n');
}

function isTypeScriptProject(analysis: DeterministicAnalysis): boolean {
  return (
    analysis.languages.some((l) => l.language === 'TypeScript') ||
    analysis.configFiles.some((c) => getBaseName(c) === 'tsconfig.json')
  );
}

function hasNodePackageJson(ingest: IngestResult): { path: string; content: string } | null {
  return findTextFile(ingest, (_p, b) => b === 'package.json');
}

function addDependencyToPackageJson(
  existingContent: string,
  pkgName: string,
  versionPlaceholder: string,
  section: 'dependencies' | 'devDependencies',
  extraScript?: { name: string; command: string }
): string {
  try {
    const parsed = JSON.parse(existingContent) as Record<string, unknown>;
    const existingSection =
      parsed[section] && typeof parsed[section] === 'object'
        ? { ...(parsed[section] as Record<string, string>) }
        : {};
    if (!(pkgName in existingSection)) {
      existingSection[pkgName] = versionPlaceholder;
    }
    parsed[section] = existingSection;

    if (extraScript) {
      const scripts =
        parsed.scripts && typeof parsed.scripts === 'object'
          ? { ...(parsed.scripts as Record<string, string>) }
          : {};
      if (!(extraScript.name in scripts)) {
        scripts[extraScript.name] = extraScript.command;
      }
      parsed.scripts = scripts;
    }

    const indentMatch = /\n([ \t]+)"/.exec(existingContent);
    const indent = indentMatch ? indentMatch[1] : '  ';
    return `${JSON.stringify(parsed, null, indent)}\n`;
  } catch {
    return existingContent;
  }
}

function extractEnvVariableNames(ingest: IngestResult): string[] {
  const keys = new Set<string>();
  const code = allCodeContent(ingest);
  for (const match of code.matchAll(/process\.env\.([A-Z][A-Z0-9_]{1,40})/g)) {
    if (match[1] !== 'NODE_ENV') keys.add(match[1]);
  }
  for (const match of code.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]{1,40})/g)) {
    keys.add(match[1]);
  }
  for (const match of code.matchAll(/os\.(?:getenv|environ\.get)\(\s*['"]([A-Z][A-Z0-9_]{1,40})['"]/g)) {
    keys.add(match[1]);
  }
  if (keys.size === 0) {
    keys.add('PORT');
    keys.add('NODE_ENV');
  }
  return Array.from(keys).sort();
}

function buildCiWorkflowContent(analysis: DeterministicAnalysis): string {
  const isPython = analysis.primaryLanguage === 'Python';
  if (isPython) {
    return [
      'name: CI',
      '',
      'on:',
      '  push:',
      '    branches: [main]',
      '  pull_request:',
      '    branches: [main]',
      '',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-python@v5',
      '        with:',
      '          python-version: "3.12"',
      '      - run: pip install -r requirements.txt',
      '      - run: pytest',
      '',
    ].join('\n');
  }

  const pm = analysis.packageManagers[0] ?? 'npm';
  const installCmd =
    pm === 'pnpm'
      ? 'pnpm install --frozen-lockfile'
      : pm === 'yarn'
      ? 'yarn install --frozen-lockfile'
      : pm === 'bun'
      ? 'bun install --frozen-lockfile'
      : analysis.hygiene.hasLockfile
      ? 'npm ci'
      : 'npm install';
  const runPrefix = pm === 'npm' ? 'npm run' : pm;

  return [
    'name: CI',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    '    branches: [main]',
    '',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: "22"',
    `      - run: ${installCmd}`,
    `      - run: ${runPrefix} build --if-present`,
    `      - run: ${runPrefix} test --if-present`,
    '',
  ].join('\n');
}

function pickBestRegistryEntry(
  eligibleEntries: RegistryEntry[],
  category: string,
  preferredIds: string[] = []
): RegistryEntry | null {
  for (const id of preferredIds) {
    const hit = eligibleEntries.find((e) => e.id === id);
    if (hit) return hit;
  }
  const catMatches = eligibleEntries.filter(
    (e) => e.category.toLowerCase() === category.toLowerCase()
  );
  const core = catMatches.find((e) => e.tier === 'core');
  return core ?? catMatches[0] ?? null;
}

export interface FindingsGenerationResult {
  findings: FindingItem[];
  proposals: ProposalItem[];
  eligibleRegistryIds: string[];
  excludedRegistryNotes: RegistryExclusionNote[];
}

export function generateFindingsAndProposals(
  ingest: IngestResult,
  analysis: DeterministicAnalysis,
  profileId: ProfileId,
  modifiers: string[]
): FindingsGenerationResult {
  const profile = getProfileDefinition(profileId);
  const rootPrefix = detectRootPrefix(ingest);
  const pkgJson = hasNodePackageJson(ingest);
  const indexHtml = findTextFile(ingest, (_p, b) => b === 'index.html');
  const readmeFile = findTextFile(ingest, (_p, b) => /^readme(?:\.[a-z0-9]+)?$/i.test(b));
  const combinedCode = allCodeContent(ingest);
  const depNames = new Set(analysis.dependencies.map((d) => d.name.toLowerCase()));
  const useTs = isTypeScriptProject(analysis);
  const ext = useTs ? 'ts' : 'js';
  const hasVite = analysis.bundlers.includes('Vite') || depNames.has('vite');
  const isPython = analysis.primaryLanguage === 'Python';

  // Evaluate every registry entry against matching + licence policy rules
  const registry = getLoadedRegistry();
  const eligibleEntries: RegistryEntry[] = [];
  const excludedRegistryNotes: RegistryExclusionNote[] = [];

  for (const entry of registry) {
    const check = checkRegistryEntryEligibility(entry, profileId, analysis, ingest);
    if (check.eligible) {
      eligibleEntries.push(entry);
    } else {
      excludedRegistryNotes.push({
        entryId: entry.id,
        packageName: entry.package,
        reason: check.reason,
      });
    }
  }

  const findings: FindingItem[] = [];
  const proposals: ProposalItem[] = [];
  const proposalsByKey = new Map<string, ProposalItem>();

  const registerProposal = (dedupeKey: string | null, proposal: ProposalItem): ProposalItem => {
    if (dedupeKey && proposalsByKey.has(dedupeKey)) {
      return proposalsByKey.get(dedupeKey)!;
    }
    proposals.push(proposal);
    if (dedupeKey) {
      proposalsByKey.set(dedupeKey, proposal);
    }
    return proposal;
  };

  // Helper to create test runner proposal (shared between checklist test gap and generic no-tests)
  const buildTestProposal = (linkedFindingId: string): ProposalItem | null => {
    if (isPython) {
      const testPath = withRootPrefix(rootPrefix, 'tests/test_smoke.py');
      const content = [
        'def test_project_imports():',
        '    assert True',
        '',
      ].join('\n');
      const change = buildFileChange(testPath, null, content);
      return registerProposal('tests-setup', {
        id: 'prop-test-pytest-smoke',
        findingId: linkedFindingId,
        title: 'Add Python smoke test scaffold',
        why: 'No test files were detected. Adds a starter pytest file without altering application logic.',
        rationale: 'No test files were detected. Adds a starter pytest file without altering application logic.',
        expectedEffect: 'Enables running `pytest` locally or in CI with an initial smoke assertion.',
        source: 'generated',
        licence: 'Project-local (generated)',
        licencePolicy: 'Project-generated',
        riskTier: 'A',
        aiSuggested: false,
        filesToAddOrChange: [change],
        targetPaths: [change.path],
        diffPreview: change.unifiedDiff,
        approved: true,
      });
    }

    const preferredTest = pickBestRegistryEntry(
      eligibleEntries,
      'testing',
      hasVite ? ['test-vitest', 'test-playwright'] : ['test-jest', 'test-playwright']
    );

    if (preferredTest && pkgJson) {
      const testCmd =
        preferredTest.package === 'vitest'
          ? 'vitest run'
          : preferredTest.package === '@playwright/test'
          ? 'playwright test'
          : 'jest';
      const updatedPkg = addDependencyToPackageJson(
        pkgJson.content,
        preferredTest.package,
        'latest',
        'devDependencies',
        { name: 'test', command: testCmd }
      );
      const pkgChange = buildFileChange(pkgJson.path, pkgJson.content, updatedPkg);
      const smokeTestPath = withRootPrefix(rootPrefix, `tests/smoke.test.${ext}`);
      const smokeContent =
        preferredTest.package === '@playwright/test'
          ? [
              "import { test, expect } from '@playwright/test';",
              '',
              "test('application page loads without title error', async ({ page }) => {",
              "  await page.goto('/');",
              "  await expect(page).toHaveTitle(/.+/);",
              '});',
              '',
            ].join('\n')
          : [
              ...(preferredTest.package === 'vitest'
                ? ["import { describe, expect, it } from 'vitest';", '']
                : []),
              "describe('baseline smoke test', () => {",
              "  it('verifies pure logic arithmetic', () => {",
              '    expect(1 + 1).toBe(2);',
              '  });',
              '});',
              '',
            ].join('\n');
      const testChange = buildFileChange(smokeTestPath, null, smokeContent);

      return registerProposal('tests-setup', {
        id: `prop-${preferredTest.id}`,
        findingId: linkedFindingId,
        title: `Add ${preferredTest.name} test runner and smoke test`,
        why: `No tests were detected. "${preferredTest.name}" (${preferredTest.license_stated}) matches the project stack and satisfies the Allow licence policy.`,
        rationale: `No tests were detected. "${preferredTest.name}" (${preferredTest.license_stated}) matches the project stack and satisfies the Allow licence policy.`,
        expectedEffect: `Adds "${preferredTest.package}" to devDependencies, wires a test script, and creates ${smokeTestPath}.`,
        source: 'registry-library',
        registryEntryId: preferredTest.id,
        packageName: preferredTest.package,
        licence: preferredTest.license_stated,
        licencePolicy: 'Allow',
        riskTier: 'B',
        aiSuggested: false,
        filesToAddOrChange: [pkgChange, testChange],
        targetPaths: [pkgChange.path, testChange.path],
        diffPreview: [pkgChange.unifiedDiff, testChange.unifiedDiff].join('\n\n'),
        approved: false,
      });
    }

    // Fallback generated test file when no package.json exists
    const fallbackTestPath = withRootPrefix(rootPrefix, `tests/smoke.test.${ext}`);
    const fallbackContent = [
      "import assert from 'node:assert/strict';",
      '',
      'assert.equal(1 + 1, 2);',
      '',
    ].join('\n');
    const change = buildFileChange(fallbackTestPath, null, fallbackContent);
    return registerProposal('tests-setup', {
      id: 'prop-generated-node-test',
      findingId: linkedFindingId,
      title: 'Add standalone Node assert smoke test',
      why: 'No package.json or test suite was found; generates a zero-dependency Node test script.',
      rationale: 'No package.json or test suite was found; generates a zero-dependency Node test script.',
      expectedEffect: `Adds ${fallbackTestPath} runnable directly with Node or Bun.`,
      source: 'generated',
      licence: 'Project-local (generated)',
      licencePolicy: 'Project-generated',
      riskTier: 'A',
      aiSuggested: false,
      filesToAddOrChange: [change],
      targetPaths: [change.path],
      diffPreview: change.unifiedDiff,
      approved: true,
    });
  };

  const buildCiProposal = (linkedFindingId: string): ProposalItem => {
    const ciPath = withRootPrefix(rootPrefix, '.github/workflows/ci.yml');
    const ciContent = buildCiWorkflowContent(analysis);
    const change = buildFileChange(ciPath, null, ciContent);
    return registerProposal('ci-workflow', {
      id: 'prop-ci-github-actions',
      findingId: linkedFindingId,
      title: 'Add GitHub Actions CI workflow',
      why: 'No CI workflow was detected in .github/workflows, .gitlab-ci.yml, or CircleCI configs. CI workflow files run commands and can access repository secrets, so review before approving.',
      rationale: 'No CI workflow was detected in .github/workflows, .gitlab-ci.yml, or CircleCI configs.',
      expectedEffect: 'Runs dependency install, build, and tests automatically on pushes and pull requests.',
      source: 'generated',
      licence: 'Project-local (generated)',
      licencePolicy: 'Project-generated',
      riskTier: 'C',
      aiSuggested: false,
      filesToAddOrChange: [change],
      targetPaths: [change.path],
      diffPreview: change.unifiedDiff,
      approved: false,
      securityWarnings: [
        'CI workflow file executes commands in CI and may interact with CI secrets. Requires explicit Tier C approval.',
      ],
    });
  };

  const buildEnvExampleProposal = (linkedFindingId: string): ProposalItem => {
    const envPath = withRootPrefix(rootPrefix, '.env.example');
    const envVars = extractEnvVariableNames(ingest);
    const content = [
      '# Environment configuration template (never commit real secrets)',
      ...envVars.map((k) => `${k}=`),
      '',
    ].join('\n');
    const change = buildFileChange(envPath, null, content);
    return registerProposal('env-example', {
      id: 'prop-env-example',
      findingId: linkedFindingId,
      title: 'Generate .env.example template',
      why: 'No .env.example file was found. Documents environment variable names extracted locally without secret values.',
      rationale: 'No .env.example file was found. Documents environment variable names extracted locally without secret values.',
      expectedEffect: 'Helps contributors configure required environment variables safely before running the project.',
      source: 'generated',
      licence: 'Project-local (generated)',
      licencePolicy: 'Project-generated',
      riskTier: 'A',
      aiSuggested: false,
      filesToAddOrChange: [change],
      targetPaths: [change.path],
      diffPreview: change.unifiedDiff,
      approved: true,
    });
  };

  // 1. Evaluate profile completeness checklist
  for (const item of profile.completeness_checklist) {
    let satisfied = false;
    let evidence = 'Not detected in scanned project files.';
    let severity: FindingSeverity = 'medium';
    let category = 'architecture';

    if (profileId === 'browser-game-2d') {
      switch (item.id) {
        case 'input-handler': {
          category = 'input handling';
          severity = 'high';
          satisfied =
            /(keydown|keyup|pointerdown|mousedown|touchstart|Gamepad|createCursorKeys|this\.input)/.test(
              combinedCode
            );
          evidence = satisfied
            ? 'Detected keyboard/pointer/gamepad input listeners.'
            : 'No keyboard, pointer, or gamepad input listeners detected.';
          break;
        }
        case 'game-loop': {
          category = 'game loop';
          severity = 'high';
          satisfied =
            /requestAnimationFrame/.test(combinedCode) ||
            depNames.has('phaser') ||
            depNames.has('pixi.js') ||
            depNames.has('kaplay') ||
            depNames.has('littlejsengine');
          evidence = satisfied
            ? 'Detected requestAnimationFrame or engine-managed frame loop.'
            : 'No requestAnimationFrame loop or game engine ticker detected.';
          break;
        }
        case 'scene-state': {
          category = 'scene management';
          severity = 'medium';
          satisfied =
            /(Phaser\.Scene|extends Scene|gameState|setScene|switchScene|currentState)/i.test(
              combinedCode
            ) ||
            ingest.manifest.some((m) => /(?:^|\/)scenes?\//i.test(m.path));
          evidence = satisfied
            ? 'Detected scene modules or explicit state-machine transitions.'
            : 'No scene manager or explicit game state transition module found.';
          break;
        }
        case 'asset-loader': {
          category = 'asset loading';
          severity = 'medium';
          satisfied =
            /(preload\s*\(|Assets\.load|loadImage|PreloadJS|new Image\()/i.test(combinedCode) ||
            depNames.has('@assetpack/core');
          evidence = satisfied
            ? 'Detected asset preload or image/manifest loader logic.'
            : 'No dedicated asset loader or boot progress tracking detected.';
          break;
        }
        case 'audio-unlock': {
          category = 'audio';
          severity = 'medium';
          satisfied =
            depNames.has('howler') ||
            depNames.has('tone') ||
            depNames.has('zzfx') ||
            depNames.has('@pixi/sound') ||
            (/AudioContext/.test(combinedCode) && /\.resume\s*\(/.test(combinedCode));
          evidence = satisfied
            ? 'Detected web audio library or AudioContext resume unlock.'
            : 'No game audio library or user-gesture AudioContext unlock detected.';
          break;
        }
        case 'save-load': {
          category = 'save/load';
          severity = 'medium';
          satisfied =
            depNames.has('idb-keyval') ||
            depNames.has('idb') ||
            depNames.has('dexie') ||
            depNames.has('localforage') ||
            /(localStorage\.|indexedDB\.)/.test(combinedCode);
          evidence = satisfied
            ? 'Detected IndexedDB or localStorage persistence.'
            : 'No save/load storage layer detected.';
          break;
        }
        case 'build-export': {
          category = 'build/bundling';
          severity = 'high';
          satisfied =
            Boolean(analysis.packageJsonScripts.build) ||
            analysis.bundlers.length > 0 ||
            analysis.manifestFiles.some((m) => getBaseName(m) === 'project.godot');
          evidence = satisfied
            ? `Build/export tooling present (${analysis.bundlers.join(', ') || 'build script'}).`
            : 'No bundler or static distribution build script detected.';
          break;
        }
        case 'pause-resume': {
          category = 'lifecycle';
          severity = 'medium';
          satisfied = /(visibilitychange|window\.addEventListener\(\s*['"]blur['"]|togglePause|isPaused)/i.test(
            combinedCode
          );
          evidence = satisfied
            ? 'Detected blur/visibilitychange pause handling.'
            : 'No tab-visibility or pause/resume lifecycle handler detected.';
          break;
        }
        case 'logic-tests': {
          category = 'testing';
          severity = 'high';
          satisfied = analysis.hygiene.hasTests;
          evidence = satisfied
            ? `Found tests: ${analysis.hygiene.testPaths.slice(0, 2).join(', ') || 'test script'}`
            : 'No unit tests for game state or pure logic detected.';
          break;
        }
        case 'readme-controls': {
          category = 'documentation';
          severity = 'low';
          satisfied =
            Boolean(readmeFile) &&
            /(controls|wasd|arrow|mouse|spacebar|play|npm run)/i.test(readmeFile?.content ?? '');
          evidence = satisfied
            ? `README documents controls/run steps (${readmeFile?.path}).`
            : readmeFile
            ? `${readmeFile.path} exists but lacks explicit player controls and run instructions.`
            : 'No README file found.';
          break;
        }
      }
    } else if (profileId === 'web-page') {
      const htmlContent = indexHtml?.content ?? '';
      switch (item.id) {
        case 'title-meta': {
          category = 'metadata';
          severity = 'high';
          satisfied =
            /<title>[\s\S]*?<\/title>/i.test(htmlContent) &&
            /<meta[^>]+name=["']description["']/i.test(htmlContent);
          evidence = satisfied
            ? '<title> and <meta name="description"> present in index.html.'
            : 'index.html is missing <title> and/or <meta name="description">.';
          break;
        }
        case 'viewport-meta': {
          category = 'metadata';
          severity = 'high';
          satisfied = /<meta[^>]+name=["']viewport["']/i.test(htmlContent);
          evidence = satisfied
            ? 'Viewport meta tag found in index.html.'
            : 'Missing responsive <meta name="viewport"> tag in index.html.';
          break;
        }
        case 'favicon': {
          category = 'assets';
          severity = 'low';
          satisfied =
            ingest.manifest.some((m) => /favicon\.(ico|svg|png)$/i.test(m.path)) ||
            /<link[^>]+rel=["'][^"']*icon/i.test(htmlContent);
          evidence = satisfied
            ? 'Favicon asset or link tag detected.'
            : 'No favicon asset or <link rel="icon"> tag detected.';
          break;
        }
        case 'landmarks': {
          category = 'accessibility';
          severity = 'medium';
          satisfied = /<main[\s>]/i.test(combinedCode) && /<(header|nav)[\s>]/i.test(combinedCode);
          evidence = satisfied
            ? 'Semantic <main> and <header>/<nav> landmarks found.'
            : 'Missing semantic HTML landmarks (<main>, <header>, or <nav>).';
          break;
        }
        case 'responsive-css': {
          category = 'styling';
          severity = 'medium';
          satisfied =
            depNames.has('tailwindcss') ||
            /@media\s*\(|grid-template-columns|clamp\(/i.test(combinedCode);
          evidence = satisfied
            ? 'Responsive CSS media queries or Tailwind utilities present.'
            : 'No responsive CSS media queries or layout breakpoints detected.';
          break;
        }
        case 'pwa-manifest': {
          category = 'build/bundling';
          severity = modifiers.includes('pwa') ? 'high' : 'low';
          const hasManifest = ingest.manifest.some((m) =>
            ['manifest.webmanifest', 'manifest.json'].includes(getBaseName(m.path))
          );
          const hasSw =
            depNames.has('vite-plugin-pwa') ||
            ingest.manifest.some((m) => ['sw.js', 'service-worker.js'].includes(getBaseName(m.path)));
          satisfied = !modifiers.includes('pwa') || (hasManifest && hasSw);
          evidence = !modifiers.includes('pwa')
            ? 'PWA modifier not enabled; optional check passed.'
            : satisfied
            ? 'Web manifest and service worker tooling detected.'
            : 'PWA modifier active, but manifest.webmanifest or service worker tooling is missing.';
          break;
        }
        case 'build-tooling': {
          category = 'build/bundling';
          severity = 'medium';
          satisfied =
            Boolean(analysis.packageJsonScripts.build) ||
            analysis.bundlers.length > 0 ||
            !pkgJson;
          evidence = satisfied
            ? 'Build tooling configured or static HTML-only site.'
            : 'package.json exists without a bundler or build script.';
          break;
        }
        case 'lint-config': {
          category = 'quality';
          severity = 'low';
          satisfied =
            analysis.configFiles.some((c) => /eslint|prettier|biome/i.test(c)) ||
            Boolean(analysis.packageJsonScripts.lint);
          evidence = satisfied
            ? 'Linter or formatter configuration present.'
            : 'No ESLint or formatter config detected.';
          break;
        }
        case 'tests': {
          category = 'testing';
          severity = 'high';
          satisfied = analysis.hygiene.hasTests;
          evidence = satisfied
            ? 'Automated tests present.'
            : 'No component or E2E tests detected.';
          break;
        }
        case 'deploy-config': {
          category = 'deployment';
          severity = 'low';
          satisfied =
            analysis.hygiene.hasCI ||
            ingest.manifest.some((m) =>
              ['vercel.json', 'netlify.toml', 'dockerfile', 'fly.toml'].includes(getBaseName(m.path))
            );
          evidence = satisfied
            ? 'Deployment or CI config present.'
            : 'No hosting/deployment config (vercel.json, netlify.toml, or CI) found.';
          break;
        }
        case 'readme': {
          category = 'documentation';
          severity = 'low';
          satisfied = analysis.hygiene.hasReadme;
          evidence = satisfied
            ? `Found ${analysis.hygiene.readmePaths.join(', ')}.`
            : 'No README file found.';
          break;
        }
      }
    } else if (profileId === 'api-service') {
      switch (item.id) {
        case 'routes': {
          category = 'routing';
          severity = 'high';
          satisfied =
            /(app\.(get|post|put|delete)|router\.(get|post)|@app\.route|@Get\(|FastAPI\(|http\.createServer)/i.test(
              combinedCode
            );
          evidence = satisfied
            ? 'HTTP route handlers detected.'
            : 'No structured HTTP route definitions detected.';
          break;
        }
        case 'input-validation': {
          category = 'validation';
          severity = 'high';
          satisfied =
            depNames.has('zod') ||
            depNames.has('joi') ||
            depNames.has('pydantic') ||
            depNames.has('valibot') ||
            depNames.has('class-validator') ||
            /safeParse\(|BaseModel\)/.test(combinedCode);
          evidence = satisfied
            ? 'Schema/input validation library or checks present.'
            : 'No request payload validation middleware or schema validator detected.';
          break;
        }
        case 'auth': {
          category = 'security';
          severity = 'high';
          satisfied =
            depNames.has('jsonwebtoken') ||
            depNames.has('jose') ||
            depNames.has('passport') ||
            depNames.has('pyjwt') ||
            /(req\.headers\.authorization|bearer\s+token|verifyJwt|requireAuth)/i.test(combinedCode);
          evidence = satisfied
            ? 'Authentication guard or token verification detected.'
            : 'No authentication/authorization middleware detected.';
          break;
        }
        case 'logging': {
          category = 'observability';
          severity = 'medium';
          satisfied =
            depNames.has('pino') ||
            depNames.has('winston') ||
            depNames.has('morgan') ||
            depNames.has('structlog') ||
            /requestLogger|createLogger|logging\.getLogger/i.test(combinedCode);
          evidence = satisfied
            ? 'Structured logger or request logging middleware found.'
            : 'No structured request/application logger detected.';
          break;
        }
        case 'error-handling': {
          category = 'reliability';
          severity = 'high';
          satisfied =
            /(\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)|exception_handler|setErrorHandler|onError)/i.test(
              combinedCode
            );
          evidence = satisfied
            ? 'Centralized error handler middleware found.'
            : 'No centralized HTTP error handler middleware detected.';
          break;
        }
        case 'data-layer': {
          category = 'persistence';
          severity = 'medium';
          satisfied =
            depNames.has('prisma') ||
            depNames.has('drizzle-orm') ||
            depNames.has('sqlalchemy') ||
            ingest.manifest.some((m) => /(?:^|\/)migrations\//i.test(m.path) || m.path.endsWith('.sql'));
          evidence = satisfied
            ? 'ORM or SQL migrations folder present.'
            : 'No data-layer migrations folder or schema script detected.';
          break;
        }
        case 'health-endpoint': {
          category = 'observability';
          severity = 'high';
          satisfied = /['"]\/healthz?['"]/.test(combinedCode);
          evidence = satisfied
            ? 'Health check endpoint (/health or /healthz) found.'
            : 'No /health or /healthz endpoint found.';
          break;
        }
        case 'tests': {
          category = 'testing';
          severity = 'high';
          satisfied = analysis.hygiene.hasTests;
          evidence = satisfied ? 'Test files detected.' : 'No API/integration tests detected.';
          break;
        }
        case 'env-example': {
          category = 'configuration';
          severity = 'medium';
          satisfied = analysis.hygiene.hasEnvExample;
          evidence = satisfied
            ? `Found ${analysis.hygiene.envExamplePaths.join(', ')}.`
            : 'Missing .env.example template.';
          break;
        }
        case 'openapi-docs': {
          category = 'documentation';
          severity = 'medium';
          satisfied = ingest.manifest.some((m) =>
            ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.json'].includes(getBaseName(m.path))
          );
          evidence = satisfied
            ? 'OpenAPI/Swagger spec present.'
            : 'No OpenAPI/Swagger specification found.';
          break;
        }
        case 'ci-workflow': {
          category = 'ci';
          severity = 'medium';
          satisfied = analysis.hygiene.hasCI;
          evidence = satisfied
            ? `CI workflow present (${analysis.hygiene.ciPaths[0]}).`
            : 'No CI workflow configuration found.';
          break;
        }
      }
    }

    const findingId = `finding-${profileId}-${item.id}`;
    let linkedProposalId: string | null = null;

    if (!satisfied) {
      // Build proposal honoring priority: registry library (Allow + core/alternative) > generated code (never copied reference repos)
      if (
        (profileId === 'browser-game-2d' && item.id === 'audio-unlock')
      ) {
        const audioPkg = pickBestRegistryEntry(eligibleEntries, 'audio', [
          'audio-pixi-sound',
          'audio-howler',
          'audio-zzfx',
        ]);
        if (audioPkg && pkgJson) {
          const updatedPkg = addDependencyToPackageJson(
            pkgJson.content,
            audioPkg.package,
            'latest',
            'dependencies'
          );
          const pkgChange = buildFileChange(pkgJson.path, pkgJson.content, updatedPkg);
          const wrapperPath = withRootPrefix(rootPrefix, `src/audio/soundManager.${ext}`);
          const wrapperContent = [
            `// Audio helper wired to ${audioPkg.package} with user-gesture unlock`,
            `import { Howl, Howler } from '${audioPkg.package}';`,
            '',
            'export function unlockAudioOnFirstGesture() {',
            '  const resume = () => {',
            '    if (Howler.ctx && Howler.ctx.state === "suspended") {',
            '      void Howler.ctx.resume();',
            '    }',
            '    window.removeEventListener("pointerdown", resume);',
            '    window.removeEventListener("keydown", resume);',
            '  };',
            '  window.addEventListener("pointerdown", resume, { once: true });',
            '  window.addEventListener("keydown", resume, { once: true });',
            '}',
            '',
            'export { Howl };',
            '',
          ].join('\n');
          const genericAudioWrapper =
            audioPkg.package === 'howler'
              ? wrapperContent
              : [
                  `// Audio integration module using ${audioPkg.package}`,
                  `// See ${audioPkg.repo_url ?? audioPkg.package} for full options`,
                  'export function unlockWebAudioContext(ctx) {',
                  '  if (ctx && ctx.state === "suspended") void ctx.resume();',
                  '}',
                  '',
                ].join('\n');
          const wrapperChange = buildFileChange(wrapperPath, null, genericAudioWrapper);
          const prop = registerProposal('game-audio', {
            id: `prop-${audioPkg.id}`,
            findingId,
            title: `Add ${audioPkg.name} and user-gesture audio unlock helper`,
            why: `${audioPkg.why} Chosen from the Allow-licensed curated registry over custom WebAudio boilerplate.`,
            rationale: `${audioPkg.why} Chosen from the Allow-licensed curated registry over custom WebAudio boilerplate.`,
            expectedEffect: `Installs "${audioPkg.package}" and provides ${wrapperPath} to unlock audio on first user interaction.`,
            source: 'registry-library',
            registryEntryId: audioPkg.id,
            packageName: audioPkg.package,
            licence: audioPkg.license_stated,
            licencePolicy: 'Allow',
            riskTier: 'B',
            aiSuggested: false,
            filesToAddOrChange: [pkgChange, wrapperChange],
            targetPaths: [pkgChange.path, wrapperChange.path],
            diffPreview: [pkgChange.unifiedDiff, wrapperChange.unifiedDiff].join('\n\n'),
            approved: false,
          });
          linkedProposalId = prop.id;
        } else {
          const path = withRootPrefix(rootPrefix, `src/audio/unlockAudio.${ext}`);
          const content = [
            'export function unlockAudioContext(ctx' + (useTs ? ': AudioContext' : '') + ') {',
            '  if (ctx.state !== "suspended") return;',
            '  const unlock = () => {',
            '    void ctx.resume();',
            '    window.removeEventListener("pointerdown", unlock);',
            '    window.removeEventListener("keydown", unlock);',
            '  };',
            '  window.addEventListener("pointerdown", unlock, { once: true });',
            '  window.addEventListener("keydown", unlock, { once: true });',
            '}',
            '',
          ].join('\n');
          const change = buildFileChange(path, null, content);
          const prop = registerProposal('game-audio', {
            id: 'prop-generated-audio-unlock',
            findingId,
            title: 'Generate WebAudio user-gesture unlock helper',
            why: 'No package.json is present for a registry audio dependency; generates a standalone browser unlock utility.',
            rationale: 'No package.json is present for a registry audio dependency; generates a standalone browser unlock utility.',
            expectedEffect: `Adds ${path} so mobile and desktop browsers resume AudioContext on first input.`,
            source: 'generated',
            licence: 'Project-local (generated)',
            licencePolicy: 'Project-generated',
            riskTier: 'C',
            aiSuggested: false,
            filesToAddOrChange: [change],
            targetPaths: [change.path],
            diffPreview: change.unifiedDiff,
            approved: false,
          });
          linkedProposalId = prop.id;
        }
      } else if (profileId === 'browser-game-2d' && item.id === 'save-load') {
        const savePkg = pickBestRegistryEntry(eligibleEntries, 'save/load', [
          'save-idb-keyval',
          'save-idb',
        ]);
        if (savePkg && pkgJson) {
          const updatedPkg = addDependencyToPackageJson(
            pkgJson.content,
            savePkg.package,
            'latest',
            'dependencies'
          );
          const pkgChange = buildFileChange(pkgJson.path, pkgJson.content, updatedPkg);
          const savePath = withRootPrefix(rootPrefix, `src/storage/saveGame.${ext}`);
          const saveContent = [
            `import { get, set } from '${savePkg.package}';`,
            '',
            'const SAVE_KEY = "game-save-v1";',
            '',
            `export async function saveProgress(state${useTs ? ': unknown' : ''}) {`,
            '  await set(SAVE_KEY, state);',
            '}',
            '',
            'export async function loadProgress() {',
            '  return await get(SAVE_KEY);',
            '}',
            '',
          ].join('\n');
          const saveChange = buildFileChange(savePath, null, saveContent);
          const prop = registerProposal('game-save', {
            id: `prop-${savePkg.id}`,
            findingId,
            title: `Add ${savePkg.name} IndexedDB save/load persistence`,
            why: `${savePkg.why} Preferred over custom storage code because it is a core Allow-licensed registry library.`,
            rationale: `${savePkg.why} Preferred over custom storage code because it is a core Allow-licensed registry library.`,
            expectedEffect: `Adds "${savePkg.package}" to package.json and scaffolds async saveProgress/loadProgress helpers.`,
            source: 'registry-library',
            registryEntryId: savePkg.id,
            packageName: savePkg.package,
            licence: savePkg.license_stated,
            licencePolicy: 'Allow',
            riskTier: 'B',
            aiSuggested: false,
            filesToAddOrChange: [pkgChange, saveChange],
            targetPaths: [pkgChange.path, saveChange.path],
            diffPreview: [pkgChange.unifiedDiff, saveChange.unifiedDiff].join('\n\n'),
            approved: false,
          });
          linkedProposalId = prop.id;
        } else {
          const savePath = withRootPrefix(rootPrefix, `src/storage/saveGame.${ext}`);
          const saveContent = [
            'const SAVE_KEY = "game-save-v1";',
            '',
            `export function saveProgress(state${useTs ? ': unknown' : ''}) {`,
            '  localStorage.setItem(SAVE_KEY, JSON.stringify(state));',
            '}',
            '',
            'export function loadProgress() {',
            '  const raw = localStorage.getItem(SAVE_KEY);',
            '  return raw ? JSON.parse(raw) : null;',
            '}',
            '',
          ].join('\n');
          const change = buildFileChange(savePath, null, saveContent);
          const prop = registerProposal('game-save', {
            id: 'prop-generated-save-load',
            findingId,
            title: 'Generate localStorage save/load helper',
            why: 'No package.json exists for registry IndexedDB packages; generates a safe JSON persistence module.',
            rationale: 'No package.json exists for registry IndexedDB packages; generates a safe JSON persistence module.',
            expectedEffect: `Adds ${savePath} for saving and restoring player progress.`,
            source: 'generated',
            licence: 'Project-local (generated)',
            licencePolicy: 'Project-generated',
            riskTier: 'C',
            aiSuggested: false,
            filesToAddOrChange: [change],
            targetPaths: [change.path],
            diffPreview: change.unifiedDiff,
            approved: false,
          });
          linkedProposalId = prop.id;
        }
      } else if (
        (profileId === 'browser-game-2d' && item.id === 'build-export') ||
        (profileId === 'web-page' && item.id === 'build-tooling')
      ) {
        const vitePkg = pickBestRegistryEntry(eligibleEntries, 'build/bundling', ['build-vite']);
        if (vitePkg && pkgJson) {
          const updatedPkg = addDependencyToPackageJson(
            pkgJson.content,
            vitePkg.package,
            'latest',
            'devDependencies',
            { name: 'build', command: 'vite build' }
          );
          const pkgChange = buildFileChange(pkgJson.path, pkgJson.content, updatedPkg);
          const prop = registerProposal('build-tooling', {
            id: `prop-${vitePkg.id}`,
            findingId,
            title: 'Add Vite bundler and static build script',
            why: 'No bundler or build script is present. Vite is a core MIT-licensed bundler in the registry.',
            rationale: 'No bundler or build script is present. Vite is a core MIT-licensed bundler in the registry.',
            expectedEffect: 'Adds Vite to devDependencies and configures `"build": "vite build"` for static distribution.',
            source: 'registry-library',
            registryEntryId: vitePkg.id,
            packageName: vitePkg.package,
            licence: vitePkg.license_stated,
            licencePolicy: 'Allow',
            riskTier: 'B',
            aiSuggested: false,
            filesToAddOrChange: [pkgChange],
            targetPaths: [pkgChange.path],
            diffPreview: pkgChange.unifiedDiff,
            approved: false,
          });
          linkedProposalId = prop.id;
        }
      } else if (item.id === 'logic-tests' || item.id === 'tests') {
        const testProp = buildTestProposal(findingId);
        linkedProposalId = testProp?.id ?? null;
      } else if (item.id === 'ci-workflow') {
        linkedProposalId = buildCiProposal(findingId).id;
      } else if (item.id === 'env-example') {
        linkedProposalId = buildEnvExampleProposal(findingId).id;
      } else if (item.id === 'pwa-manifest' && modifiers.includes('pwa')) {
        const pwaPkg = pickBestRegistryEntry(eligibleEntries, 'build/bundling', [
          'build-vite-plugin-pwa',
        ]);
        const manifestPath = withRootPrefix(rootPrefix, 'public/manifest.webmanifest');
        const manifestContent = JSON.stringify(
          {
            name: 'Web Application',
            short_name: 'App',
            start_url: '/',
            display: 'standalone',
            background_color: '#0b0e14',
            theme_color: '#2563eb',
            icons: [],
          },
          null,
          2
        );
        const manifestChange = buildFileChange(manifestPath, null, `${manifestContent}\n`);
        if (pwaPkg && pkgJson) {
          const updatedPkg = addDependencyToPackageJson(
            pkgJson.content,
            pwaPkg.package,
            'latest',
            'devDependencies'
          );
          const pkgChange = buildFileChange(pkgJson.path, pkgJson.content, updatedPkg);
          const prop = registerProposal('pwa-manifest', {
            id: `prop-${pwaPkg.id}`,
            findingId,
            title: 'Add vite-plugin-pwa and web app manifest',
            why: 'PWA modifier is locked and project uses Vite. vite-plugin-pwa (MIT) automates Workbox service worker generation.',
            rationale: 'PWA modifier is locked and project uses Vite. vite-plugin-pwa (MIT) automates Workbox service worker generation.',
            expectedEffect: 'Adds vite-plugin-pwa dependency and scaffolds public/manifest.webmanifest.',
            source: 'registry-library',
            registryEntryId: pwaPkg.id,
            packageName: pwaPkg.package,
            licence: pwaPkg.license_stated,
            licencePolicy: 'Allow',
            riskTier: 'B',
            aiSuggested: false,
            filesToAddOrChange: [pkgChange, manifestChange],
            targetPaths: [pkgChange.path, manifestChange.path],
            diffPreview: [pkgChange.unifiedDiff, manifestChange.unifiedDiff].join('\n\n'),
            approved: false,
          });
          linkedProposalId = prop.id;
        } else {
          const prop = registerProposal('pwa-manifest', {
            id: 'prop-generated-pwa-manifest',
            findingId,
            title: 'Scaffold public/manifest.webmanifest for PWA',
            why: 'PWA modifier is active without an existing web app manifest.',
            rationale: 'PWA modifier is active without an existing web app manifest.',
            expectedEffect: 'Adds a valid manifest.webmanifest template for installable PWA metadata.',
            source: 'generated',
            licence: 'Project-local (generated)',
            licencePolicy: 'Project-generated',
            riskTier: 'A',
            aiSuggested: false,
            filesToAddOrChange: [manifestChange],
            targetPaths: [manifestChange.path],
            diffPreview: manifestChange.unifiedDiff,
            approved: true,
          });
          linkedProposalId = prop.id;
        }
      } else if (item.id === 'input-handler') {
        // Notice: hotkeys-js, mousetrap, keymaster are all poor-fit in registry; generate game input handler instead!
        const inputPath = withRootPrefix(rootPrefix, `src/input/inputState.${ext}`);
        const content = [
          '// Game-ready polled keyboard, pointer, and gamepad input state',
          `export function createInputState() {`,
          '  const pressed = new Set' + (useTs ? '<string>' : '') + '();',
          `  const onKeyDown = (e${useTs ? ': KeyboardEvent' : ''}) => pressed.add(e.code);`,
          `  const onKeyUp = (e${useTs ? ': KeyboardEvent' : ''}) => pressed.delete(e.code);`,
          '  window.addEventListener("keydown", onKeyDown);',
          '  window.addEventListener("keyup", onKeyUp);',
          '  return {',
          `    isDown: (code${useTs ? ': string' : ''}) => pressed.has(code),`,
          '    destroy: () => {',
          '      window.removeEventListener("keydown", onKeyDown);',
          '      window.removeEventListener("keyup", onKeyUp);',
          '    },',
          '  };',
          '}',
          '',
        ].join('\n');
        const change = buildFileChange(inputPath, null, content);
        const prop = registerProposal('game-input', {
          id: 'prop-generated-game-input',
          findingId,
          title: 'Generate polled keyboard/pointer game input module',
          why: 'Registry shortcut libraries (hotkeys-js, mousetrap, keymaster) are flagged poor-fit for 2D frame-polled games, so a lightweight polled input module is generated instead.',
          rationale: 'Registry shortcut libraries (hotkeys-js, mousetrap, keymaster) are flagged poor-fit for 2D frame-polled games, so a lightweight polled input module is generated instead.',
          expectedEffect: `Adds ${inputPath} exposing frame-safe isDown(code) polling and cleanup.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'pause-resume') {
        const pausePath = withRootPrefix(rootPrefix, `src/game/pauseController.${ext}`);
        const content = [
          `export function bindVisibilityPause(onPause${useTs ? ': (paused: boolean) => void' : ''}) {`,
          '  const handleVisibility = () => onPause(document.hidden);',
          '  const handleBlur = () => onPause(true);',
          '  document.addEventListener("visibilitychange", handleVisibility);',
          '  window.addEventListener("blur", handleBlur);',
          '  return () => {',
          '    document.removeEventListener("visibilitychange", handleVisibility);',
          '    window.removeEventListener("blur", handleBlur);',
          '  };',
          '}',
          '',
        ].join('\n');
        const change = buildFileChange(pausePath, null, content);
        const prop = registerProposal('game-pause', {
          id: 'prop-generated-pause-resume',
          findingId,
          title: 'Generate tab-visibility & blur pause controller',
          why: 'Games need to pause simulation and audio cleanly when the player switches tabs or loses window focus.',
          rationale: 'Games need to pause simulation and audio cleanly when the player switches tabs or loses window focus.',
          expectedEffect: `Adds ${pausePath} to notify the game loop on visibilitychange and blur events.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'game-loop') {
        const loopPath = withRootPrefix(rootPrefix, `src/game/fixedLoop.${ext}`);
        const content = [
          `export function startFixedLoop(step${useTs ? ': (dtSeconds: number) => void' : ''}, render${useTs ? ': (alpha: number) => void' : ''}) {`,
          '  const FIXED_DT = 1 / 60;',
          '  let accumulator = 0;',
          '  let last = performance.now();',
          '  let rafId = 0;',
          `  const frame = (now${useTs ? ': number' : ''}) => {`,
          '    const elapsed = Math.min(0.25, (now - last) / 1000);',
          '    last = now;',
          '    accumulator += elapsed;',
          '    while (accumulator >= FIXED_DT) {',
          '      step(FIXED_DT);',
          '      accumulator -= FIXED_DT;',
          '    }',
          '    render(accumulator / FIXED_DT);',
          '    rafId = requestAnimationFrame(frame);',
          '  };',
          '  rafId = requestAnimationFrame(frame);',
          '  return () => cancelAnimationFrame(rafId);',
          '}',
          '',
        ].join('\n');
        const change = buildFileChange(loopPath, null, content);
        const prop = registerProposal('game-loop', {
          id: 'prop-generated-fixed-loop',
          findingId,
          title: 'Generate fixed-timestep requestAnimationFrame game loop',
          why: 'No fixed-timestep loop or engine ticker was detected. Fixed 60 Hz accumulation keeps physics consistent across refresh rates.',
          rationale: 'No fixed-timestep loop or engine ticker was detected. Fixed 60 Hz accumulation keeps physics consistent across refresh rates.',
          expectedEffect: `Adds ${loopPath} with clamped delta time and fixed-step accumulator.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'scene-state') {
        const scenePath = withRootPrefix(rootPrefix, `src/game/sceneManager.${ext}`);
        const content = [
          `export function createSceneManager(initialScene${useTs ? ': string' : ''} = "title") {`,
          '  let current = initialScene;',
          '  return {',
          '    get current() { return current; },',
          `    transition(next${useTs ? ': string' : ''}) { current = next; },`,
          '  };',
          '}',
          '',
        ].join('\n');
        const change = buildFileChange(scenePath, null, content);
        const prop = registerProposal('scene-state', {
          id: 'prop-generated-scene-manager',
          findingId,
          title: 'Generate lightweight game scene/state manager',
          why: 'Separating title, active gameplay, pause, and game-over states simplifies menu wiring and restarts.',
          rationale: 'Separating title, active gameplay, pause, and game-over states simplifies menu wiring and restarts.',
          expectedEffect: `Adds ${scenePath} for deterministic scene state transitions.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'asset-loader') {
        const loaderPath = withRootPrefix(rootPrefix, `src/assets/assetLoader.${ext}`);
        const content = [
          `export async function preloadImages(paths${useTs ? ': string[]' : ''}, onProgress${useTs ? '?: (ratio: number) => void' : ''}) {`,
          '  let loaded = 0;',
          `  const entries = await Promise.all(paths.map((src) => new Promise((resolve, reject) => {`,
          '    const img = new Image();',
          '    img.onload = () => { loaded += 1; onProgress?.(loaded / paths.length); resolve([src, img]); };',
          '    img.onerror = () => reject(new Error(`Failed to load asset: ${src}`));',
          '    img.src = src;',
          '  })));',
          '  return Object.fromEntries(entries);',
          '}',
          '',
        ].join('\n');
        const change = buildFileChange(loaderPath, null, content);
        const prop = registerProposal('asset-loader', {
          id: 'prop-generated-asset-loader',
          findingId,
          title: 'Generate image asset preloader with progress callback',
          why: 'Prevents missing sprite flashes on first frame by tracking load completion before starting gameplay.',
          rationale: 'Prevents missing sprite flashes on first frame by tracking load completion before starting gameplay.',
          expectedEffect: `Adds ${loaderPath} to preload image paths and report progress ratios.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'readme-controls' || item.id === 'readme') {
        const readmePath = readmeFile?.path ?? withRootPrefix(rootPrefix, 'README.md');
        const sectionToAdd =
          profileId === 'browser-game-2d'
            ? [
                '## Controls & Running Locally',
                '',
                '- **Move**: Arrow keys or `WASD`',
                '- **Pause**: `Esc` or `P`',
                '- **Run locally**: `npm install && npm run dev`',
                '',
              ].join('\n')
            : [
                `# ${ingest.archiveName.replace(/\.zip$/i, '')}`,
                '',
                '## Setup & Build',
                '',
                '```bash',
                'npm install',
                'npm run build',
                '```',
                '',
              ].join('\n');
        const nextContent = readmeFile
          ? `${readmeFile.content.trimEnd()}\n\n${sectionToAdd}`
          : sectionToAdd;
        const change = buildFileChange(readmePath, readmeFile?.content ?? null, nextContent);
        const prop = registerProposal('readme-doc', {
          id: 'prop-generated-readme',
          findingId,
          title: readmeFile ? 'Add controls & run instructions to README' : 'Generate README.md',
          why: 'Documents how to launch, build, and interact with the project.',
          rationale: 'Documents how to launch, build, and interact with the project.',
          expectedEffect: `${readmeFile ? 'Updates' : 'Creates'} ${readmePath} with setup and control documentation.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'A',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: true,
        });
        linkedProposalId = prop.id;
      } else if ((item.id === 'title-meta' || item.id === 'viewport-meta') && indexHtml) {
        let updatedHtml = indexHtml.content;
        if (!/<title>[\s\S]*?<\/title>/i.test(updatedHtml)) {
          updatedHtml = updatedHtml.replace(
            /<head([^>]*)>/i,
            '<head$1>\n    <title>Web Project</title>'
          );
        }
        if (!/<meta[^>]+name=["']description["']/i.test(updatedHtml)) {
          updatedHtml = updatedHtml.replace(
            /<head([^>]*)>/i,
            '<head$1>\n    <meta name="description" content="Web project overview" />'
          );
        }
        if (!/<meta[^>]+name=["']viewport["']/i.test(updatedHtml)) {
          updatedHtml = updatedHtml.replace(
            /<head([^>]*)>/i,
            '<head$1>\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />'
          );
        }
        if (updatedHtml !== indexHtml.content) {
          const change = buildFileChange(indexHtml.path, indexHtml.content, updatedHtml);
          const prop = registerProposal('html-head-meta', {
            id: 'prop-html-head-meta',
            findingId,
            title: 'Add title, description, and viewport meta tags to index.html',
            why: 'Missing <title>, description, or responsive viewport tags hurts SEO and mobile scaling.',
            rationale: 'Missing <title>, description, or responsive viewport tags hurts SEO and mobile scaling.',
            expectedEffect: `Updates <head> inside ${indexHtml.path} with standard document metadata.`,
            source: 'generated',
            licence: 'Project-local (generated)',
            licencePolicy: 'Project-generated',
            riskTier: 'A',
            aiSuggested: false,
            filesToAddOrChange: [change],
            targetPaths: [change.path],
            diffPreview: change.unifiedDiff,
            approved: true,
          });
          linkedProposalId = prop.id;
        }
      } else if (item.id === 'favicon') {
        const iconPath = withRootPrefix(rootPrefix, 'public/favicon.svg');
        const svgContent = [
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
          '  <rect width="32" height="32" rx="6" fill="#0f172a"/>',
          '  <path d="M9 11h14v3H14v4h7v3h-7v3H9z" fill="#38bdf8"/>',
          '</svg>',
          '',
        ].join('\n');
        const iconChange = buildFileChange(iconPath, null, svgContent);
        const changes: ProposalFileChange[] = [iconChange];
        if (indexHtml && !/<link[^>]+rel=["'][^"']*icon/i.test(indexHtml.content)) {
          const updatedHtml = indexHtml.content.replace(
            /<\/head>/i,
            '  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />\n  </head>'
          );
          if (updatedHtml !== indexHtml.content) {
            changes.push(buildFileChange(indexHtml.path, indexHtml.content, updatedHtml));
          }
        }
        const prop = registerProposal('favicon', {
          id: 'prop-generated-favicon',
          findingId,
          title: 'Add SVG favicon asset and head link',
          why: 'Browsers request /favicon.ico or linked icons on every page load; adding an SVG favicon avoids 404s.',
          rationale: 'Browsers request /favicon.ico or linked icons on every page load; adding an SVG favicon avoids 404s.',
          expectedEffect: `Creates ${iconPath}${changes.length > 1 ? ` and links it in ${indexHtml?.path}` : ''}.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'A',
          aiSuggested: false,
          filesToAddOrChange: changes,
          targetPaths: changes.map((c) => c.path),
          diffPreview: changes.map((c) => c.unifiedDiff).join('\n\n'),
          approved: true,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'lint-config') {
        const eslintPath = withRootPrefix(rootPrefix, 'eslint.config.mjs');
        const eslintContent = [
          'export default [',
          '  {',
          '    ignores: ["dist/**", "build/**", "node_modules/**"],',
          '  },',
          '  {',
          '    rules: {',
          '      "no-unused-vars": "warn",',
          '      "no-undef": "error",',
          '    },',
          '  },',
          '];',
          '',
        ].join('\n');
        const change = buildFileChange(eslintPath, null, eslintContent);
        const prop = registerProposal('lint-config', {
          id: 'prop-generated-eslint',
          findingId,
          title: 'Add flat ESLint configuration',
          why: 'No linter configuration was found in the project root.',
          rationale: 'No linter configuration was found in the project root.',
          expectedEffect: `Adds ${eslintPath} with baseline syntax and unused-variable checks.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'A',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: true,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'deploy-config') {
        const netlifyPath = withRootPrefix(rootPrefix, 'netlify.toml');
        const content = [
          '[build]',
          '  publish = "dist"',
          '  command = "npm run build"',
          '',
        ].join('\n');
        const change = buildFileChange(netlifyPath, null, content);
        const prop = registerProposal('deploy-config', {
          id: 'prop-generated-deploy-config',
          findingId,
          title: 'Add static hosting deploy configuration (netlify.toml)',
          why: 'No static hosting configuration or CI workflow was detected.',
          rationale: 'No static hosting configuration or CI workflow was detected.',
          expectedEffect: `Adds ${netlifyPath} specifying build command and output directory.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'A',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: true,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'responsive-css') {
        const cssPath = withRootPrefix(rootPrefix, 'src/styles/responsive.css');
        const content = [
          '*, *::before, *::after {',
          '  box-sizing: border-box;',
          '}',
          '',
          'img, picture, video, canvas, svg {',
          '  max-width: 100%;',
          '  display: block;',
          '}',
          '',
          '@media (max-width: 768px) {',
          '  main {',
          '    padding-inline: 1rem;',
          '  }',
          '}',
          '',
        ].join('\n');
        const change = buildFileChange(cssPath, null, content);
        const prop = registerProposal('responsive-css', {
          id: 'prop-generated-responsive-css',
          findingId,
          title: 'Add baseline responsive CSS stylesheet',
          why: 'No responsive media queries or utility CSS framework were detected.',
          rationale: 'No responsive media queries or utility CSS framework were detected.',
          expectedEffect: `Adds ${cssPath} with fluid media defaults and mobile padding rules.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'A',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: true,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'landmarks') {
        const landmarkPath = withRootPrefix(rootPrefix, 'src/layout/landmarks.html');
        const content = [
          '<!-- Accessible landmark structure reference to integrate into entry markup -->',
          '<header><nav aria-label="Primary"></nav></header>',
          '<main id="main-content"></main>',
          '<footer></footer>',
          '',
        ].join('\n');
        const change = buildFileChange(landmarkPath, null, content);
        const prop = registerProposal('landmarks', {
          id: 'prop-generated-landmarks',
          findingId,
          title: 'Add semantic HTML landmark template',
          why: 'Screen readers rely on <header>, <nav>, and <main> landmarks for keyboard navigation.',
          rationale: 'Screen readers rely on <header>, <nav>, and <main> landmarks for keyboard navigation.',
          expectedEffect: `Adds ${landmarkPath} ready to wire into the page root.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'health-endpoint') {
        const healthPath = isPython
          ? withRootPrefix(rootPrefix, 'routes/health.py')
          : withRootPrefix(rootPrefix, `src/routes/health.${ext}`);
        const content = isPython
          ? [
              'def health_check():',
              '    return {"status": "ok"}',
              '',
            ].join('\n')
          : [
              `export function registerHealthRoute(app${useTs ? ': { get: (path: string, handler: (req: unknown, res: { json: (body: unknown) => void }) => void) => void }' : ''}) {`,
              '  app.get("/health", (_req, res) => {',
              '    res.json({ status: "ok" });',
              '  });',
              '}',
              '',
            ].join('\n');
        const change = buildFileChange(healthPath, null, content);
        const prop = registerProposal('health-endpoint', {
          id: 'prop-generated-health-endpoint',
          findingId,
          title: 'Add /health readiness endpoint module',
          why: 'Services need a lightweight /health endpoint for container and load-balancer readiness checks.',
          rationale: 'Services need a lightweight /health endpoint for container and load-balancer readiness checks.',
          expectedEffect: `Adds ${healthPath} returning HTTP 200 {"status":"ok"} once mounted in the router.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'input-validation') {
        const valPath = isPython
          ? withRootPrefix(rootPrefix, 'schemas/validation.py')
          : withRootPrefix(rootPrefix, `src/middleware/validateRequest.${ext}`);
        const content = isPython
          ? [
              'def require_fields(payload: dict, fields: list[str]) -> list[str]:',
              '    return [f for f in fields if f not in payload]',
              '',
            ].join('\n')
          : [
              `export function requireBodyFields(requiredFields${useTs ? ': string[]' : ''}) {`,
              `  return (req${useTs ? ': { body?: Record<string, unknown> }' : ''}, res${useTs ? ': { status: (code: number) => { json: (body: unknown) => void } }' : ''}, next${useTs ? ': () => void' : ''}) => {`,
              '    const body = req.body ?? {};',
              '    const missing = requiredFields.filter((f) => !(f in body));',
              '    if (missing.length > 0) {',
              '      return res.status(400).json({ error: "Missing required fields", missing });',
              '    }',
              '    next();',
              '  };',
              '}',
              '',
            ].join('\n');
        const change = buildFileChange(valPath, null, content);
        const prop = registerProposal('input-validation', {
          id: 'prop-generated-input-validation',
          findingId,
          title: 'Generate request input validation middleware',
          why: 'No schema validator or request field check was detected on API routes.',
          rationale: 'No schema validator or request field check was detected on API routes.',
          expectedEffect: `Adds ${valPath} to fail fast with HTTP 400 on malformed request payloads.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'error-handling') {
        const errPath = isPython
          ? withRootPrefix(rootPrefix, 'middleware/error_handler.py')
          : withRootPrefix(rootPrefix, `src/middleware/errorHandler.${ext}`);
        const content = isPython
          ? [
              'def format_error_response(exc: Exception) -> tuple[dict, int]:',
              '    return {"error": str(exc)}, 500',
              '',
            ].join('\n')
          : [
              `export function errorHandler(err${useTs ? ': Error & { status?: number }' : ''}, _req${useTs ? ': unknown' : ''}, res${useTs ? ': { status: (code: number) => { json: (body: unknown) => void } }' : ''}, _next${useTs ? ': unknown' : ''}) {`,
              '  const status = typeof err.status === "number" ? err.status : 500;',
              '  res.status(status).json({ error: status >= 500 ? "Internal server error" : err.message });',
              '}',
              '',
            ].join('\n');
        const change = buildFileChange(errPath, null, content);
        const prop = registerProposal('error-handling', {
          id: 'prop-generated-error-handler',
          findingId,
          title: 'Generate centralized HTTP error handler',
          why: 'No centralized error-handling middleware was detected; prevents leaking stack traces to API callers.',
          rationale: 'No centralized error-handling middleware was detected; prevents leaking stack traces to API callers.',
          expectedEffect: `Adds ${errPath} for consistent JSON error responses.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'logging') {
        const logPath = isPython
          ? withRootPrefix(rootPrefix, 'middleware/logger.py')
          : withRootPrefix(rootPrefix, `src/middleware/requestLogger.${ext}`);
        const content = isPython
          ? [
              'import json',
              'import time',
              '',
              'def log_request(method: str, path: str, status: int) -> None:',
              '    print(json.dumps({"ts": time.time(), "method": method, "path": path, "status": status}))',
              '',
            ].join('\n')
          : [
              `export function requestLogger(req${useTs ? ': { method: string; path: string }' : ''}, res${useTs ? ': { statusCode: number; on: (ev: string, cb: () => void) => void }' : ''}, next${useTs ? ': () => void' : ''}) {`,
              '  const start = Date.now();',
              '  res.on("finish", () => {',
              '    console.log(JSON.stringify({ method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - start }));',
              '  });',
              '  next();',
              '}',
              '',
            ].join('\n');
        const change = buildFileChange(logPath, null, content);
        const prop = registerProposal('logging', {
          id: 'prop-generated-request-logger',
          findingId,
          title: 'Generate structured JSON request logger',
          why: 'Structured request logs improve production observability without leaking request bodies.',
          rationale: 'Structured request logs improve production observability without leaking request bodies.',
          expectedEffect: `Adds ${logPath} logging method, path, status code, and latency.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'auth') {
        const authPath = isPython
          ? withRootPrefix(rootPrefix, 'middleware/auth.py')
          : withRootPrefix(rootPrefix, `src/middleware/requireAuth.${ext}`);
        const content = isPython
          ? [
              'def extract_bearer_token(header_value: str | None) -> str | None:',
              '    if not header_value or not header_value.startswith("Bearer "):',
              '        return None',
              '    return header_value[7:].strip() or None',
              '',
            ].join('\n')
          : [
              `export function requireBearerToken(req${useTs ? ': { headers?: Record<string, string | undefined> }' : ''}, res${useTs ? ': { status: (code: number) => { json: (body: unknown) => void } }' : ''}, next${useTs ? ': () => void' : ''}) {`,
              '  const auth = req.headers?.authorization ?? "";',
              '  if (!auth.startsWith("Bearer ") || auth.slice(7).trim().length === 0) {',
              '    return res.status(401).json({ error: "Missing Bearer authorization token" });',
              '  }',
              '  next();',
              '}',
              '',
            ].join('\n');
        const change = buildFileChange(authPath, null, content);
        const prop = registerProposal('auth', {
          id: 'prop-generated-auth-middleware',
          findingId,
          title: 'Generate Bearer token auth guard scaffold',
          why: 'No authorization check was detected; requires explicit review before enforcing on private endpoints.',
          rationale: 'No authorization check was detected; requires explicit review before enforcing on private endpoints.',
          expectedEffect: `Adds ${authPath} enforcing Bearer header presence on protected routes.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'routes') {
        const routePath = isPython
          ? withRootPrefix(rootPrefix, 'routes/index.py')
          : withRootPrefix(rootPrefix, `src/routes/index.${ext}`);
        const content = isPython
          ? ['def list_routes() -> list[str]:', '    return ["/health"]', ''].join('\n')
          : [
              `export function registerApiRoutes(app${useTs ? ': { get: (path: string, handler: (req: unknown, res: { json: (body: unknown) => void }) => void) => void }' : ''}) {`,
              '  app.get("/api/status", (_req, res) => res.json({ ok: true }));',
              '}',
              '',
            ].join('\n');
        const change = buildFileChange(routePath, null, content);
        const prop = registerProposal('routes', {
          id: 'prop-generated-routes',
          findingId,
          title: 'Scaffold starter API route module',
          why: 'No structured route module was detected in the API project.',
          rationale: 'No structured route module was detected in the API project.',
          expectedEffect: `Adds ${routePath} to organize route handlers outside the server entrypoint.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'C',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: false,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'data-layer') {
        const sqlPath = withRootPrefix(rootPrefix, 'migrations/001_init.sql');
        const content = [
          '-- Baseline migration schema',
          'CREATE TABLE IF NOT EXISTS app_records (',
          '  id TEXT PRIMARY KEY,',
          '  created_at TEXT NOT NULL',
          ');',
          '',
        ].join('\n');
        const change = buildFileChange(sqlPath, null, content);
        const prop = registerProposal('data-layer', {
          id: 'prop-generated-migration',
          findingId,
          title: 'Scaffold initial SQL migrations directory',
          why: 'No ORM schema or SQL migrations folder was found in the backend project.',
          rationale: 'No ORM schema or SQL migrations folder was found in the backend project.',
          expectedEffect: `Creates ${sqlPath} as an initial versioned schema migration baseline.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'A',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: true,
        });
        linkedProposalId = prop.id;
      } else if (item.id === 'openapi-docs') {
        const openApiPath = withRootPrefix(rootPrefix, 'openapi.yaml');
        const content = [
          'openapi: 3.1.0',
          'info:',
          `  title: ${ingest.archiveName.replace(/\.zip$/i, '')}`,
          '  version: 0.1.0',
          'paths:',
          '  /health:',
          '    get:',
          '      summary: Service health check',
          '      responses:',
          '        "200":',
          '          description: Service is healthy',
          '',
        ].join('\n');
        const change = buildFileChange(openApiPath, null, content);
        const prop = registerProposal('openapi-docs', {
          id: 'prop-generated-openapi',
          findingId,
          title: 'Generate OpenAPI 3.1 starter specification',
          why: 'No OpenAPI or Swagger contract file was detected in the API archive.',
          rationale: 'No OpenAPI or Swagger contract file was detected in the API archive.',
          expectedEffect: `Adds ${openApiPath} documenting /health and baseline schema structure.`,
          source: 'generated',
          licence: 'Project-local (generated)',
          licencePolicy: 'Project-generated',
          riskTier: 'A',
          aiSuggested: false,
          filesToAddOrChange: [change],
          targetPaths: [change.path],
          diffPreview: change.unifiedDiff,
          approved: true,
        });
        linkedProposalId = prop.id;
      }
    }

    findings.push({
      id: findingId,
      checklistId: item.id,
      title: item.label,
      description: satisfied
        ? `Checklist item satisfied: ${item.label}.`
        : `Missing checklist requirement for ${profile.name}: ${item.label}.`,
      origin: 'profile-checklist',
      severity: satisfied ? 'low' : severity,
      category,
      status: satisfied ? 'satisfied' : 'gap',
      evidence,
      aiSuggested: false,
      linkedProposalId,
    });
  }

  // 2. Generic hygiene findings (always evaluated: no tests, no CI, no lockfile, missing .env.example)
  if (!analysis.hygiene.hasTests) {
    const id = 'finding-generic-no-tests';
    const prop = buildTestProposal(id);
    findings.push({
      id,
      checklistId: null,
      title: 'No automated tests detected',
      description: 'Generic hygiene check: repository contains no test files or test runner setup.',
      origin: 'generic',
      severity: 'high',
      category: 'testing',
      status: 'gap',
      evidence: 'Zero files matched test directory/filename patterns.',
      aiSuggested: false,
      linkedProposalId: prop?.id ?? null,
    });
  }

  if (!analysis.hygiene.hasCI) {
    const id = 'finding-generic-no-ci';
    const prop = buildCiProposal(id);
    findings.push({
      id,
      checklistId: null,
      title: 'No CI workflow configuration',
      description: 'Generic hygiene check: no GitHub Actions, GitLab CI, or CircleCI pipeline found.',
      origin: 'generic',
      severity: 'medium',
      category: 'ci',
      status: 'gap',
      evidence: 'No CI configuration file detected.',
      aiSuggested: false,
      linkedProposalId: prop.id,
    });
  }

  if (!analysis.hygiene.hasLockfile) {
    const id = 'finding-generic-no-lockfile';
    let linkedProposalId: string | null = null;
    if (pkgJson && !ingest.manifest.some((m) => getBaseName(m.path) === '.npmrc')) {
      const npmrcPath = withRootPrefix(rootPrefix, '.npmrc');
      const npmrcContent = [
        '# Enforce deterministic lockfile generation on local npm install',
        'package-lock=true',
        '',
      ].join('\n');
      const change = buildFileChange(npmrcPath, null, npmrcContent);
      const prop = registerProposal('lockfile-policy', {
        id: 'prop-generated-npmrc-lockfile',
        findingId: id,
        title: 'Add .npmrc lockfile enforcement config',
        why: 'No lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock) was found. Adding .npmrc affects package manager config and requires explicit Tier C approval.',
        rationale: 'No lockfile was found. Browser-only tooling cannot run npm install, so .npmrc guarantees lockfile generation on next install.',
        expectedEffect: `Adds ${npmrcPath} with package-lock=true so running npm install produces a reproducible lockfile.`,
        source: 'generated',
        licence: 'Project-local (generated)',
        licencePolicy: 'Project-generated',
        riskTier: 'C',
        aiSuggested: false,
        filesToAddOrChange: [change],
        targetPaths: [change.path],
        diffPreview: change.unifiedDiff,
        approved: false,
        securityWarnings: [
          'Package manager configuration file (.npmrc) requires explicit Tier C review before applying.',
        ],
      });
      linkedProposalId = prop.id;
    } else {
      const setupPath = withRootPrefix(rootPrefix, 'LOCKFILE_NOTICE.md');
      const content = [
        '# Reproducible Lockfile Required',
        '',
        'No dependency lockfile was detected in this archive.',
        'Run your package manager install locally (`npm install`, `pnpm install`, or `pip freeze > requirements.lock`) and commit the resulting lockfile.',
        '',
      ].join('\n');
      const change = buildFileChange(setupPath, null, content);
      const prop = registerProposal('lockfile-policy', {
        id: 'prop-generated-lockfile-notice',
        findingId: id,
        title: 'Add lockfile generation checklist notice',
        why: 'No lockfile was found in the archive and browser execution cannot run package installation.',
        rationale: 'No lockfile was found in the archive and browser execution cannot run package installation.',
        expectedEffect: `Adds ${setupPath} documenting how to generate and commit a deterministic lockfile.`,
        source: 'generated',
        licence: 'Project-local (generated)',
        licencePolicy: 'Project-generated',
        riskTier: 'A',
        aiSuggested: false,
        filesToAddOrChange: [change],
        targetPaths: [change.path],
        diffPreview: change.unifiedDiff,
        approved: true,
      });
      linkedProposalId = prop.id;
    }

    findings.push({
      id,
      checklistId: null,
      title: 'No dependency lockfile present',
      description: 'Generic hygiene check: reproducible installs require a committed lockfile.',
      origin: 'generic',
      severity: 'medium',
      category: 'reproducibility',
      status: 'gap',
      evidence: 'Zero lockfiles detected.',
      aiSuggested: false,
      linkedProposalId,
    });
  }

  if (!analysis.hygiene.hasEnvExample) {
    const id = 'finding-generic-missing-env-example';
    const prop = buildEnvExampleProposal(id);
    findings.push({
      id,
      checklistId: null,
      title: 'Missing .env.example template',
      description: 'Generic hygiene check: repository lacks .env.example to document environment keys safely.',
      origin: 'generic',
      severity: 'medium',
      category: 'configuration',
      status: 'gap',
      evidence: 'No .env.example, .env.sample, or .env.template found.',
      aiSuggested: false,
      linkedProposalId: prop.id,
    });
  }

  return {
    findings,
    proposals,
    eligibleRegistryIds: eligibleEntries.map((e) => e.id),
    excludedRegistryNotes,
  };
}

export function buildSanitizedFindingsPayload(
  ingest: IngestResult,
  analysis: DeterministicAnalysis,
  profileId: ProfileId,
  modifiers: string[],
  existingFindings: FindingItem[]
) {
  const profile = getProfileDefinition(profileId);
  const chunked = chunkRankedFilesForBudget(ingest, analysis, {
    promptVersion: GAP_ANALYSIS_PROMPT_VERSION,
    extraKeyParts: [profileId, ...modifiers],
    maxBlockBudgetChars: 5_200,
    chunkSizeChars: 650,
    maxChunksPerFile: 3,
    maxFiles: 8,
  });

  const fileBlocks = chunked.fileBlocks.map((b) => ({
    path: b.path,
    importance: b.importance,
    block: b.block,
  }));

  const rawPayload = {
    promptVersion: GAP_ANALYSIS_PROMPT_VERSION,
    contentHashKey: chunked.contentHashKey,
    archiveName: stripUnsafeControlAndBidiChars(ingest.archiveName, false),
    lockedProfile: {
      id: profile.id,
      name: profile.name,
      verticalSlice: profile.vertical_slice,
    },
    activeModifiers: modifiers,
    languages: analysis.languages.slice(0, 6),
    frameworks: analysis.frameworks,
    bundlers: analysis.bundlers,
    dependencies: analysis.dependencies.map((d) => `${d.name}@${d.version} (${d.scope})`),
    entryPoints: analysis.entryPoints.slice(0, 15),
    alreadyDetectedFindings: existingFindings.map((f) => ({
      title: f.title,
      status: f.status,
      origin: f.origin,
    })),
    strippedSecretFilesCount: chunked.strippedSecretFilesCount,
    chunkedFileCount: chunked.chunkedFileCount,
    includedPaths: chunked.includedPaths,
    fileBlocks,
  };

  return enforceJsonPayloadCharLimit(rawPayload, MAX_GEMINI_PAYLOAD_CHARS).payload;
}

export function getFindingsAiPreview(
  ingest: IngestResult,
  analysis: DeterministicAnalysis,
  profileId: ProfileId,
  modifiers: string[],
  existingFindings: FindingItem[]
) {
  const payload = buildSanitizedFindingsPayload(
    ingest,
    analysis,
    profileId,
    modifiers,
    existingFindings
  );
  const previewText = JSON.stringify(payload, null, 2);
  return {
    payload,
    fileCount: payload.includedPaths.length,
    strippedCount: payload.strippedSecretFilesCount,
    charCount: JSON.stringify(payload).length,
    maxChars: MAX_GEMINI_PAYLOAD_CHARS,
    promptVersion: payload.promptVersion,
    contentHashKey: payload.contentHashKey,
    previewText,
  };
}

function extractBarePackageName(specifier: string): string | null {
  if (
    !specifier ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('~/') ||
    /^(?:https?:|data:|virtual:|node:)/.test(specifier)
  ) {
    return null;
  }
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0] ?? null;
}

export function getForbiddenRegistryPackageSet(): Set<string> {
  const registry = getLoadedRegistry();
  return new Set(
    registry
      .filter(
        (r) =>
          !r.proposable_now ||
          r.license_policy !== 'Allow' ||
          r.tier === 'review' ||
          r.tier === 'exclude' ||
          r.tier === 'poor-fit' ||
          r.tier === 'dev-tools'
      )
      .map((r) => r.package.toLowerCase())
  );
}

export function validateGeminiGapSuggestions(raw: unknown): GeminiGapSuggestion[] {
  const checked = validateGapAnalysisSchemaWithReason(raw, getForbiddenRegistryPackageSet());
  if (!checked.ok) return [];
  return checked.data.suggestions;
}

export function materializeGeminiSuggestions(
  suggestions: GeminiGapSuggestion[],
  ingest: IngestResult,
  promptVersion: string = GAP_ANALYSIS_PROMPT_VERSION
): { aiFindings: FindingItem[]; aiProposals: ProposalItem[] } {
  const rootPrefix = detectRootPrefix(ingest);
  const { allowedAndVerified } = getRegistryPackageSet();
  const aiFindings: FindingItem[] = [];
  const aiProposals: ProposalItem[] = [];

  // Collect packages already declared in the uploaded project so existing imports are allowed
  const declaredOriginalPkgs = new Set<string>();
  const pkgJsonFile = hasNodePackageJson(ingest);
  if (pkgJsonFile) {
    try {
      const parsed = JSON.parse(pkgJsonFile.content) as Record<string, unknown>;
      for (const sec of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
        const block = parsed[sec];
        if (block && typeof block === 'object') {
          for (const k of Object.keys(block as Record<string, unknown>)) {
            declaredOriginalPkgs.add(k.toLowerCase());
          }
        }
      }
    } catch {
      // ignore invalid package.json
    }
  }

  suggestions.forEach((s, index) => {
    const resolvedPath =
      rootPrefix && !s.targetPath.startsWith(rootPrefix)
        ? withRootPrefix(rootPrefix, s.targetPath)
        : s.targetPath;

    const existing = ingest.textFiles[resolvedPath]?.content ?? null;
    const writeCheck = validateWriteTargetPath(resolvedPath, {
      action: s.action,
      targetExists: existing !== null,
      allowPackageJson: false,
      forbidCiWithoutTierC: false,
    });
    if (!writeCheck.valid) {
      return;
    }

    // Check if generated code imports an unverified package not in registry.json
    const unverifiedImports: string[] = [];
    if (/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i.test(resolvedPath)) {
      const specifiers = extractImportSpecifiers(s.suggestedContent);
      for (const spec of specifiers) {
        const pkg = extractBarePackageName(spec);
        if (!pkg) continue;
        const lower = pkg.toLowerCase();
        if (NODE_BUILTINS.has(lower)) continue;
        if (!declaredOriginalPkgs.has(lower) && !allowedAndVerified.has(lower)) {
          unverifiedImports.push(pkg);
        }
      }
    }

    const hasUnverifiedPkg = unverifiedImports.length > 0;
    const isCiConfig = isCiOrSecretsAdjacentPath(writeCheck.normalizedPath);
    const effectiveRiskTier: RiskTier =
      hasUnverifiedPkg || isCiConfig ? 'C' : s.riskTier;

    const securityWarnings: string[] = [];
    if (hasUnverifiedPkg) {
      securityWarnings.push(
        `Imports package(s) not in registry, unverified: ${unverifiedImports.join(', ')}. Explicit approval required.`
      );
    }
    if (isCiConfig) {
      securityWarnings.push(
        'Targets a CI/secrets-adjacent config file. Explicit Tier C approval required.'
      );
    }

    const findingId = `finding-ai-${index + 1}`;
    const proposalId = `prop-ai-${index + 1}`;
    const change: ProposalFileChange = {
      path: writeCheck.normalizedPath,
      action: s.action,
      beforeContent: existing,
      afterContent: s.suggestedContent,
      unifiedDiff: createUnifiedDiff(writeCheck.normalizedPath, existing, s.suggestedContent),
    };

    aiFindings.push({
      id: findingId,
      checklistId: null,
      title: s.findingTitle,
      description: s.findingDescription,
      origin: 'ai-gap',
      severity: s.severity,
      category: s.category,
      status: 'gap',
      evidence: `Identified by Gemini reasoning (${promptVersion}) beyond the static completeness checklist.`,
      aiSuggested: true,
      promptVersion,
      linkedProposalId: proposalId,
    });

    aiProposals.push({
      id: proposalId,
      findingId,
      title: s.proposalTitle,
      why: s.why,
      rationale: s.why,
      expectedEffect: s.expectedEffect,
      source: 'generated',
      licence: hasUnverifiedPkg ? 'Unverified external package' : 'Project-local (generated)',
      licencePolicy: 'Project-generated',
      riskTier: effectiveRiskTier,
      aiSuggested: true,
      promptVersion,
      filesToAddOrChange: [change],
      targetPaths: [change.path],
      diffPreview: change.unifiedDiff,
      approved: effectiveRiskTier === 'A' && !hasUnverifiedPkg && !isCiConfig,
      unverifiedPackage: hasUnverifiedPkg,
      unverifiedPackageNames: hasUnverifiedPkg ? unverifiedImports : undefined,
      securityWarnings: securityWarnings.length > 0 ? securityWarnings : undefined,
    });
  });

  return { aiFindings, aiProposals };
}
