import { beforeEach, describe, expect, it } from 'bun:test';
import JSZip from 'jszip';
import {
  GAP_ANALYSIS_PROMPT_VERSION,
  GAP_ANALYSIS_SYSTEM_INSTRUCTION,
  buildGapAnalysisPrompt,
  validateGapAnalysisSchemaWithReason,
} from '../src/ai/prompts/gapAnalysis';
import {
  INTENT_PROMPT_VERSION,
  INTENT_SYSTEM_INSTRUCTION,
  buildIntentPrompt,
  validateIntentSchemaWithReason,
} from '../src/ai/prompts/intentClassification';
import {
  GAP_ANALYSIS_RESPONSE_SCHEMA,
  INTENT_RESPONSE_SCHEMA,
} from '../src/ai/schemas/geminiSchemas.server';
import { chunkRankedFilesForBudget, rankFilesByImportance } from '../src/lib/aiChunking';
import {
  GEMINI_LOW_TEMPERATURE,
  GeminiClientError,
  clearServerAiCache,
  executeStructuredGeminiCall,
  resetJobBudget,
} from '../src/lib/geminiClient';
import { runDeterministicAnalysis } from '../src/lib/projectAnalyzer';
import { ingestZipBuffer } from '../src/lib/zipIngest';
import { usePipelineStore } from '../src/store/pipelineStore';

describe('Gemini Reliability Pass', () => {
  beforeEach(() => {
    clearServerAiCache();
    resetJobBudget();
    usePipelineStore.getState().resetPipeline();
  });

  it('ranks manifests > entries > configs > readmes > source and chunks large files with stable contentHashKey', async () => {
    const zip = new JSZip();
    zip.file('package.json', JSON.stringify({ name: 'chunk-test', dependencies: { express: '^4.19.0' } }));
    zip.file('package-lock.json', '{"lockfileVersion":3}');
    zip.file('server.ts', `import express from 'express';\n${'// line\n'.repeat(250)}`);
    zip.file('tsconfig.json', '{"compilerOptions":{"strict":true}}');
    zip.file('README.md', '# Chunk Test\nSome README notes.');
    zip.file('src/helper.ts', 'export const help = 1;\n');
    zip.file('.env.local', 'API_KEY=ghp_123456789012345678901234567890123456\n');

    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const ingested = await ingestZipBuffer('chunk-test.zip', buf);
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const analysis = runDeterministicAnalysis(ingested.result);
    const { ranked, strippedSecretFilesCount } = rankFilesByImportance(ingested.result, analysis);
    expect(strippedSecretFilesCount).toBe(1);
    expect(ranked.some((r) => r.path === 'package-lock.json')).toBe(false);
    expect(ranked[0]?.importance).toBe('manifest');
    expect(ranked[0]?.path).toBe('package.json');

    const chunked1 = chunkRankedFilesForBudget(ingested.result, analysis, {
      promptVersion: INTENT_PROMPT_VERSION,
      chunkSizeChars: 400,
      maxChunksPerFile: 2,
      maxBlockBudgetChars: 3_000,
    });
    const chunked2 = chunkRankedFilesForBudget(ingested.result, analysis, {
      promptVersion: INTENT_PROMPT_VERSION,
      chunkSizeChars: 400,
      maxChunksPerFile: 2,
      maxBlockBudgetChars: 3_000,
    });

    expect(chunked1.contentHashKey).toBe(chunked2.contentHashKey);
    expect(chunked1.chunkedFileCount).toBeGreaterThanOrEqual(1);
    expect(chunked1.fileBlocks.some((b) => b.block.includes('chunk="1/'))).toBe(true);
    expect(chunked1.includedPaths).not.toContain('.env.local');
  });

  it('uses low temperature + responseSchema, retries once on schema error with reason appended, and caches by content hash', async () => {
    let calls = 0;
    let capturedRetryPrompt = '';

    const result = await executeStructuredGeminiCall({
      callType: 'intent-classify',
      promptVersion: INTENT_PROMPT_VERSION,
      cacheKey: 'hash-abc-123',
      jobId: 'job-retry-1',
      aiEnabled: true,
      responseSchema: INTENT_RESPONSE_SCHEMA,
      systemInstruction: INTENT_SYSTEM_INSTRUCTION,
      buildPrompt: (validationError) =>
        buildIntentPrompt({ archiveName: 'demo.zip' }, [], validationError),
      validate: (parsed) => validateIntentSchemaWithReason(parsed),
      baseDelayMs: 1,
      generateFn: async (params) => {
        calls += 1;
        expect(params.temperature).toBe(GEMINI_LOW_TEMPERATURE);
        expect(params.responseSchema).toBe(INTENT_RESPONSE_SCHEMA);
        if (calls === 1) {
          // Invalid enum on first attempt
          return JSON.stringify({
            recommendedProfileId: 'mobile-app',
            confidence: 80,
            reasoning: 'Invalid profile enum test',
            suggestedModifiers: [],
            cautionNotes: [],
          });
        }
        capturedRetryPrompt = params.contents;
        return JSON.stringify({
          recommendedProfileId: 'api-service',
          confidence: 87,
          reasoning: 'Detected Express HTTP server and endpoints.',
          suggestedModifiers: ['typescript'],
          cautionNotes: [],
        });
      },
    });

    expect(calls).toBe(2);
    expect(capturedRetryPrompt).toContain('RETRY NOTICE:');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('success');
      expect(result.promptVersion).toBe(INTENT_PROMPT_VERSION);
      expect(result.data.recommendedProfileId).toBe('api-service');
    }

    // Second invocation with same cacheKey & promptVersion must hit cache with 0 network calls
    let secondCalled = false;
    const cachedResult = await executeStructuredGeminiCall({
      callType: 'intent-classify',
      promptVersion: INTENT_PROMPT_VERSION,
      cacheKey: 'hash-abc-123',
      jobId: 'job-retry-1',
      aiEnabled: true,
      responseSchema: INTENT_RESPONSE_SCHEMA,
      systemInstruction: INTENT_SYSTEM_INSTRUCTION,
      buildPrompt: (validationError) =>
        buildIntentPrompt({ archiveName: 'demo.zip' }, [], validationError),
      validate: (parsed) => validateIntentSchemaWithReason(parsed),
      generateFn: async () => {
        secondCalled = true;
        return '{}';
      },
    });

    expect(secondCalled).toBe(false);
    expect(cachedResult.ok).toBe(true);
    if (cachedResult.ok) {
      expect(cachedResult.status).toBe('cached');
      expect(cachedResult.cacheHit).toBe(true);
      expect(cachedResult.attempts).toBe(0);
    }
  });

  it('falls back cleanly after double schema failure, retries transient 429/503 with backoff, handles timeouts, and enforces per-job budget', async () => {
    // 1. Double validation failure -> fallback
    let schemaAttempts = 0;
    const doubleFail = await executeStructuredGeminiCall({
      callType: 'gap-analysis',
      promptVersion: GAP_ANALYSIS_PROMPT_VERSION,
      cacheKey: 'hash-bad-json',
      jobId: 'job-fail-1',
      responseSchema: GAP_ANALYSIS_RESPONSE_SCHEMA,
      systemInstruction: GAP_ANALYSIS_SYSTEM_INSTRUCTION,
      buildPrompt: (err) => buildGapAnalysisPrompt({ archiveName: 'demo.zip' }, [], err),
      validate: (parsed) => validateGapAnalysisSchemaWithReason(parsed),
      baseDelayMs: 1,
      generateFn: async () => {
        schemaAttempts += 1;
        return '{not-valid-json';
      },
    });
    expect(schemaAttempts).toBe(2);
    expect(doubleFail.ok).toBe(false);
    if (!doubleFail.ok) {
      expect(doubleFail.status).toBe('fallback');
      expect(doubleFail.errorCode).toBe('VALIDATION_FAILED');
    }

    // 2. Transient 429 rate limit followed by success on retry
    let rateAttempts = 0;
    const rateRecovered = await executeStructuredGeminiCall({
      callType: 'intent-classify',
      promptVersion: INTENT_PROMPT_VERSION,
      cacheKey: 'hash-rate-1',
      jobId: 'job-rate-1',
      responseSchema: INTENT_RESPONSE_SCHEMA,
      systemInstruction: INTENT_SYSTEM_INSTRUCTION,
      buildPrompt: (err) => buildIntentPrompt({ archiveName: 'demo.zip' }, [], err),
      validate: (parsed) => validateIntentSchemaWithReason(parsed),
      baseDelayMs: 1,
      maxTransientRetries: 2,
      generateFn: async () => {
        rateAttempts += 1;
        if (rateAttempts === 1) {
          const err = new Error('429 RESOURCE_EXHAUSTED') as Error & { status?: number };
          err.status = 429;
          throw err;
        }
        return JSON.stringify({
          recommendedProfileId: 'web-page',
          confidence: 82,
          reasoning: 'Static site files found.',
          suggestedModifiers: [],
          cautionNotes: [],
        });
      },
    });
    expect(rateAttempts).toBe(2);
    expect(rateRecovered.ok).toBe(true);

    // 3. Timeout error -> GeminiClientError classified & falls back cleanly
    const timedOut = await executeStructuredGeminiCall({
      callType: 'intent-classify',
      promptVersion: INTENT_PROMPT_VERSION,
      cacheKey: 'hash-timeout-1',
      jobId: 'job-timeout-1',
      responseSchema: INTENT_RESPONSE_SCHEMA,
      systemInstruction: INTENT_SYSTEM_INSTRUCTION,
      buildPrompt: (err) => buildIntentPrompt({ archiveName: 'demo.zip' }, [], err),
      validate: (parsed) => validateIntentSchemaWithReason(parsed),
      timeoutMs: 15,
      maxTransientRetries: 0,
      baseDelayMs: 1,
      generateFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return '{}';
      },
    });
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) {
      expect(timedOut.status).toBe('fallback');
      expect(timedOut.errorCode).toBe('TIMEOUT');
    }

    // 4. Per-job request budget exhausted -> skipped without calling generateFn
    const customBudget = 1;
    await executeStructuredGeminiCall({
      callType: 'intent-classify',
      promptVersion: INTENT_PROMPT_VERSION,
      cacheKey: 'hash-budget-1',
      jobId: 'job-budget-1',
      jobBudgetLimit: customBudget,
      responseSchema: INTENT_RESPONSE_SCHEMA,
      systemInstruction: INTENT_SYSTEM_INSTRUCTION,
      buildPrompt: (err) => buildIntentPrompt({ archiveName: 'demo.zip' }, [], err),
      validate: (parsed) => validateIntentSchemaWithReason(parsed),
      generateFn: async () =>
        JSON.stringify({
          recommendedProfileId: 'web-page',
          confidence: 75,
          reasoning: 'Static files.',
          suggestedModifiers: [],
          cautionNotes: [],
        }),
    });

    let overBudgetCalled = false;
    const overBudget = await executeStructuredGeminiCall({
      callType: 'intent-classify',
      promptVersion: INTENT_PROMPT_VERSION,
      cacheKey: 'hash-budget-2',
      jobId: 'job-budget-1',
      jobBudgetLimit: customBudget,
      responseSchema: INTENT_RESPONSE_SCHEMA,
      systemInstruction: INTENT_SYSTEM_INSTRUCTION,
      buildPrompt: (err) => buildIntentPrompt({ archiveName: 'demo.zip' }, [], err),
      validate: (parsed) => validateIntentSchemaWithReason(parsed),
      generateFn: async () => {
        overBudgetCalled = true;
        return '{}';
      },
    });
    expect(overBudgetCalled).toBe(false);
    expect(overBudget.ok).toBe(false);
    if (!overBudget.ok) {
      expect(overBudget.status).toBe('skipped');
      expect(overBudget.errorCode).toBe('BUDGET_EXCEEDED');
    }

    const sampleErr = new GeminiClientError('AI_DISABLED', 'Off', { status: 200 });
    expect(sampleErr.name).toBe('GeminiClientError');
  });

  it('supports AI off fallback, prompt version tracking, and rejecting/restoring AI suggestions in store', async () => {
    const zip = new JSZip();
    zip.file('package.json', JSON.stringify({ name: 'ambiguity', scripts: { start: 'node app.js' } }));
    zip.file('app.js', 'console.log("hi");\n');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    await usePipelineStore.getState().ingestArrayBuffer('ambiguity.zip', buf);
    usePipelineStore.getState().advanceFromUpload();
    usePipelineStore.getState().advanceFromAnalyse();

    // Turn AI off -> skipped cleanly without calling fetch
    usePipelineStore.getState().setAiEnabled(false);
    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          suggestions: [
            {
              findingTitle: 'Missing health probe guide',
              findingDescription: 'Document startup check.',
              category: 'reliability',
              severity: 'low',
              proposalTitle: 'Add HEALTHCHECK.md',
              why: 'Clarify runtime verification',
              expectedEffect: 'Clearer ops docs',
              riskTier: 'A',
              targetPath: 'HEALTHCHECK.md',
              action: 'add',
              suggestedContent: '# Healthcheck\n',
            },
          ],
          skipped: false,
          status: 'success',
          model: 'gemini-3.1-flash-lite',
          promptVersion: GAP_ANALYSIS_PROMPT_VERSION,
          cacheHit: false,
          attempts: 1,
          budget: { used: 1, limit: 6 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      await usePipelineStore.getState().requestGeminiIntentAdvice();
      expect(fetchCount).toBe(0);
      expect(usePipelineStore.getState().intent.geminiStatus).toBe('skipped');
      expect(usePipelineStore.getState().aiUsageLog[0]?.promptVersion).toBe(INTENT_PROMPT_VERSION);

      // Turn AI back on, lock intent, request Gemini gap suggestions, then reject an AI proposal
      usePipelineStore.getState().setAiEnabled(true);
      usePipelineStore.getState().lockIntent('api-service', [], 'user-override');
      usePipelineStore.getState().advanceFromIntent();

      await usePipelineStore.getState().requestGeminiFindings();
      expect(fetchCount).toBe(1);
      const aiProposal = usePipelineStore
        .getState()
        .findings.proposals.find((p) => p.aiSuggested);
      expect(aiProposal).toBeDefined();
      expect(aiProposal?.promptVersion).toBe(GAP_ANALYSIS_PROMPT_VERSION);

      // Re-running Gemini findings hits client hash cache without calling fetch again
      await usePipelineStore.getState().requestGeminiFindings();
      expect(fetchCount).toBe(1);
      expect(usePipelineStore.getState().findings.geminiCacheHit).toBe(true);

      // Rejecting AI proposal prevents it from being approved or applied
      if (aiProposal) {
        usePipelineStore.getState().rejectAiProposal(aiProposal.id);
        const rejected = usePipelineStore
          .getState()
          .findings.proposals.find((p) => p.id === aiProposal.id);
        expect(rejected?.aiRejected).toBe(true);
        expect(rejected?.approved).toBe(false);
        expect(usePipelineStore.getState().approve.approvedProposalIds).not.toContain(aiProposal.id);

        usePipelineStore.getState().restoreAiProposal(aiProposal.id);
        const restored = usePipelineStore
          .getState()
          .findings.proposals.find((p) => p.id === aiProposal.id);
        expect(restored?.aiRejected).toBe(false);
      }

      // Rejecting Gemini intent advice flips geminiRejected flag cleanly
      usePipelineStore.getState().rejectGeminiIntentAdvice();
      expect(usePipelineStore.getState().intent.geminiRejected).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
