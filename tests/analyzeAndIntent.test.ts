import { beforeEach, describe, expect, it } from 'bun:test';
import JSZip from 'jszip';
import {
  buildSanitizedIntentPayload,
  classifyProjectIntent,
  detectIntentContradiction,
  validateGeminiIntentAdvice,
} from '../src/lib/intentClassifier';
import { runDeterministicAnalysis } from '../src/lib/projectAnalyzer';
import { ingestZipBuffer } from '../src/lib/zipIngest';
import { usePipelineStore } from '../src/store/pipelineStore';

describe('Analyse & Intent Lock Stages', () => {
  beforeEach(() => {
    usePipelineStore.getState().resetPipeline();
  });

  it('detects languages, dependencies, package manager, entry points, frameworks, bundlers, and hygiene booleans', async () => {
    const zip = new JSZip();
    zip.file(
      'package.json',
      JSON.stringify({
        name: 'arcade-runner',
        scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' },
        dependencies: { phaser: '^3.80.0' },
        devDependencies: { vite: '^5.0.0', vitest: '^2.0.0', typescript: '^5.6.0' },
      })
    );
    zip.file('package-lock.json', '{}');
    zip.file('tsconfig.json', '{}');
    zip.file('index.html', '<!doctype html><html><body><canvas id="game"></canvas></body></html>');
    zip.file(
      'src/main.ts',
      'import Phaser from "phaser"; requestAnimationFrame(() => {}); const g = new Phaser.Game({});'
    );
    zip.file('tests/score.test.ts', 'expect(1).toBe(1);');
    zip.file('.github/workflows/ci.yml', 'name: CI\n');
    zip.file('README.md', '# Arcade Runner Game\nUse WASD controls to play.');
    zip.file('LICENSE', 'MIT');
    zip.file('.env.example', 'PORT=3000\n');

    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const ingested = await ingestZipBuffer('arcade-runner.zip', buf);
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const analysis = runDeterministicAnalysis(ingested.result);
    expect(analysis.primaryLanguage).toBe('TypeScript');
    expect(analysis.packageManagers).toContain('npm');
    expect(analysis.frameworks).toContain('Phaser');
    expect(analysis.bundlers).toContain('Vite');
    expect(analysis.hygiene.hasTests).toBe(true);
    expect(analysis.hygiene.hasCI).toBe(true);
    expect(analysis.hygiene.hasLockfile).toBe(true);
    expect(analysis.hygiene.hasReadme).toBe(true);
    expect(analysis.hygiene.hasLicense).toBe(true);
    expect(analysis.hygiene.hasEnvExample).toBe(true);
  });

  it('auto-locks 2D browser game at 80%+ with a clear lead, while ambiguous projects request confirmation', async () => {
    const gameZip = new JSZip();
    gameZip.file(
      'package.json',
      JSON.stringify({ dependencies: { phaser: '^3.80.0', howler: '^2.2.4' } })
    );
    gameZip.file('project.godot', '');
    gameZip.file('index.html', '<html><body><canvas></canvas></body></html>');
    gameZip.file('sprites/hero.png', new Uint8Array([137, 80, 78, 71, 0, 1]));
    gameZip.file('src/game.js', 'requestAnimationFrame(tick); new AudioContext();');
    gameZip.file('README.md', '# Space Game\nControls: WASD');

    const gameBuf = await gameZip.generateAsync({ type: 'arraybuffer' });
    const gameIngest = await ingestZipBuffer('space-game.zip', gameBuf);
    expect(gameIngest.ok).toBe(true);
    if (!gameIngest.ok) return;

    const gameAnalysis = runDeterministicAnalysis(gameIngest.result);
    const gameClass = classifyProjectIntent(gameIngest.result, gameAnalysis);
    expect(gameClass.rankedProfiles[0]?.profileId).toBe('browser-game-2d');
    expect(gameClass.rankedProfiles[0]?.confidence).toBeGreaterThanOrEqual(80);
    expect(gameClass.autoLockEligible).toBe(true);

    const ambigZip = new JSZip();
    ambigZip.file('package.json', JSON.stringify({ name: 'utility-scripts' }));
    ambigZip.file('notes.txt', 'hello');
    const ambigBuf = await ambigZip.generateAsync({ type: 'arraybuffer' });
    const ambigIngest = await ingestZipBuffer('utility.zip', ambigBuf);
    expect(ambigIngest.ok).toBe(true);
    if (!ambigIngest.ok) return;

    const ambigAnalysis = runDeterministicAnalysis(ambigIngest.result);
    const ambigClass = classifyProjectIntent(ambigIngest.result, ambigAnalysis);
    expect(ambigClass.autoLockEligible).toBe(false);
  });

  it('redacts README secrets from Gemini intent payload and validates structured advice', async () => {
    const zip = new JSZip();
    const fakeSecret = ['ghp_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'].join('');
    zip.file('package.json', JSON.stringify({ name: 'test' }));
    zip.file('README.md', `Token for testing: ${fakeSecret}\n`);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const ingested = await ingestZipBuffer('secret-readme.zip', buf);
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const analysis = runDeterministicAnalysis(ingested.result);
    const classification = classifyProjectIntent(ingested.result, analysis);
    const payload = buildSanitizedIntentPayload(
      ingested.result,
      analysis,
      classification.rankedProfiles,
      classification.suggestedModifiers
    );

    expect(JSON.stringify(payload)).not.toContain(fakeSecret);

    expect(
      validateGeminiIntentAdvice(
        {
          recommendedProfileId: 'api-service',
          confidence: 88,
          reasoning: 'Detected route handlers.',
          suggestedModifiers: ['typescript', 'unknown-mod'],
          cautionNotes: [],
        },
        'gemini-4-hydrogen'
      )?.suggestedModifiers
    ).toEqual(['typescript']);

    expect(
      validateGeminiIntentAdvice(
        { recommendedProfileId: 'invalid-profile', confidence: 90, reasoning: 'nope' },
        'gemini-4-hydrogen'
      )
    ).toBeNull();
  });

  it('holds session lock across re-analysis and surfaces contradiction re-pivot', async () => {
    const zip = new JSZip();
    zip.file('package.json', JSON.stringify({ dependencies: { express: '^4.19.0', zod: '^3.23.0' } }));
    zip.file('server.ts', 'import express from "express"; const app = express(); app.get("/health", () => {});');
    zip.file('Dockerfile', 'FROM node:22');
    zip.file('openapi.yaml', 'openapi: 3.1.0');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    await usePipelineStore.getState().ingestArrayBuffer('api.zip', buf);
    usePipelineStore.getState().advanceFromUpload();
    usePipelineStore.getState().lockIntent('web-page', [], 'user-override');
    usePipelineStore.getState().runAnalysis();

    const state = usePipelineStore.getState();
    expect(state.intent.status).toBe('locked');
    expect(state.intent.projectKind).toBe('web-page');
    expect(state.intent.contradiction?.detected).toBe(true);
    expect(state.intent.contradiction?.suggestedProfileId).toBe('api-service');

    const directContradiction = detectIntentContradiction(
      'web-page',
      state.intent.rankedProfiles,
      state.analysis.result!
    );
    expect(directContradiction?.suggestedProfileId).toBe('api-service');

    usePipelineStore.getState().repivotToSuggestedProfile();
    expect(usePipelineStore.getState().intent.projectKind).toBe('api-service');
  });
});
