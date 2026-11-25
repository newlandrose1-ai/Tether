'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { Database, Lock, RotateCcw, ShieldAlert, Sparkles } from 'lucide-react';
import { PIPELINE_STAGES, type PipelineStage } from '../types/pipeline';
import { usePipelineStore, wipePipelineBuffers } from '../store/pipelineStore';
import { StageErrorBoundary } from './StageErrorBoundary';
import { StageProgressBar } from './StageProgressBar';
import { AnalyseStage } from './stages/AnalyseStage';
import { ApplyStage } from './stages/ApplyStage';
import { ApproveStage } from './stages/ApproveStage';
import { DownloadStage } from './stages/DownloadStage';
import { FindingsProposalsStage } from './stages/FindingsProposalsStage';
import { IntentLockStage } from './stages/IntentLockStage';
import { UploadIngestStage } from './stages/UploadIngestStage';
import { VerifyStage } from './stages/VerifyStage';

function isValidPipelineStage(value: unknown): value is PipelineStage {
  return (
    typeof value === 'string' && PIPELINE_STAGES.some((meta) => meta.id === value)
  );
}

export function PipelineShell() {
  const currentStage = usePipelineStore((s) => s.currentStage);
  const highestUnlockedStage = usePipelineStore((s) => s.highestUnlockedStage);
  const completedStages = usePipelineStore((s) => s.completedStages);
  const ingest = usePipelineStore((s) => s.ingest);
  const ingestStatus = usePipelineStore((s) => s.ingestStatus);
  const ingestError = usePipelineStore((s) => s.ingestError);
  const analysis = usePipelineStore((s) => s.analysis);
  const intent = usePipelineStore((s) => s.intent);
  const isApplying = usePipelineStore((s) => s.isApplying);
  const isVerifying = usePipelineStore((s) => s.isVerifying);
  const aiEnabled = usePipelineStore((s) => s.aiEnabled);
  const keepSessionOptIn = usePipelineStore((s) => s.keepSessionOptIn);
  const aiRequestBudgetUsed = usePipelineStore((s) => s.aiRequestBudgetUsed);
  const aiRequestBudgetLimit = usePipelineStore((s) => s.aiRequestBudgetLimit);
  const setAiEnabled = usePipelineStore((s) => s.setAiEnabled);
  const setKeepSessionOptIn = usePipelineStore((s) => s.setKeepSessionOptIn);
  const hydrateOptInSession = usePipelineStore((s) => s.hydrateOptInSession);
  const goToStage = usePipelineStore((s) => s.goToStage);
  const resetPipeline = usePipelineStore((s) => s.resetPipeline);

  const [confirmingReset, setConfirmingReset] = useState(false);
  const handlingPopStateRef = useRef(false);
  const lastPushedStageRef = useRef<PipelineStage>('upload');

  // Hydrate opt-in session from IndexedDB on mount if the user previously opted in
  useEffect(() => {
    void hydrateOptInSession();
  }, [hydrateOptInSession]);

  // Synchronize safe stage navigation with browser history (Back / Forward)
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const candidateStage = (event.state as { stage?: unknown } | null)?.stage;
      const hashStage = window.location.hash.replace(/^#step-/, '');
      const target = isValidPipelineStage(candidateStage)
        ? candidateStage
        : isValidPipelineStage(hashStage)
        ? hashStage
        : null;

      if (!target) return;
      handlingPopStateRef.current = true;
      usePipelineStore.getState().goToStage(target);
      window.setTimeout(() => {
        handlingPopStateRef.current = false;
      }, 0);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (handlingPopStateRef.current) {
      lastPushedStageRef.current = currentStage;
      return;
    }
    if (lastPushedStageRef.current !== currentStage) {
      lastPushedStageRef.current = currentStage;
      try {
        window.history.pushState({ stage: currentStage }, '', `#step-${currentStage}`);
      } catch {
        // History API restricted; ignore safely
      }
    }
  }, [currentStage]);

  // Warn before leaving mid-job and wipe in-memory buffers when closing without opt-in persistence
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const st = usePipelineStore.getState();
      const midJob =
        st.ingestStatus === 'ingesting' ||
        st.isApplying ||
        st.isVerifying ||
        (Boolean(st.ingest) && st.currentStage !== 'download');

      if (midJob) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    const onPageHide = () => {
      const st = usePipelineStore.getState();
      if (st.keepSessionOptIn) {
        wipePipelineBuffers(st);
      } else {
        st.resetPipeline();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  const hasActiveJob = Boolean(ingest || ingestError);
  const secretCount = ingest?.secretFindings.length ?? 0;

  const handleStartOverClick = () => {
    if (!hasActiveJob && ingestStatus !== 'ingesting') {
      resetPipeline();
      return;
    }
    setConfirmingReset(true);
  };

  const handleConfirmReset = () => {
    resetPipeline();
    setConfirmingReset(false);
  };

  const diagnosticsContext = {
    stage: currentStage,
    fileCount: ingest?.fileCount ?? 0,
    primaryLanguage: analysis.result?.primaryLanguage ?? null,
    profileId: intent.projectKind ?? null,
    ingestStatus,
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#0B0E14] text-slate-100 flex flex-col">
        <header className="border-b border-slate-800 bg-[#0B0E14]">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <a
              href="#pipeline"
              onClick={(e) => {
                e.preventDefault();
                goToStage('upload');
              }}
              className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
            >
              Zip Upgrader
            </a>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                aria-pressed={keepSessionOptIn}
                onClick={() => setKeepSessionOptIn(!keepSessionOptIn)}
                title="Disabled by default: nothing is saved to disk or localStorage unless opted in (uses browser IndexedDB and clears on Start over)."
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  keepSessionOptIn
                    ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200 hover:bg-emerald-950/40'
                    : 'border-slate-700 bg-transparent text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                }`}
              >
                <Database className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{keepSessionOptIn ? 'Keep this session: On' : 'Keep this session: Off'}</span>
              </button>

              <button
                type="button"
                aria-pressed={aiEnabled}
                onClick={() => setAiEnabled(!aiEnabled)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  aiEnabled
                    ? 'border-blue-500/40 bg-blue-950/20 text-blue-200 hover:bg-blue-950/40'
                    : 'border-slate-700 bg-transparent text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{aiEnabled ? 'AI help: On' : 'AI help: Off (local only)'}</span>
              </button>

              {confirmingReset ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-1.5 text-xs"
                >
                  <span className="text-amber-100">Clears files &amp; saved session.</span>
                  <button
                    type="button"
                    onClick={handleConfirmReset}
                    className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-500 whitespace-nowrap"
                  >
                    Yes, start over
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(false)}
                    className="rounded border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleStartOverClick}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Start over</span>
                </button>
              )}
            </div>
          </div>
        </header>

        <StageProgressBar
          currentStage={currentStage}
          highestUnlockedStage={highestUnlockedStage}
          completedStages={completedStages}
          onSelectStage={goToStage}
        />

        {/* Always-visible Privacy note */}
        <aside
          aria-label="Privacy guarantee"
          className="border-b border-slate-800/80 bg-[#0D1119]"
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-1.5 px-4 py-2.5 text-xs text-slate-300 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 text-blue-400 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold text-slate-100">Privacy:</strong>{' '}
                {keepSessionOptIn
                  ? 'Saved locally in browser IndexedDB (cleared on Start over). '
                  : 'Your .zip stays strictly in volatile memory (nothing saved to disk or localStorage). '}
                {aiEnabled
                  ? `Only redacted top-priority chunks are sent to Gemini if you confirm (${aiRequestBudgetUsed}/${aiRequestBudgetLimit} AI calls used).`
                  : 'AI help is Off — running 100% deterministic rules locally.'}
              </span>
            </div>
            {ingest && (
              <div className="flex items-center gap-1.5 font-medium shrink-0 sm:pl-4">
                <ShieldAlert
                  className={`h-3.5 w-3.5 shrink-0 ${
                    secretCount > 0 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                  aria-hidden="true"
                />
                <span className={secretCount > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                  {secretCount > 0
                    ? `${secretCount} secret(s) hidden from AI`
                    : '0 secrets found'}
                </span>
              </div>
            )}
          </div>
        </aside>

        <main id="pipeline" className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:py-8">
          <StageErrorBoundary
            key={currentStage}
            stage={currentStage}
            diagnosticsContext={diagnosticsContext}
            onStartOver={handleConfirmReset}
          >
            <motion.div
              key={currentStage}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            >
              {currentStage === 'upload' ? (
                <UploadIngestStage />
              ) : currentStage === 'analyse' ? (
                <AnalyseStage />
              ) : currentStage === 'intent' ? (
                <IntentLockStage />
              ) : currentStage === 'findings' ? (
                <FindingsProposalsStage />
              ) : currentStage === 'approve' ? (
                <ApproveStage />
              ) : currentStage === 'apply' ? (
                <ApplyStage />
              ) : currentStage === 'verify' ? (
                <VerifyStage />
              ) : (
                <DownloadStage />
              )}
            </motion.div>
          </StageErrorBoundary>
        </main>

        <footer className="border-t border-slate-800 bg-[#0B0E14]">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-400">
            <span>Runs locally in your browser · Original .zip is never changed</span>
            <span>Untouched files keep identical SHA-256 fingerprints</span>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
