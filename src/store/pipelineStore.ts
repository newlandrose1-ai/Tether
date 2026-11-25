import { create } from 'zustand';
import {
  DEFAULT_NESTED_ARCHIVE_POLICY,
  type NestedArchivePolicy,
} from '../config/ingestConfig';
import { applyApprovedProposalsSequentially } from '../lib/applyEngine';
import {
  buildSanitizedFindingsPayload,
  generateFindingsAndProposals,
  materializeGeminiSuggestions,
  validateGeminiGapSuggestions,
} from '../lib/findingsEngine';
import {
  buildSanitizedIntentPayload,
  classifyProjectIntent,
  detectIntentContradiction,
} from '../lib/intentClassifier';
import { runDeterministicAnalysis } from '../lib/projectAnalyzer';
import { VERIFICATION_HONESTY_NOTICE } from '../lib/verifyEngine';
import type { FolderFileInput } from '../lib/folderIngest';
import {
  clearOptInSession,
  loadOptInSession,
  saveOptInSession,
} from '../lib/sessionPersistence';
import {
  startIngestFolderTask,
  startIngestZipTask,
  startVerifyAndPackageTask,
} from '../lib/workerRunner';
import { isCancelledError, type ProgressEventPayload } from '../lib/workerProtocol';
import {
  PIPELINE_STAGES,
  type AiCallLogEntry,
  type GeminiGapSuggestion,
  type GeminiIntentAdvice,
  type PipelineSharedState,
  type PipelineStage,
  type ProfileId,
  type RiskTier,
  type WorkerProgressState,
} from '../types/pipeline';
import { INTENT_PROMPT_VERSION } from '../ai/prompts/intentClassification';
import { GAP_ANALYSIS_PROMPT_VERSION } from '../ai/prompts/gapAnalysis';

const DEFAULT_CLIENT_AI_BUDGET_LIMIT = 6;

let operationSeq = 0;
let activeTaskCancel: (() => void) | null = null;

function cancelRunningTask(): void {
  operationSeq += 1;
  if (activeTaskCancel) {
    const cancelFn = activeTaskCancel;
    activeTaskCancel = null;
    try {
      cancelFn();
    } catch {
      // Ignore cancellation errors
    }
  }
}

function toWorkerProgress(
  task: 'ingest' | 'verify',
  update: ProgressEventPayload
): WorkerProgressState {
  return {
    active: true,
    task,
    phase: update.phase,
    label: update.label,
    completed: update.completed,
    total: update.total,
    percent: Math.max(0, Math.min(100, update.percent)),
    currentPath: update.currentPath,
  };
}

function createJobId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface PipelineStoreActions {
  setNestedArchivePolicy: (policy: NestedArchivePolicy) => void;
  setAiEnabled: (enabled: boolean) => void;
  setKeepSessionOptIn: (enabled: boolean) => void;
  hydrateOptInSession: () => Promise<void>;
  cancelActiveOperation: () => void;
  ingestFile: (file: File) => Promise<void>;
  ingestFolder: (inputs: FolderFileInput[]) => Promise<void>;
  ingestArrayBuffer: (archiveName: string, buffer: ArrayBuffer) => Promise<void>;
  runAnalysis: () => void;
  advanceFromUpload: () => void;
  advanceFromAnalyse: () => void;
  requestGeminiIntentAdvice: () => Promise<void>;
  rejectGeminiIntentAdvice: () => void;
  lockIntent: (
    profileId: ProfileId,
    modifiers: string[],
    source?: 'auto' | 'gemini-confirmed' | 'user-override'
  ) => void;
  toggleIntentModifier: (modifierId: string) => void;
  repivotToSuggestedProfile: () => void;
  dismissContradiction: () => void;
  advanceFromIntent: () => void;
  runFindingsGeneration: () => void;
  requestGeminiFindings: () => Promise<void>;
  rejectAiProposal: (proposalId: string) => void;
  restoreAiProposal: (proposalId: string) => void;
  toggleProposalApproval: (proposalId: string) => void;
  setTierApproval: (tier: RiskTier, approved: boolean) => void;
  advanceFromFindings: () => void;
  executeApplyStage: () => void;
  executeVerifyStage: () => Promise<void>;
  advanceFromVerify: () => void;
  goToStage: (stage: PipelineStage) => void;
  resetPipeline: () => void;
}

export type PipelineStore = PipelineSharedState & PipelineStoreActions;

function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.findIndex((s) => s.id === stage);
}

function addCompletedStage(existing: PipelineStage[], stage: PipelineStage): PipelineStage[] {
  if (existing.includes(stage)) return existing;
  return [...existing, stage];
}

function maxStage(a: PipelineStage, b: PipelineStage): PipelineStage {
  return stageIndex(a) >= stageIndex(b) ? a : b;
}

export function wipePipelineBuffers(state: PipelineSharedState): void {
  if (state.ingest) {
    try {
      if (state.ingest.originalBufferCopy.byteLength > 0) {
        new Uint8Array(state.ingest.originalBufferCopy).fill(0);
      }
    } catch {
      // Buffer already detached
    }
    for (const buf of Object.values(state.ingest.rawEntriesByPath)) {
      if (buf && buf.byteLength > 0) {
        try {
          buf.fill(0);
        } catch {
          // Ignore detached buffers
        }
      }
    }
  }

  for (const buf of Object.values(state.apply.workingFiles)) {
    if (buf && buf.byteLength > 0) {
      try {
        buf.fill(0);
      } catch {
        // Ignore detached buffers
      }
    }
  }

  if (state.verify.outputZipBytes && state.verify.outputZipBytes.byteLength > 0) {
    try {
      state.verify.outputZipBytes.fill(0);
    } catch {
      // Ignore detached buffers
    }
  }
}

function createInitialState(
  nestedArchivePolicy: NestedArchivePolicy = DEFAULT_NESTED_ARCHIVE_POLICY,
  aiEnabled: boolean = true,
  keepSessionOptIn: boolean = false
): PipelineSharedState {
  return {
    jobId: createJobId(),
    aiEnabled,
    keepSessionOptIn,
    sessionHydrated: false,
    aiRequestBudgetUsed: 0,
    aiRequestBudgetLimit: DEFAULT_CLIENT_AI_BUDGET_LIMIT,
    aiResponseCache: {},
    aiUsageLog: [],
    currentStage: 'upload',
    highestUnlockedStage: 'upload',
    completedStages: [],
    ingestStatus: 'idle',
    ingestProgress: null,
    nestedArchivePolicy,
    ingestError: null,
    ingest: null,
    analysis: {
      status: 'pending',
      result: null,
    },
    intent: {
      status: 'pending',
      rankedProfiles: [],
      autoLockEligible: false,
      autoLockReason: '',
      projectKind: null,
      modifiers: [],
      suggestedModifiers: [],
      lockSource: null,
      lockedByUser: false,
      lockedAt: null,
      geminiStatus: 'idle',
      geminiAdvice: null,
      geminiError: null,
      geminiSkipReason: null,
      geminiPromptVersion: null,
      geminiCacheHit: false,
      geminiRejected: false,
      contradiction: null,
    },
    findings: {
      status: 'pending',
      findings: [],
      proposals: [],
      eligibleRegistryIds: [],
      excludedRegistryNotes: [],
      geminiStatus: 'idle',
      geminiError: null,
      geminiSkipReason: null,
      geminiModel: null,
      geminiPromptVersion: null,
      geminiCacheHit: false,
    },
    approve: {
      status: 'pending',
      approvedProposalIds: [],
    },
    isApplying: false,
    apply: {
      status: 'pending',
      appliedAt: null,
      outcomes: [],
      appliedProposalIds: [],
      rolledBackProposalIds: [],
      addedPaths: [],
      modifiedPaths: [],
      workingFiles: {},
      workingPermissions: {},
      changelogPath: null,
      noticePath: null,
    },
    isVerifying: false,
    verifyProgress: null,
    verify: {
      status: 'pending',
      verifiedAt: null,
      structuralPassed: null,
      staticPassed: null,
      secretScanPassed: null,
      buildsAndTestsRun: false,
      honestyNotice: VERIFICATION_HONESTY_NOTICE,
      note: null,
      checks: [],
      outputSha256ByPath: {},
      untouchedVerifiedCount: 0,
      untouchedTotalCount: 0,
      modifiedVerifiedCount: 0,
      addedVerifiedCount: 0,
      outputSecretFindings: [],
      newSecretFindings: [],
      outputZipBytes: null,
    },
    download: {
      status: 'pending',
      outputArchiveName: null,
      changelogMarkdown: null,
      noticeMarkdown: null,
      unifiedPatchDiff: null,
      beforeAfterReportMarkdown: null,
    },
  };
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  ...createInitialState(),

  setNestedArchivePolicy: (policy) => {
    set({ nestedArchivePolicy: policy });
  },

  setAiEnabled: (enabled) => {
    set({ aiEnabled: enabled });
    if (get().keepSessionOptIn) {
      void saveOptInSession(get());
    }
  },

  setKeepSessionOptIn: (enabled) => {
    set({ keepSessionOptIn: enabled });
    if (enabled) {
      void saveOptInSession(get());
    } else {
      void clearOptInSession();
    }
  },

  hydrateOptInSession: async () => {
    const current = get();
    if (current.ingest !== null || current.ingestStatus === 'ingesting' || current.sessionHydrated) {
      return;
    }
    const saved = await loadOptInSession();
    if (!saved) {
      set({ sessionHydrated: true });
      return;
    }
    const afterCheck = get();
    if (afterCheck.ingest !== null || afterCheck.ingestStatus === 'ingesting') {
      return;
    }
    set({
      ...saved,
      sessionHydrated: true,
    });
  },

  cancelActiveOperation: () => {
    const prev = get();
    cancelRunningTask();

    if (prev.ingestStatus === 'ingesting') {
      wipePipelineBuffers(prev);
      set({
        ...createInitialState(prev.nestedArchivePolicy, prev.aiEnabled, prev.keepSessionOptIn),
        sessionHydrated: prev.sessionHydrated,
        ingestStatus: 'idle',
        ingestProgress: null,
      });
      return;
    }

    if (prev.isVerifying) {
      set({
        isVerifying: false,
        verifyProgress: null,
      });
    }
  },

  ingestFile: async (file) => {
    if (!file) {
      set({
        ingestStatus: 'error',
        ingestProgress: null,
        ingestError: {
          code: 'EMPTY_FILE',
          title: 'No file selected',
          detail: 'Please select a .zip archive to begin.',
        },
      });
      return;
    }
    const buffer = await file.arrayBuffer();
    await get().ingestArrayBuffer(file.name, buffer);
  },

  ingestFolder: async (inputs) => {
    cancelRunningTask();
    const seq = operationSeq;
    const prev = get();
    wipePipelineBuffers(prev);
    const policy = prev.nestedArchivePolicy;
    const aiEnabled = prev.aiEnabled;
    const keepSession = prev.keepSessionOptIn;

    set({
      ...createInitialState(policy, aiEnabled, keepSession),
      sessionHydrated: prev.sessionHydrated,
      ingestStatus: 'ingesting',
      ingestProgress: {
        active: true,
        task: 'ingest',
        phase: 'starting',
        label: 'Preparing folder files...',
        completed: 0,
        total: inputs.length,
        percent: 2,
      },
    });

    const handle = startIngestFolderTask(inputs, policy, (update) => {
      if (seq !== operationSeq) return;
      set({ ingestProgress: toWorkerProgress('ingest', update) });
    });
    activeTaskCancel = handle.cancel;

    try {
      const outcome = await handle.promise;
      if (seq !== operationSeq) return;
      activeTaskCancel = null;

      if (!outcome.ok) {
        set({
          ingestStatus: 'error',
          ingestProgress: null,
          ingestError: outcome.error,
          ingest: null,
          completedStages: [],
          highestUnlockedStage: 'upload',
          currentStage: 'upload',
        });
        return;
      }

      set({
        ingestStatus: 'ready',
        ingestProgress: null,
        ingestError: null,
        ingest: outcome.result,
        completedStages: ['upload'],
        highestUnlockedStage: 'analyse',
        currentStage: 'upload',
      });
      if (get().keepSessionOptIn) {
        void saveOptInSession(get());
      }
    } catch (err) {
      if (seq !== operationSeq) return;
      activeTaskCancel = null;
      if (isCancelledError(err)) {
        set({
          ingestStatus: 'idle',
          ingestProgress: null,
          ingestError: null,
          ingest: null,
          completedStages: [],
          highestUnlockedStage: 'upload',
          currentStage: 'upload',
        });
        return;
      }
      set({
        ingestStatus: 'error',
        ingestProgress: null,
        ingestError: {
          code: 'DECOMPRESS_FAILED',
          title: 'Folder read failed',
          detail: err instanceof Error ? err.message : 'Unable to read selected folder.',
        },
        ingest: null,
      });
    }
  },

  ingestArrayBuffer: async (archiveName, buffer) => {
    cancelRunningTask();
    const seq = operationSeq;
    const prev = get();
    wipePipelineBuffers(prev);
    const policy = prev.nestedArchivePolicy;
    const aiEnabled = prev.aiEnabled;
    const keepSession = prev.keepSessionOptIn;

    set({
      ...createInitialState(policy, aiEnabled, keepSession),
      sessionHydrated: prev.sessionHydrated,
      ingestStatus: 'ingesting',
      ingestProgress: {
        active: true,
        task: 'ingest',
        phase: 'starting',
        label: 'Starting archive reader...',
        completed: 0,
        total: 100,
        percent: 2,
      },
    });

    const handle = startIngestZipTask(archiveName, buffer, policy, (update) => {
      if (seq !== operationSeq) return;
      set({ ingestProgress: toWorkerProgress('ingest', update) });
    });
    activeTaskCancel = handle.cancel;

    try {
      const outcome = await handle.promise;
      if (seq !== operationSeq) return;
      activeTaskCancel = null;

      if (!outcome.ok) {
        set({
          ingestStatus: 'error',
          ingestProgress: null,
          ingestError: outcome.error,
          ingest: null,
          completedStages: [],
          highestUnlockedStage: 'upload',
          currentStage: 'upload',
        });
        return;
      }

      set({
        ingestStatus: 'ready',
        ingestProgress: null,
        ingestError: null,
        ingest: outcome.result,
        completedStages: ['upload'],
        highestUnlockedStage: 'analyse',
        currentStage: 'upload',
      });
      if (get().keepSessionOptIn) {
        void saveOptInSession(get());
      }
    } catch (err) {
      if (seq !== operationSeq) return;
      activeTaskCancel = null;
      if (isCancelledError(err)) {
        set({
          ingestStatus: 'idle',
          ingestProgress: null,
          ingestError: null,
          ingest: null,
          completedStages: [],
          highestUnlockedStage: 'upload',
          currentStage: 'upload',
        });
        return;
      }
      set({
        ingestStatus: 'error',
        ingestProgress: null,
        ingestError: {
          code: 'MALFORMED_ZIP',
          title: 'Archive worker failed',
          detail: err instanceof Error ? err.message : 'Unable to read uploaded .zip archive.',
        },
        ingest: null,
      });
    }
  },

  runAnalysis: () => {
    const { ingest, intent, completedStages, highestUnlockedStage } = get();
    if (!ingest) return;

    const analysisResult = runDeterministicAnalysis(ingest);
    const classification = classifyProjectIntent(ingest, analysisResult);

    const hasSessionLock = intent.status === 'locked' && intent.projectKind !== null;

    if (hasSessionLock && intent.projectKind) {
      // Session lock holds; check if updated analysis contradicts it.
      const contradiction = detectIntentContradiction(
        intent.projectKind,
        classification.rankedProfiles,
        analysisResult
      );
      set({
        analysis: { status: 'ready', result: analysisResult },
        completedStages: addCompletedStage(completedStages, 'analyse'),
        highestUnlockedStage: maxStage(highestUnlockedStage, 'intent'),
        intent: {
          ...intent,
          rankedProfiles: classification.rankedProfiles,
          autoLockEligible: classification.autoLockEligible,
          autoLockReason: classification.autoLockReason,
          suggestedModifiers: classification.suggestedModifiers,
          contradiction,
        },
      });
      return;
    }

    if (classification.autoLockEligible && classification.rankedProfiles[0]) {
      const top = classification.rankedProfiles[0];
      const nextCompleted = addCompletedStage(
        addCompletedStage(completedStages, 'analyse'),
        'intent'
      );
      set({
        analysis: { status: 'ready', result: analysisResult },
        completedStages: nextCompleted,
        highestUnlockedStage: maxStage(highestUnlockedStage, 'findings'),
        intent: {
          ...intent,
          status: 'locked',
          rankedProfiles: classification.rankedProfiles,
          autoLockEligible: true,
          autoLockReason: classification.autoLockReason,
          projectKind: top.profileId,
          modifiers: classification.suggestedModifiers,
          suggestedModifiers: classification.suggestedModifiers,
          lockSource: 'auto',
          lockedByUser: false,
          lockedAt: new Date().toISOString(),
          contradiction: null,
        },
      });
      return;
    }

    set({
      analysis: { status: 'ready', result: analysisResult },
      completedStages: addCompletedStage(completedStages, 'analyse'),
      highestUnlockedStage: maxStage(highestUnlockedStage, 'intent'),
      intent: {
        ...intent,
        status: 'needs-confirmation',
        rankedProfiles: classification.rankedProfiles,
        autoLockEligible: false,
        autoLockReason: classification.autoLockReason,
        projectKind: classification.rankedProfiles[0]?.profileId ?? null,
        modifiers: classification.suggestedModifiers,
        suggestedModifiers: classification.suggestedModifiers,
        lockSource: null,
        lockedByUser: false,
        lockedAt: null,
        contradiction: null,
      },
    });
  },

  advanceFromUpload: () => {
    const { ingestStatus, ingest, currentStage, analysis } = get();
    if (currentStage === 'analyse' && analysis.status === 'ready') return;
    if (ingestStatus === 'ready' && ingest) {
      get().runAnalysis();
      set({
        currentStage: 'analyse',
      });
      if (get().keepSessionOptIn) {
        void saveOptInSession(get());
      }
    }
  },

  advanceFromAnalyse: () => {
    const { analysis, currentStage } = get();
    if (currentStage === 'intent') return;
    if (analysis.status !== 'ready') {
      get().runAnalysis();
    }
    set((state) => ({
      currentStage: 'intent',
      highestUnlockedStage: maxStage(state.highestUnlockedStage, 'intent'),
    }));
    if (get().keepSessionOptIn) {
      void saveOptInSession(get());
    }
  },

  requestGeminiIntentAdvice: async () => {
    const {
      ingest,
      analysis,
      intent,
      aiEnabled,
      aiRequestBudgetUsed,
      aiRequestBudgetLimit,
      aiResponseCache,
      jobId,
    } = get();
    if (!ingest || !analysis.result || intent.geminiStatus === 'loading') return;

    const evidenceSummary = buildSanitizedIntentPayload(
      ingest,
      analysis.result,
      intent.rankedProfiles,
      intent.suggestedModifiers
    );
    const cacheKey = `intent-classify:${evidenceSummary.promptVersion}:${evidenceSummary.contentHashKey}`;

    const appendLog = (entry: Omit<AiCallLogEntry, 'id' | 'timestamp'>): AiCallLogEntry => ({
      ...entry,
      id: `ailog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    });

    // 1. User turned AI off -> skipped cleanly
    if (!aiEnabled) {
      const reason = 'AI assistance is turned off; using deterministic profile scoring.';
      set((state) => ({
        intent: {
          ...state.intent,
          geminiStatus: 'skipped',
          geminiAdvice: null,
          geminiError: null,
          geminiSkipReason: reason,
          geminiPromptVersion: evidenceSummary.promptVersion,
          geminiCacheHit: false,
          geminiRejected: false,
        },
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'intent-classify',
            promptVersion: evidenceSummary.promptVersion,
            model: 'none',
            status: 'skipped',
            cacheHit: false,
            contentHashKey: evidenceSummary.contentHashKey,
            decisionSummary: 'Skipped — using deterministic scoring',
            skipReason: reason,
            attempts: 0,
          }),
        ],
      }));
      return;
    }

    // 2. Client cache hit per file SHA-256 hash -> reuse without sending or spending budget
    const cachedAdvice = aiResponseCache[cacheKey] as GeminiIntentAdvice | undefined;
    if (cachedAdvice) {
      set((state) => ({
        intent: {
          ...state.intent,
          geminiStatus: 'ready',
          geminiAdvice: cachedAdvice,
          geminiError: null,
          geminiSkipReason: null,
          geminiPromptVersion: cachedAdvice.promptVersion ?? evidenceSummary.promptVersion,
          geminiCacheHit: true,
          geminiRejected: false,
          projectKind:
            state.intent.status === 'locked'
              ? state.intent.projectKind
              : cachedAdvice.recommendedProfileId,
          modifiers:
            state.intent.status === 'locked'
              ? state.intent.modifiers
              : Array.from(
                  new Set([
                    ...state.intent.suggestedModifiers,
                    ...cachedAdvice.suggestedModifiers,
                  ])
                ),
        },
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'intent-classify',
            promptVersion: cachedAdvice.promptVersion ?? evidenceSummary.promptVersion,
            model: cachedAdvice.model,
            status: 'cached',
            cacheHit: true,
            contentHashKey: evidenceSummary.contentHashKey,
            decisionSummary: `Reused cached recommendation: ${cachedAdvice.recommendedProfileId} (${cachedAdvice.confidence}%)`,
            attempts: 0,
          }),
        ],
      }));
      return;
    }

    // 3. Per-job request budget check
    if (aiRequestBudgetUsed >= aiRequestBudgetLimit) {
      const reason = `Per-job AI request budget (${aiRequestBudgetLimit} calls) reached; using deterministic profile scoring.`;
      set((state) => ({
        intent: {
          ...state.intent,
          geminiStatus: 'skipped',
          geminiAdvice: null,
          geminiError: null,
          geminiSkipReason: reason,
          geminiPromptVersion: evidenceSummary.promptVersion,
          geminiCacheHit: false,
        },
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'intent-classify',
            promptVersion: evidenceSummary.promptVersion,
            model: 'none',
            status: 'skipped',
            cacheHit: false,
            contentHashKey: evidenceSummary.contentHashKey,
            decisionSummary: 'Skipped — request budget exhausted',
            skipReason: reason,
            attempts: 0,
          }),
        ],
      }));
      return;
    }

    set((state) => ({
      intent: {
        ...state.intent,
        geminiStatus: 'loading',
        geminiError: null,
        geminiSkipReason: null,
        geminiCacheHit: false,
      },
    }));

    try {
      const response = await fetch('/api/intent/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidenceSummary, jobId, aiEnabled }),
      });

      const data = (await response.json()) as {
        advice?: GeminiIntentAdvice | null;
        skipped?: boolean;
        status?: 'success' | 'cached' | 'skipped' | 'fallback';
        skipReason?: string;
        model?: string;
        promptVersion?: string;
        cacheHit?: boolean;
        attempts?: number;
        budget?: { used: number; limit: number };
        error?: string;
      };

      const usedBudget = data.budget?.used ?? aiRequestBudgetUsed + (data.cacheHit ? 0 : 1);
      const pVer = data.promptVersion ?? INTENT_PROMPT_VERSION;

      if (!response.ok || data.skipped || !data.advice) {
        const skipReason =
          data.skipReason ||
          data.error ||
          `Gemini unavailable (HTTP ${response.status}); using deterministic rules.`;
        set((state) => ({
          aiRequestBudgetUsed: usedBudget,
          intent: {
            ...state.intent,
            geminiStatus: 'skipped',
            geminiAdvice: null,
            geminiError: null,
            geminiSkipReason: skipReason,
            geminiPromptVersion: pVer,
            geminiCacheHit: false,
          },
          aiUsageLog: [
            ...state.aiUsageLog,
            appendLog({
              callType: 'intent-classify',
              promptVersion: pVer,
              model: data.model ?? 'unavailable',
              status: data.status === 'fallback' ? 'fallback' : 'skipped',
              cacheHit: false,
              contentHashKey: evidenceSummary.contentHashKey,
              decisionSummary: 'Fallback to deterministic profile scoring',
              skipReason,
              attempts: data.attempts ?? 1,
            }),
          ],
        }));
        return;
      }

      const adviceWithVersion: GeminiIntentAdvice = {
        ...data.advice,
        promptVersion: pVer,
      };

      set((state) => ({
        aiRequestBudgetUsed: usedBudget,
        aiResponseCache: {
          ...state.aiResponseCache,
          [cacheKey]: adviceWithVersion,
        },
        intent: {
          ...state.intent,
          geminiStatus: 'ready',
          geminiAdvice: adviceWithVersion,
          geminiError: null,
          geminiSkipReason: null,
          geminiPromptVersion: pVer,
          geminiCacheHit: Boolean(data.cacheHit),
          geminiRejected: false,
          projectKind:
            state.intent.status === 'locked'
              ? state.intent.projectKind
              : adviceWithVersion.recommendedProfileId,
          modifiers:
            state.intent.status === 'locked'
              ? state.intent.modifiers
              : Array.from(
                  new Set([
                    ...state.intent.suggestedModifiers,
                    ...adviceWithVersion.suggestedModifiers,
                  ])
                ),
        },
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'intent-classify',
            promptVersion: pVer,
            model: adviceWithVersion.model,
            status: data.cacheHit ? 'cached' : 'success',
            cacheHit: Boolean(data.cacheHit),
            contentHashKey: evidenceSummary.contentHashKey,
            decisionSummary: `Recommended ${adviceWithVersion.recommendedProfileId} (${adviceWithVersion.confidence}%)`,
            attempts: data.attempts ?? 1,
          }),
        ],
      }));
    } catch (err) {
      const reason =
        err instanceof Error
          ? `${err.message}; continuing with deterministic rules.`
          : 'Gemini network unreachable; continuing with deterministic rules.';
      set((state) => ({
        intent: {
          ...state.intent,
          geminiStatus: 'skipped',
          geminiAdvice: null,
          geminiError: null,
          geminiSkipReason: reason,
          geminiPromptVersion: evidenceSummary.promptVersion,
          geminiCacheHit: false,
        },
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'intent-classify',
            promptVersion: evidenceSummary.promptVersion,
            model: 'unavailable',
            status: 'fallback',
            cacheHit: false,
            contentHashKey: evidenceSummary.contentHashKey,
            decisionSummary: 'Fallback to deterministic profile scoring',
            skipReason: reason,
            attempts: 1,
          }),
        ],
      }));
    }
  },

  rejectGeminiIntentAdvice: () => {
    set((state) => ({
      intent: {
        ...state.intent,
        geminiRejected: true,
        projectKind:
          state.intent.status === 'locked'
            ? state.intent.projectKind
            : state.intent.rankedProfiles[0]?.profileId ?? state.intent.projectKind,
        modifiers:
          state.intent.status === 'locked'
            ? state.intent.modifiers
            : state.intent.suggestedModifiers,
      },
    }));
  },

  lockIntent: (profileId, modifiers, source = 'user-override') => {
    const { analysis, intent, completedStages, highestUnlockedStage } = get();
    const uniqueModifiers = Array.from(new Set(modifiers)).sort();
    const contradiction = analysis.result
      ? detectIntentContradiction(profileId, intent.rankedProfiles, analysis.result)
      : null;

    set({
      completedStages: addCompletedStage(completedStages, 'intent'),
      highestUnlockedStage: maxStage(highestUnlockedStage, 'findings'),
      intent: {
        ...intent,
        status: 'locked',
        projectKind: profileId,
        modifiers: uniqueModifiers,
        lockSource: source,
        lockedByUser: source !== 'auto',
        lockedAt: new Date().toISOString(),
        contradiction,
      },
      findings: createInitialState().findings,
      approve: createInitialState().approve,
      apply: createInitialState().apply,
      verify: createInitialState().verify,
      download: createInitialState().download,
    });
  },

  toggleIntentModifier: (modifierId) => {
    set((state) => {
      const exists = state.intent.modifiers.includes(modifierId);
      const nextModifiers = exists
        ? state.intent.modifiers.filter((m) => m !== modifierId)
        : [...state.intent.modifiers, modifierId].sort();
      return {
        intent: {
          ...state.intent,
          modifiers: nextModifiers,
        },
        findings: createInitialState().findings,
        approve: createInitialState().approve,
        apply: createInitialState().apply,
        verify: createInitialState().verify,
        download: createInitialState().download,
      };
    });
  },

  repivotToSuggestedProfile: () => {
    const { intent } = get();
    if (!intent.contradiction) return;
    get().lockIntent(intent.contradiction.suggestedProfileId, intent.modifiers, 'user-override');
  },

  dismissContradiction: () => {
    set((state) => ({
      intent: {
        ...state.intent,
        contradiction: state.intent.contradiction
          ? { ...state.intent.contradiction, dismissed: true }
          : null,
      },
    }));
  },

  advanceFromIntent: () => {
    const { intent, highestUnlockedStage, currentStage, findings } = get();
    if (currentStage === 'findings' && findings.status === 'ready') return;
    if (intent.status !== 'locked' || !intent.projectKind) return;
    get().runFindingsGeneration();
    set({
      currentStage: 'findings',
      highestUnlockedStage: maxStage(highestUnlockedStage, 'findings'),
    });
    if (get().keepSessionOptIn) {
      void saveOptInSession(get());
    }
  },

  runFindingsGeneration: () => {
    const { ingest, analysis, intent } = get();
    if (!ingest || !analysis.result || intent.status !== 'locked' || !intent.projectKind) {
      return;
    }

    const generated = generateFindingsAndProposals(
      ingest,
      analysis.result,
      intent.projectKind,
      intent.modifiers
    );

    const preApprovedIds = generated.proposals.filter((p) => p.approved).map((p) => p.id);

    set((state) => ({
      findings: {
        ...state.findings,
        status: 'ready',
        findings: generated.findings,
        proposals: generated.proposals,
        eligibleRegistryIds: generated.eligibleRegistryIds,
        excludedRegistryNotes: generated.excludedRegistryNotes,
        geminiStatus: 'idle',
        geminiError: null,
        geminiSkipReason: null,
        geminiModel: null,
        geminiPromptVersion: null,
        geminiCacheHit: false,
      },
      approve: {
        status: 'pending',
        approvedProposalIds: preApprovedIds,
      },
      apply: createInitialState().apply,
      verify: createInitialState().verify,
      download: createInitialState().download,
    }));
  },

  requestGeminiFindings: async () => {
    const {
      ingest,
      analysis,
      intent,
      findings,
      aiEnabled,
      aiRequestBudgetUsed,
      aiRequestBudgetLimit,
      aiResponseCache,
      jobId,
    } = get();
    if (!ingest || !analysis.result || !intent.projectKind || findings.geminiStatus === 'loading') {
      return;
    }

    const deterministicFindings = findings.findings.filter((f) => !f.aiSuggested);
    const deterministicProposals = findings.proposals.filter((p) => !p.aiSuggested);

    const projectSummary = buildSanitizedFindingsPayload(
      ingest,
      analysis.result,
      intent.projectKind,
      intent.modifiers,
      deterministicFindings
    );
    const cacheKey = `gap-analysis:${projectSummary.promptVersion}:${projectSummary.contentHashKey}`;

    const appendLog = (entry: Omit<AiCallLogEntry, 'id' | 'timestamp'>): AiCallLogEntry => ({
      ...entry,
      id: `ailog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    });

    if (!aiEnabled) {
      const reason = 'AI assistance is turned off; keeping deterministic checklist findings only.';
      set((state) => ({
        findings: {
          ...state.findings,
          geminiStatus: 'skipped',
          geminiError: null,
          geminiSkipReason: reason,
          geminiPromptVersion: projectSummary.promptVersion,
          geminiCacheHit: false,
        },
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'gap-analysis',
            promptVersion: projectSummary.promptVersion,
            model: 'none',
            status: 'skipped',
            cacheHit: false,
            contentHashKey: projectSummary.contentHashKey,
            decisionSummary: 'Skipped — AI assistance disabled',
            skipReason: reason,
            attempts: 0,
          }),
        ],
      }));
      return;
    }

    const cachedEntry = aiResponseCache[cacheKey] as
      | { suggestions: GeminiGapSuggestion[]; model: string; promptVersion: string }
      | undefined;

    if (cachedEntry) {
      const validated = validateGeminiGapSuggestions({ suggestions: cachedEntry.suggestions });
      const { aiFindings, aiProposals } = materializeGeminiSuggestions(
        validated,
        ingest,
        cachedEntry.promptVersion
      );
      const mergedProposals = [...deterministicProposals, ...aiProposals];
      const mergedApprovedIds = mergedProposals
        .filter((p) => p.approved && !p.aiRejected)
        .map((p) => p.id);

      set((state) => ({
        findings: {
          ...state.findings,
          findings: [...deterministicFindings, ...aiFindings],
          proposals: mergedProposals,
          geminiStatus: 'ready',
          geminiError: null,
          geminiSkipReason: null,
          geminiModel: cachedEntry.model,
          geminiPromptVersion: cachedEntry.promptVersion,
          geminiCacheHit: true,
        },
        approve: {
          status: 'pending',
          approvedProposalIds: mergedApprovedIds,
        },
        apply: createInitialState().apply,
        verify: createInitialState().verify,
        download: createInitialState().download,
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'gap-analysis',
            promptVersion: cachedEntry.promptVersion,
            model: cachedEntry.model,
            status: 'cached',
            cacheHit: true,
            contentHashKey: projectSummary.contentHashKey,
            decisionSummary: `Reused ${aiProposals.length} cached AI gap suggestion(s)`,
            attempts: 0,
          }),
        ],
      }));
      return;
    }

    if (aiRequestBudgetUsed >= aiRequestBudgetLimit) {
      const reason = `Per-job AI request budget (${aiRequestBudgetLimit} calls) reached; using deterministic findings only.`;
      set((state) => ({
        findings: {
          ...state.findings,
          geminiStatus: 'skipped',
          geminiError: null,
          geminiSkipReason: reason,
          geminiPromptVersion: projectSummary.promptVersion,
          geminiCacheHit: false,
        },
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'gap-analysis',
            promptVersion: projectSummary.promptVersion,
            model: 'none',
            status: 'skipped',
            cacheHit: false,
            contentHashKey: projectSummary.contentHashKey,
            decisionSummary: 'Skipped — request budget exhausted',
            skipReason: reason,
            attempts: 0,
          }),
        ],
      }));
      return;
    }

    set((state) => ({
      findings: {
        ...state.findings,
        geminiStatus: 'loading',
        geminiError: null,
        geminiSkipReason: null,
        geminiCacheHit: false,
      },
    }));

    try {
      const response = await fetch('/api/findings/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectSummary, jobId, aiEnabled }),
      });

      const data = (await response.json()) as {
        suggestions?: unknown;
        skipped?: boolean;
        status?: 'success' | 'cached' | 'skipped' | 'fallback';
        skipReason?: string;
        model?: string;
        promptVersion?: string;
        cacheHit?: boolean;
        attempts?: number;
        budget?: { used: number; limit: number };
        error?: string;
      };

      const usedBudget = data.budget?.used ?? aiRequestBudgetUsed + (data.cacheHit ? 0 : 1);
      const pVer = data.promptVersion ?? GAP_ANALYSIS_PROMPT_VERSION;

      if (!response.ok || data.skipped) {
        const skipReason =
          data.skipReason ||
          data.error ||
          `Gemini gap check unavailable (HTTP ${response.status}); using deterministic checklist only.`;
        set((state) => ({
          aiRequestBudgetUsed: usedBudget,
          findings: {
            ...state.findings,
            geminiStatus: 'skipped',
            geminiError: null,
            geminiSkipReason: skipReason,
            geminiModel: data.model ?? null,
            geminiPromptVersion: pVer,
            geminiCacheHit: false,
          },
          aiUsageLog: [
            ...state.aiUsageLog,
            appendLog({
              callType: 'gap-analysis',
              promptVersion: pVer,
              model: data.model ?? 'unavailable',
              status: data.status === 'fallback' ? 'fallback' : 'skipped',
              cacheHit: false,
              contentHashKey: projectSummary.contentHashKey,
              decisionSummary: 'Skipped AI gap scan — deterministic checklist only',
              skipReason,
              attempts: data.attempts ?? 1,
            }),
          ],
        }));
        return;
      }

      const validated = validateGeminiGapSuggestions({ suggestions: data.suggestions });
      const { aiFindings, aiProposals } = materializeGeminiSuggestions(validated, ingest, pVer);

      const mergedProposals = [...deterministicProposals, ...aiProposals];
      const mergedApprovedIds = mergedProposals
        .filter((p) => p.approved && !p.aiRejected)
        .map((p) => p.id);

      set((state) => ({
        aiRequestBudgetUsed: usedBudget,
        aiResponseCache: {
          ...state.aiResponseCache,
          [cacheKey]: {
            suggestions: validated,
            model: data.model ?? 'gemini-3.1-flash-lite',
            promptVersion: pVer,
          },
        },
        findings: {
          ...state.findings,
          findings: [...deterministicFindings, ...aiFindings],
          proposals: mergedProposals,
          geminiStatus: 'ready',
          geminiError: null,
          geminiSkipReason: null,
          geminiModel: data.model ?? null,
          geminiPromptVersion: pVer,
          geminiCacheHit: Boolean(data.cacheHit),
        },
        approve: {
          status: 'pending',
          approvedProposalIds: mergedApprovedIds,
        },
        apply: createInitialState().apply,
        verify: createInitialState().verify,
        download: createInitialState().download,
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'gap-analysis',
            promptVersion: pVer,
            model: data.model ?? 'gemini-3.1-flash-lite',
            status: data.cacheHit ? 'cached' : 'success',
            cacheHit: Boolean(data.cacheHit),
            contentHashKey: projectSummary.contentHashKey,
            decisionSummary:
              aiProposals.length > 0
                ? `Suggested ${aiProposals.length} extra gap(s): ${aiProposals.map((p) => p.title).join('; ')}`
                : 'No extra non-checklist gaps found',
            attempts: data.attempts ?? 1,
          }),
        ],
      }));
    } catch (err) {
      const reason =
        err instanceof Error
          ? `${err.message}; using deterministic checklist only.`
          : 'Gemini network unreachable; using deterministic checklist only.';
      set((state) => ({
        findings: {
          ...state.findings,
          geminiStatus: 'skipped',
          geminiError: null,
          geminiSkipReason: reason,
          geminiPromptVersion: projectSummary.promptVersion,
          geminiCacheHit: false,
        },
        aiUsageLog: [
          ...state.aiUsageLog,
          appendLog({
            callType: 'gap-analysis',
            promptVersion: projectSummary.promptVersion,
            model: 'unavailable',
            status: 'fallback',
            cacheHit: false,
            contentHashKey: projectSummary.contentHashKey,
            decisionSummary: 'Fallback to deterministic checklist only',
            skipReason: reason,
            attempts: 1,
          }),
        ],
      }));
    }
  },

  rejectAiProposal: (proposalId) => {
    const resetTail = createInitialState();
    set((state) => {
      const target = state.findings.proposals.find((p) => p.id === proposalId);
      const nextProposals = state.findings.proposals.map((p) =>
        p.id === proposalId ? { ...p, aiRejected: true, approved: false } : p
      );
      const nextFindings = state.findings.findings.map((f) =>
        target && f.id === target.findingId ? { ...f, aiRejected: true } : f
      );
      return {
        findings: {
          ...state.findings,
          findings: nextFindings,
          proposals: nextProposals,
        },
        approve: {
          status: 'pending',
          approvedProposalIds: nextProposals
            .filter((p) => p.approved && !p.aiRejected)
            .map((p) => p.id),
        },
        apply: resetTail.apply,
        verify: resetTail.verify,
        download: resetTail.download,
      };
    });
  },

  restoreAiProposal: (proposalId) => {
    const resetTail = createInitialState();
    set((state) => {
      const target = state.findings.proposals.find((p) => p.id === proposalId);
      const nextProposals = state.findings.proposals.map((p) =>
        p.id === proposalId ? { ...p, aiRejected: false } : p
      );
      const nextFindings = state.findings.findings.map((f) =>
        target && f.id === target.findingId ? { ...f, aiRejected: false } : f
      );
      return {
        findings: {
          ...state.findings,
          findings: nextFindings,
          proposals: nextProposals,
        },
        approve: {
          status: 'pending',
          approvedProposalIds: nextProposals
            .filter((p) => p.approved && !p.aiRejected)
            .map((p) => p.id),
        },
        apply: resetTail.apply,
        verify: resetTail.verify,
        download: resetTail.download,
      };
    });
  },

  toggleProposalApproval: (proposalId) => {
    const resetTail = createInitialState();
    set((state) => {
      const nextProposals = state.findings.proposals.map((p) =>
        p.id === proposalId
          ? { ...p, approved: !p.approved, aiRejected: !p.approved ? false : p.aiRejected }
          : p
      );
      return {
        findings: {
          ...state.findings,
          proposals: nextProposals,
        },
        approve: {
          status: 'pending',
          approvedProposalIds: nextProposals
            .filter((p) => p.approved && !p.aiRejected)
            .map((p) => p.id),
        },
        apply: resetTail.apply,
        verify: resetTail.verify,
        download: resetTail.download,
      };
    });
  },

  setTierApproval: (tier, approved) => {
    const resetTail = createInitialState();
    set((state) => {
      const nextProposals = state.findings.proposals.map((p) =>
        p.riskTier === tier && !(approved && p.aiRejected) ? { ...p, approved } : p
      );
      return {
        findings: {
          ...state.findings,
          proposals: nextProposals,
        },
        approve: {
          status: 'pending',
          approvedProposalIds: nextProposals
            .filter((p) => p.approved && !p.aiRejected)
            .map((p) => p.id),
        },
        apply: resetTail.apply,
        verify: resetTail.verify,
        download: resetTail.download,
      };
    });
  },

  advanceFromFindings: () => {
    const { findings, completedStages, highestUnlockedStage, currentStage } = get();
    if (currentStage === 'approve') return;
    if (findings.status !== 'ready') return;
    set({
      completedStages: addCompletedStage(completedStages, 'findings'),
      highestUnlockedStage: maxStage(highestUnlockedStage, 'approve'),
      currentStage: 'approve',
    });
    if (get().keepSessionOptIn) {
      void saveOptInSession(get());
    }
  },

  executeApplyStage: () => {
    const {
      ingest,
      analysis,
      intent,
      findings,
      completedStages,
      highestUnlockedStage,
      isApplying,
      apply,
      currentStage,
    } = get();
    if (isApplying) return;
    if (currentStage === 'apply' && apply.status === 'applied') return;
    if (!ingest || !analysis.result || intent.status !== 'locked' || !intent.projectKind) {
      return;
    }

    set({ isApplying: true });
    try {
      const result = applyApprovedProposalsSequentially(
        ingest,
        analysis.result,
        intent.projectKind,
        intent.modifiers,
        findings.proposals
      );

      const nextCompleted = addCompletedStage(
        addCompletedStage(completedStages, 'approve'),
        'apply'
      );
      const resetTail = createInitialState();

      set({
        isApplying: false,
        completedStages: nextCompleted,
        highestUnlockedStage: maxStage(highestUnlockedStage, 'verify'),
        currentStage: 'apply',
        approve: {
          status: 'approved',
          approvedProposalIds: findings.proposals.filter((p) => p.approved).map((p) => p.id),
        },
        apply: {
          status: 'applied',
          appliedAt: new Date().toISOString(),
          outcomes: result.outcomes,
          appliedProposalIds: result.appliedProposalIds,
          rolledBackProposalIds: result.rolledBackProposalIds,
          addedPaths: result.addedPaths,
          modifiedPaths: result.modifiedPaths,
          workingFiles: result.workingFiles,
          workingPermissions: result.workingPermissions,
          changelogPath: result.changelogPath,
          noticePath: result.noticePath,
        },
        verify: resetTail.verify,
        download: {
          ...resetTail.download,
          changelogMarkdown: result.changelogMarkdown,
          noticeMarkdown: result.noticeMarkdown,
        },
      });
      if (get().keepSessionOptIn) {
        void saveOptInSession(get());
      }
    } finally {
      if (get().isApplying) {
        set({ isApplying: false });
      }
    }
  },

  executeVerifyStage: async () => {
    const {
      ingest,
      analysis,
      intent,
      apply,
      download,
      completedStages,
      highestUnlockedStage,
      isVerifying,
      verify,
      currentStage,
    } = get();
    if (isVerifying) return;
    if (currentStage === 'verify' && verify.status === 'complete') return;
    if (!ingest || !analysis.result || apply.status !== 'applied') return;

    cancelRunningTask();
    const seq = operationSeq;

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const changelogMarkdown =
      download.changelogMarkdown ??
      (apply.changelogPath && apply.workingFiles[apply.changelogPath]
        ? decoder.decode(apply.workingFiles[apply.changelogPath])
        : '');
    const noticeMarkdown =
      download.noticeMarkdown ??
      (apply.noticePath && apply.workingFiles[apply.noticePath]
        ? decoder.decode(apply.workingFiles[apply.noticePath])
        : '');

    set({
      isVerifying: true,
      verifyProgress: {
        active: true,
        task: 'verify',
        phase: 'starting',
        label: 'Starting verification in background worker...',
        completed: 0,
        total: Object.keys(apply.workingFiles).length,
        percent: 4,
      },
    });

    const handle = startVerifyAndPackageTask(
      ingest,
      analysis.result,
      intent,
      {
        outcomes: apply.outcomes,
        appliedProposalIds: apply.appliedProposalIds,
        rolledBackProposalIds: apply.rolledBackProposalIds,
        addedPaths: apply.addedPaths,
        modifiedPaths: apply.modifiedPaths,
        workingFiles: apply.workingFiles,
        workingPermissions: apply.workingPermissions,
        changelogPath: apply.changelogPath ?? 'CHANGELOG.md',
        noticePath: apply.noticePath ?? 'NOTICE.md',
        changelogMarkdown,
        noticeMarkdown,
      },
      (update) => {
        if (seq !== operationSeq) return;
        set({ verifyProgress: toWorkerProgress('verify', update) });
      }
    );
    activeTaskCancel = handle.cancel;

    try {
      const verifyResult = await handle.promise;
      if (seq !== operationSeq) return;
      activeTaskCancel = null;

      const nextCompleted = addCompletedStage(completedStages, 'verify');

      set({
        isVerifying: false,
        verifyProgress: null,
        completedStages: nextCompleted,
        highestUnlockedStage: maxStage(highestUnlockedStage, 'download'),
        currentStage: 'verify',
        verify: {
          status: 'complete',
          verifiedAt: verifyResult.verifiedAt,
          structuralPassed: verifyResult.structuralPassed,
          staticPassed: verifyResult.staticPassed,
          secretScanPassed: verifyResult.secretScanPassed,
          buildsAndTestsRun: false,
          honestyNotice: verifyResult.honestyNotice,
          note: verifyResult.note,
          checks: verifyResult.checks,
          outputSha256ByPath: verifyResult.outputSha256ByPath,
          untouchedVerifiedCount: verifyResult.untouchedVerifiedCount,
          untouchedTotalCount: verifyResult.untouchedTotalCount,
          modifiedVerifiedCount: verifyResult.modifiedVerifiedCount,
          addedVerifiedCount: verifyResult.addedVerifiedCount,
          outputSecretFindings: verifyResult.outputSecretFindings,
          newSecretFindings: verifyResult.newSecretFindings,
          outputZipBytes: verifyResult.outputZipBytes,
        },
        download: {
          status: 'ready',
          outputArchiveName: verifyResult.outputArchiveName,
          changelogMarkdown,
          noticeMarkdown,
          unifiedPatchDiff: verifyResult.unifiedPatchDiff,
          beforeAfterReportMarkdown: verifyResult.beforeAfterReportMarkdown,
        },
      });
      if (get().keepSessionOptIn) {
        void saveOptInSession(get());
      }
    } catch (err) {
      if (seq !== operationSeq) return;
      activeTaskCancel = null;
      if (isCancelledError(err)) {
        set({
          isVerifying: false,
          verifyProgress: null,
        });
        return;
      }
      set({
        isVerifying: false,
        verifyProgress: null,
      });
    }
  },

  advanceFromVerify: () => {
    const { verify, completedStages, highestUnlockedStage, currentStage } = get();
    if (currentStage === 'download') return;
    if (verify.status !== 'complete') return;
    set({
      completedStages: addCompletedStage(completedStages, 'download'),
      highestUnlockedStage: maxStage(highestUnlockedStage, 'download'),
      currentStage: 'download',
    });
    if (get().keepSessionOptIn) {
      void saveOptInSession(get());
    }
  },

  goToStage: (stage) => {
    const {
      highestUnlockedStage,
      analysis,
      ingest,
      intent,
      findings,
      apply,
      verify,
      ingestStatus,
      isApplying,
      isVerifying,
    } = get();
    if (ingestStatus === 'ingesting' || isApplying || isVerifying) {
      return;
    }
    if (stageIndex(stage) <= stageIndex(highestUnlockedStage)) {
      if (stage === 'analyse' && ingest && analysis.status === 'pending') {
        get().runAnalysis();
      }
      if (
        stage === 'findings' &&
        ingest &&
        analysis.status === 'ready' &&
        intent.status === 'locked' &&
        findings.status === 'pending'
      ) {
        get().runFindingsGeneration();
      }
      if (stage === 'verify' && apply.status === 'applied' && verify.status === 'pending') {
        void get().executeVerifyStage();
        return;
      }
      set({ currentStage: stage });
      if (get().keepSessionOptIn) {
        void saveOptInSession(get());
      }
    }
  },

  resetPipeline: () => {
    cancelRunningTask();
    const prev = get();
    wipePipelineBuffers(prev);
    void clearOptInSession();
    const policy = prev.nestedArchivePolicy;
    const aiEnabled = prev.aiEnabled;
    set({
      ...createInitialState(policy, aiEnabled, false),
      sessionHydrated: true,
    });
  },
}));
