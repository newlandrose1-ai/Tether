import { beforeEach, describe, expect, it } from 'bun:test';
import JSZip from 'jszip';
import {
  buildSanitizedFindingsPayload,
  checkRegistryEntryEligibility,
  generateFindingsAndProposals,
  getLoadedLicencePolicies,
  getLoadedRegistry,
  materializeGeminiSuggestions,
  validateGeminiGapSuggestions,
} from '../src/lib/findingsEngine';
import { runDeterministicAnalysis } from '../src/lib/projectAnalyzer';
import { ingestZipBuffer } from '../src/lib/zipIngest';
import { usePipelineStore } from '../src/store/pipelineStore';

describe('Findings & Proposals Stage', () => {
  beforeEach(() => {
    usePipelineStore.getState().resetPipeline();
  });

  it('loads all 52 registry entries and 13 licence policy rules from separate JSON files', () => {
    const registry = getLoadedRegistry();
    const policies = getLoadedLicencePolicies();
    expect(registry.length).toBe(52);
    expect(policies.length).toBe(13);
    expect(policies.find((p) => p.license === 'MIT')?.policy).toBe('Allow');
    expect(policies.find((p) => p.license === 'GPL-3.0')?.policy).toBe('Block');
    expect(policies.find((p) => p.license === 'LGPL-3.0')?.policy).toBe('Warn');
    expect(policies.find((p) => p.license === 'Not stated')?.policy).toBe('Unverified');
  });

  it('enforces registry matching rules: blocks Warn/Block/Not stated/review/exclude/poor-fit/dev-tools and unsatisfied requires/conflicts_with', async () => {
    const zip = new JSZip();
    zip.file(
      'package.json',
      JSON.stringify({
        name: 'my-phaser-game',
        dependencies: { phaser: '^3.80.0', 'planck-js': '^1.3.0' },
        devDependencies: { vite: '^5.0.0' },
      })
    );
    zip.file('index.html', '<html><body><canvas></canvas></body></html>');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const ingested = await ingestZipBuffer('phaser-game.zip', buf);
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const analysis = runDeterministicAnalysis(ingested.result);
    const registry = getLoadedRegistry();
    const byId = new Map(registry.map((r) => [r.id, r]));

    // Poor-fit / dev-tools / review / exclude / Not stated MUST be excluded
    expect(
      checkRegistryEntryEligibility(byId.get('input-hotkeys-js')!, 'browser-game-2d', analysis, ingested.result)
        .eligible
    ).toBe(false);
    expect(
      checkRegistryEntryEligibility(byId.get('ui-tweakpane')!, 'browser-game-2d', analysis, ingested.result)
        .eligible
    ).toBe(false);
    expect(
      checkRegistryEntryEligibility(byId.get('audio-websfx')!, 'browser-game-2d', analysis, ingested.result)
        .eligible
    ).toBe(false);
    expect(
      checkRegistryEntryEligibility(byId.get('audio-web-audio-engine')!, 'browser-game-2d', analysis, ingested.result)
        .eligible
    ).toBe(false);
    expect(
      checkRegistryEntryEligibility(byId.get('ui-preact')!, 'browser-game-2d', analysis, ingested.result)
        .eligible
    ).toBe(false);

    // requires: engine=pixi fails on Phaser project
    expect(
      checkRegistryEntryEligibility(byId.get('audio-pixi-sound')!, 'browser-game-2d', analysis, ingested.result)
        .eligible
    ).toBe(false);

    // conflicts_with: planck-js blocks physics-planck
    expect(
      checkRegistryEntryEligibility(byId.get('physics-planck')!, 'browser-game-2d', analysis, ingested.result)
        .eligible
    ).toBe(false);

    // Valid core MIT / Apache-2.0 entries with satisfied requirements pass
    expect(
      checkRegistryEntryEligibility(byId.get('audio-howler')!, 'browser-game-2d', analysis, ingested.result)
        .eligible
    ).toBe(true);
    expect(
      checkRegistryEntryEligibility(byId.get('test-vitest')!, 'browser-game-2d', analysis, ingested.result)
        .eligible
    ).toBe(true);
  });

  it('produces separate findings (profile checklist + generic) and risk-tiered proposals with Tier A pre-ticked and diff previews', async () => {
    const zip = new JSZip();
    zip.file(
      'package.json',
      JSON.stringify({
        name: 'incomplete-game',
        dependencies: { phaser: '^3.80.0' },
        devDependencies: { vite: '^5.0.0' },
      })
    );
    zip.file('index.html', '<html><body><canvas></canvas></body></html>');
    zip.file('src/main.js', 'console.log("boot");');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const ingested = await ingestZipBuffer('incomplete-game.zip', buf);
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const analysis = runDeterministicAnalysis(ingested.result);
    const result = generateFindingsAndProposals(
      ingested.result,
      analysis,
      'browser-game-2d',
      []
    );

    // 1. Findings include both profile checklist items AND the 4 generic hygiene checks
    const genericIds = result.findings
      .filter((f) => f.origin === 'generic')
      .map((f) => f.id);
    expect(genericIds).toContain('finding-generic-no-tests');
    expect(genericIds).toContain('finding-generic-no-ci');
    expect(genericIds).toContain('finding-generic-no-lockfile');
    expect(genericIds).toContain('finding-generic-missing-env-example');

    // 2. Proposals prefer registry libraries for audio (howler), save/load (idb-keyval), and tests (vitest)
    const propPackages = result.proposals
      .filter((p) => p.source === 'registry-library')
      .map((p) => p.packageName);
    expect(propPackages).toContain('howler');
    expect(propPackages).toContain('idb-keyval');
    expect(propPackages).toContain('vitest');

    // 3. Never copies reference repos
    expect(result.proposals.some((p) => p.source === 'reference-repo')).toBe(false);

    // 4. Tier A proposals are pre-ticked, Tier B & C are not pre-ticked
    const tierA = result.proposals.filter((p) => p.riskTier === 'A');
    const tierB = result.proposals.filter((p) => p.riskTier === 'B');
    const tierC = result.proposals.filter((p) => p.riskTier === 'C');
    expect(tierA.length).toBeGreaterThan(0);
    expect(tierB.length).toBeGreaterThan(0);
    expect(tierC.length).toBeGreaterThan(0);
    expect(tierA.every((p) => p.approved)).toBe(true);
    expect(tierB.every((p) => !p.approved)).toBe(true);
    expect(tierC.every((p) => !p.approved)).toBe(true);

    // 5. Every proposal links to a finding, has exact target files, licence, expectedEffect, why, and diffPreview
    const findingIdSet = new Set(result.findings.map((f) => f.id));
    for (const p of result.proposals) {
      expect(findingIdSet.has(p.findingId)).toBe(true);
      expect(p.filesToAddOrChange.length).toBeGreaterThan(0);
      expect(p.why.length).toBeGreaterThan(0);
      expect(p.expectedEffect.length).toBeGreaterThan(0);
      expect(p.licence.length).toBeGreaterThan(0);
      expect(p.diffPreview).toContain('@@');
    }
  });

  it('redacts secrets in Gemini findings payload, validates schema & blocks forbidden packages, and marks AI proposals', async () => {
    const zip = new JSZip();
    const fakeSecret = ['sk_live_', '51NxTestKey00000000000000000'].join('');
    zip.file('package.json', JSON.stringify({ name: 'api', dependencies: { express: '^4.19.0' } }));
    zip.file('.env', `STRIPE_KEY=${fakeSecret}\n`);
    zip.file('server.js', 'const express = require("express");');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const ingested = await ingestZipBuffer('api.zip', buf);
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const analysis = runDeterministicAnalysis(ingested.result);
    const det = generateFindingsAndProposals(ingested.result, analysis, 'api-service', []);
    const payload = buildSanitizedFindingsPayload(
      ingested.result,
      analysis,
      'api-service',
      [],
      det.findings
    );
    expect(JSON.stringify(payload)).not.toContain(fakeSecret);

    const validated = validateGeminiGapSuggestions({
      suggestions: [
        {
          findingTitle: 'Missing graceful SIGTERM shutdown handler',
          findingDescription: 'Server should drain open connections on SIGTERM.',
          category: 'reliability',
          severity: 'medium',
          proposalTitle: 'Add SIGTERM graceful shutdown helper',
          why: 'Prevents dropped requests during container restarts.',
          expectedEffect: 'Adds src/lifecycle/shutdown.js.',
          riskTier: 'C',
          targetPath: 'src/lifecycle/shutdown.js',
          action: 'add',
          suggestedContent: 'export function registerShutdown(server) { process.on("SIGTERM", () => server.close()); }\n',
        },
        {
          findingTitle: 'Bad package attempt',
          findingDescription: 'Should be rejected.',
          category: 'audio',
          severity: 'low',
          proposalTitle: 'Install websfx',
          why: 'Bad',
          expectedEffect: 'Bad',
          riskTier: 'B',
          targetPath: 'package.json',
          action: 'modify',
          suggestedContent: '{}',
        },
        {
          findingTitle: 'Traversal attempt',
          findingDescription: 'Should be rejected.',
          category: 'security',
          severity: 'high',
          proposalTitle: 'Bad path',
          why: 'Bad',
          expectedEffect: 'Bad',
          riskTier: 'A',
          targetPath: '../outside.txt',
          action: 'add',
          suggestedContent: 'x',
        },
      ],
    });

    expect(validated.length).toBe(1);
    const { aiFindings, aiProposals } = materializeGeminiSuggestions(validated, ingested.result);
    expect(aiFindings[0]?.aiSuggested).toBe(true);
    expect(aiProposals[0]?.aiSuggested).toBe(true);
    expect(aiProposals[0]?.approved).toBe(false);
  });

  it('does not modify original rawEntriesByPath during Findings & Proposals generation', async () => {
    const zip = new JSZip();
    zip.file('index.html', '<html><body><h1>Hello</h1></body></html>');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    await usePipelineStore.getState().ingestArrayBuffer('site.zip', buf);
    const beforeKeys = Object.keys(usePipelineStore.getState().ingest!.rawEntriesByPath);

    usePipelineStore.getState().advanceFromUpload();
    usePipelineStore.getState().lockIntent('web-page', [], 'user-override');
    usePipelineStore.getState().advanceFromIntent();

    const state = usePipelineStore.getState();
    expect(state.currentStage).toBe('findings');
    expect(state.findings.status).toBe('ready');
    expect(state.findings.proposals.length).toBeGreaterThan(0);
    expect(Object.keys(state.ingest!.rawEntriesByPath)).toEqual(beforeKeys);
    expect(state.apply.modifiedPaths).toEqual([]);
  });
});
