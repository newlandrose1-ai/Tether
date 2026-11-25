import { beforeEach, describe, expect, it } from 'bun:test';
import JSZip from 'jszip';
import {
  applyApprovedProposalsSequentially,
  formatGeneratedFileContent,
  mergePackageJsonMinimal,
} from '../src/lib/applyEngine';
import { runDeterministicAnalysis } from '../src/lib/projectAnalyzer';
import {
  checkAllImportsResolve,
  checkPackageJsonDependencies,
  validateJsonContent,
  validateJsTsSyntax,
} from '../src/lib/staticChecks';
import {
  runVerificationAndBuildArtifacts,
  VERIFICATION_HONESTY_NOTICE,
} from '../src/lib/verifyEngine';
import { ingestZipBuffer, sha256Hex } from '../src/lib/zipIngest';
import { usePipelineStore } from '../src/store/pipelineStore';
import type { ProposalItem } from '../src/types/pipeline';

describe('Approve, Apply, Verify, and Download Stages', () => {
  beforeEach(() => {
    usePipelineStore.getState().resetPipeline();
  });

  it('merges package.json with minimal edits preserving key order, 4-space indentation, and untouched sections', () => {
    const original = [
      '{',
      '    "name": "preserve-order-app",',
      '    "private": true,',
      '    "version": "1.2.3",',
      '    "scripts": {',
      '        "dev": "vite",',
      '        "build": "vite build"',
      '    },',
      '    "dependencies": {',
      '        "phaser": "^3.80.0"',
      '    },',
      '    "customFlag": { "keepMe": true }',
      '}',
      '',
    ].join('\n');

    const proposed = JSON.stringify(
      {
        name: 'preserve-order-app',
        dependencies: {
          phaser: '^3.80.0',
          howler: '^2.2.4',
        },
        devDependencies: {
          vitest: '^2.1.0',
        },
      },
      null,
      2
    );

    const merged = mergePackageJsonMinimal(original, proposed);
    const parsed = JSON.parse(merged) as Record<string, unknown>;

    // Existing top-level key order preserved
    expect(Object.keys(parsed)).toEqual([
      'name',
      'private',
      'version',
      'scripts',
      'dependencies',
      'customFlag',
      'devDependencies',
    ]);
    // 4-space indentation preserved in merged lines & untouched line kept verbatim
    expect(merged).toContain('    "customFlag": { "keepMe": true }');
    expect(merged).toContain('        "howler": "^2.2.4"');
    expect(merged).toContain('        "vitest": "^2.1.0"');
    expect((parsed.dependencies as Record<string, string>).phaser).toBe('^3.80.0');
  });

  it('formats only newly generated files and leaves untouched existing files unformatted', () => {
    const formatted = formatGeneratedFileContent('config.json', '{"a":1,"b":2}   \n\n\n');
    expect(formatted).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
  });

  it('applies proposals sequentially on a copy, rolls back ONLY failing proposals, and generates CHANGELOG.md + NOTICE.md', async () => {
    const zip = new JSZip();
    const rawMainJs = 'const   x=1;   \nconsole.log(  x );\n';
    zip.file(
      'package.json',
      JSON.stringify(
        {
          name: 'phaser-sample',
          version: '1.0.0',
          dependencies: { phaser: '^3.80.0' },
        },
        null,
        2
      )
    );
    zip.file('src/main.js', rawMainJs);
    zip.file('index.html', '<!doctype html><html><body><canvas></canvas></body></html>');
    zip.file('bin/start.sh', '#!/usr/bin/env bash\necho ok\n', { unixPermissions: 0o100755 });

    const buf = await zip.generateAsync({ type: 'arraybuffer', platform: 'UNIX' });
    const ingested = await ingestZipBuffer('phaser-sample.zip', buf);
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const origMainSha = await sha256Hex(ingested.result.rawEntriesByPath['src/main.js']);
    const analysis = runDeterministicAnalysis(ingested.result);

    const fakeSecret = ['sk_live_', '51NxTestKey00000000000000000'].join('');

    const proposals: ProposalItem[] = [
      {
        id: 'prop-good-env',
        findingId: 'f1',
        title: 'Add .env.example',
        why: 'Documents runtime variables.',
        rationale: 'Safe additive file.',
        expectedEffect: 'Adds .env.example.',
        source: 'generated',
        licence: 'Project-generated',
        licencePolicy: 'Project-generated',
        riskTier: 'A',
        aiSuggested: false,
        filesToAddOrChange: [
          {
            path: '.env.example',
            action: 'add',
            beforeContent: null,
            afterContent: 'PORT=3000   \nNODE_ENV=development\n\n',
            unifiedDiff: '@@',
          },
        ],
        targetPaths: ['.env.example'],
        diffPreview: '@@',
        approved: true,
      },
      {
        id: 'prop-bad-syntax',
        findingId: 'f2',
        title: 'Broken TS helper (should roll back)',
        why: 'Test rollback',
        rationale: 'Test',
        expectedEffect: 'Should fail syntax check.',
        source: 'generated',
        licence: 'Project-generated',
        licencePolicy: 'Project-generated',
        riskTier: 'C',
        aiSuggested: false,
        filesToAddOrChange: [
          {
            path: 'src/broken.ts',
            action: 'add',
            beforeContent: null,
            afterContent: 'export function broken( { return ;;',
            unifiedDiff: '@@',
          },
        ],
        targetPaths: ['src/broken.ts'],
        diffPreview: '@@',
        approved: true,
      },
      {
        id: 'prop-bad-secret',
        findingId: 'f3',
        title: 'Leaked secret proposal (should roll back)',
        why: 'Test secret rollback',
        rationale: 'Test',
        expectedEffect: 'Should fail secret scan.',
        source: 'generated',
        licence: 'Project-generated',
        licencePolicy: 'Project-generated',
        riskTier: 'C',
        aiSuggested: false,
        filesToAddOrChange: [
          {
            path: 'src/leak.js',
            action: 'add',
            beforeContent: null,
            afterContent: `export const KEY = "${fakeSecret}";\n`,
            unifiedDiff: '@@',
          },
        ],
        targetPaths: ['src/leak.js'],
        diffPreview: '@@',
        approved: true,
      },
      {
        id: 'prop-good-howler',
        findingId: 'f4',
        title: 'Add howler audio dependency',
        why: 'Audio playback.',
        rationale: 'MIT registry entry.',
        expectedEffect: 'Adds howler to package.json and src/audio/sound.js.',
        source: 'registry-library',
        registryEntryId: 'audio-howler',
        packageName: 'howler',
        licence: 'MIT',
        licencePolicy: 'Allow',
        riskTier: 'B',
        aiSuggested: false,
        filesToAddOrChange: [
          {
            path: 'package.json',
            action: 'modify',
            beforeContent: null,
            afterContent: JSON.stringify(
              {
                name: 'phaser-sample',
                version: '1.0.0',
                dependencies: { phaser: '^3.80.0', howler: '^2.2.4' },
              },
              null,
              2
            ),
            unifiedDiff: '@@',
          },
          {
            path: 'src/audio/sound.js',
            action: 'add',
            beforeContent: null,
            afterContent: "import { Howl } from 'howler';\nexport const createSfx = (src) => new Howl({ src: [src] });\n",
            unifiedDiff: '@@',
          },
        ],
        targetPaths: ['package.json', 'src/audio/sound.js'],
        diffPreview: '@@',
        approved: true,
      },
    ];

    const applyResult = applyApprovedProposalsSequentially(
      ingested.result,
      analysis,
      'browser-game-2d',
      [],
      proposals
    );

    expect(applyResult.appliedProposalIds).toEqual(['prop-good-env', 'prop-good-howler']);
    expect(applyResult.rolledBackProposalIds).toEqual(['prop-bad-syntax', 'prop-bad-secret']);
    expect(applyResult.workingFiles['src/broken.ts']).toBeUndefined();
    expect(applyResult.workingFiles['src/leak.js']).toBeUndefined();
    expect(applyResult.workingFiles['.env.example']).toBeDefined();
    expect(applyResult.workingFiles['src/audio/sound.js']).toBeDefined();
    expect(applyResult.workingFiles['CHANGELOG.md']).toBeDefined();
    expect(applyResult.workingFiles['NOTICE.md']).toBeDefined();
    expect(applyResult.noticeMarkdown).toContain('howler');
    expect(applyResult.noticeMarkdown).toContain('MIT');
    expect(applyResult.changelogMarkdown).toContain(VERIFICATION_HONESTY_NOTICE);

    // Original rawEntriesByPath untouched
    expect(ingested.result.rawEntriesByPath['src/audio/sound.js']).toBeUndefined();
    expect(await sha256Hex(applyResult.workingFiles['src/main.js'])).toBe(origMainSha);

    // Verify re-packaged archive
    const verified = await runVerificationAndBuildArtifacts(
      ingested.result,
      analysis,
      {
        status: 'locked',
        rankedProfiles: [],
        autoLockEligible: true,
        autoLockReason: 'test',
        projectKind: 'browser-game-2d',
        modifiers: [],
        suggestedModifiers: [],
        lockSource: 'user-override',
        lockedByUser: true,
        lockedAt: new Date().toISOString(),
        geminiStatus: 'idle',
        geminiAdvice: null,
        geminiError: null,
        contradiction: null,
      },
      applyResult
    );

    expect(verified.structuralPassed).toBe(true);
    expect(verified.staticPassed).toBe(true);
    expect(verified.secretScanPassed).toBe(true);
    expect(verified.buildsAndTestsRun).toBe(false);
    expect(verified.honestyNotice).toBe('Builds and tests were not run.');
    expect(verified.untouchedVerifiedCount).toBe(verified.untouchedTotalCount);
    expect(verified.untouchedTotalCount).toBe(3); // src/main.js, index.html, bin/start.sh

    // Confirm execute permission preserved in reopened output .zip
    const reopened = await JSZip.loadAsync(verified.outputZipBytes);
    const reopenedSh = reopened.file('bin/start.sh');
    expect(reopenedSh).toBeTruthy();
    const perms = typeof reopenedSh?.unixPermissions === 'number' ? reopenedSh.unixPermissions : 0;
    expect((perms & 0o111) !== 0).toBe(true);

    // Confirm untouched src/main.js inside reopened .zip is byte-identical
    const reopenedMainBytes = await reopened.file('src/main.js')!.async('uint8array');
    expect(await sha256Hex(reopenedMainBytes)).toBe(origMainSha);
    expect(new TextDecoder().decode(reopenedMainBytes)).toBe(rawMainJs);

    expect(verified.unifiedPatchDiff).toContain('+++ b/CHANGELOG.md');
    expect(verified.beforeAfterReportMarkdown).toContain('Builds and tests were not run.');
  });

  it('static checks detect invalid JSON, JS/TS syntax errors, unresolved imports, and duplicate/conflicting dependencies', () => {
    expect(validateJsonContent('bad.json', '{ "a": }').valid).toBe(false);
    expect(validateJsTsSyntax('bad.ts', 'const x: number = ;').valid).toBe(false);
    expect(validateJsTsSyntax('good.ts', 'export const x: number = 42;').valid).toBe(true);

    const depCheck = checkPackageJsonDependencies({
      'package.json': JSON.stringify({
        dependencies: { planck: '^1.0.0', 'planck-js': '^1.3.0' },
        devDependencies: { planck: '^1.0.0' },
      }),
    });
    expect(depCheck.passed).toBe(false);
    expect(depCheck.issues.some((i) => i.includes('both dependencies and devDependencies'))).toBe(
      true
    );
    expect(depCheck.issues.some((i) => i.includes('conflicting packages'))).toBe(true);

    const importCheck = checkAllImportsResolve(
      {
        'src/index.ts': "import './missing-local';\nimport chalk from 'undeclared-pkg';\n",
      },
      new Set(['src/index.ts', 'package.json']),
      new Set(['phaser']),
      true
    );
    expect(importCheck.passed).toBe(false);
    expect(importCheck.unresolvedImports.length).toBe(2);
  });

  it('completes the full Upload > Analyse > Intent > Findings > Approve > Apply > Verify > Download store flow', async () => {
    const zip = new JSZip();
    zip.file(
      'package.json',
      JSON.stringify(
        {
          name: 'landing-site',
          version: '1.0.0',
          scripts: { build: 'vite build' },
          devDependencies: { vite: '^5.0.0' },
        },
        null,
        2
      )
    );
    zip.file('index.html', '<!doctype html><html><head><title>Site</title></head><body><main></main></body></html>');
    zip.file('src/app.js', 'console.log("hello");\n');

    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const store = usePipelineStore.getState();

    await store.ingestArrayBuffer('landing-site.zip', buf);
    usePipelineStore.getState().advanceFromUpload();
    usePipelineStore.getState().lockIntent('web-page', [], 'user-override');
    usePipelineStore.getState().advanceFromIntent();
    usePipelineStore.getState().advanceFromFindings();

    expect(usePipelineStore.getState().currentStage).toBe('approve');

    usePipelineStore.getState().executeApplyStage();
    expect(usePipelineStore.getState().currentStage).toBe('apply');
    expect(usePipelineStore.getState().apply.status).toBe('applied');
    expect(usePipelineStore.getState().apply.appliedProposalIds.length).toBeGreaterThan(0);

    await usePipelineStore.getState().executeVerifyStage();
    const afterVerify = usePipelineStore.getState();
    expect(afterVerify.currentStage).toBe('verify');
    expect(afterVerify.verify.status).toBe('complete');
    expect(afterVerify.verify.structuralPassed).toBe(true);
    expect(afterVerify.verify.staticPassed).toBe(true);
    expect(afterVerify.verify.secretScanPassed).toBe(true);
    expect(afterVerify.verify.buildsAndTestsRun).toBe(false);
    expect(afterVerify.verify.honestyNotice).toBe('Builds and tests were not run.');

    afterVerify.advanceFromVerify();
    const afterDownload = usePipelineStore.getState();
    expect(afterDownload.currentStage).toBe('download');
    expect(afterDownload.download.status).toBe('ready');
    expect(afterDownload.download.outputArchiveName).toBe('landing-site-upgraded.zip');
    expect(afterDownload.download.changelogMarkdown).toContain('# Upgrade Changelog');
    expect(afterDownload.download.noticeMarkdown).toContain('# Third-Party Notices');
    expect(afterDownload.download.unifiedPatchDiff).toContain('+++ b/');
    expect(afterDownload.download.beforeAfterReportMarkdown).toContain(
      'Builds and tests were not run.'
    );
  });
});
