'use client';

import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  CopyCheck,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';
import { usePipelineStore } from '../../store/pipelineStore';

export function ApplyStage() {
  const ingest = usePipelineStore((s) => s.ingest);
  const apply = usePipelineStore((s) => s.apply);
  const isVerifying = usePipelineStore((s) => s.isVerifying);
  const verifyProgress = usePipelineStore((s) => s.verifyProgress);
  const executeVerifyStage = usePipelineStore((s) => s.executeVerifyStage);
  const cancelActiveOperation = usePipelineStore((s) => s.cancelActiveOperation);
  const goToStage = usePipelineStore((s) => s.goToStage);

  if (!ingest || apply.status !== 'applied') {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-8 text-center space-y-3">
        <h1 className="text-lg font-semibold text-slate-100">No changes applied yet</h1>
        <p className="text-sm text-slate-300">
          What happens next: Approve your selected changes so we can patch an isolated copy of your
          project.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => goToStage('approve')}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap"
          >
            Go to Approve
          </button>
        </div>
      </div>
    );
  }

  const appliedCount = apply.appliedProposalIds.length;
  const rolledBackCount = apply.rolledBackProposalIds.length;

  return (
    <div className="space-y-6">
      {/* 3-part stage header */}
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Apply changes to safe copy
            </h1>
            <p className="text-sm text-slate-300">
              <strong className="font-medium text-slate-100">What happens next:</strong> We check
              SHA-256 fingerprints (to prove untouched files are identical) and file syntax before
              preparing your download.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isVerifying}
              onClick={() => goToStage('approve')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800/70 hover:text-slate-100 disabled:opacity-60 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Back to Approve</span>
            </button>
            <button
              type="button"
              onClick={() => void executeVerifyStage()}
              disabled={isVerifying}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 whitespace-nowrap"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
                  <span>Checking integrity &amp; syntax...</span>
                </>
              ) : (
                <>
                  <span>Verify &amp; Download</span>
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Explicit determinate verification progress */}
      {isVerifying && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-blue-500/40 bg-[#111620] p-5 space-y-3 text-xs text-slate-200"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-sm text-slate-100">
              {verifyProgress?.label ?? 'Preparing verified download...'}
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono font-semibold tabular-nums text-blue-300">
                {verifyProgress?.percent ?? 0}%
              </span>
              <button
                type="button"
                onClick={cancelActiveOperation}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-transparent px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
              >
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
          <div
            role="progressbar"
            aria-label="Verifying output archive"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={verifyProgress?.percent ?? 0}
            className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
          >
            <div
              className="h-full rounded-full bg-blue-500 transition-[width] duration-150"
              style={{ width: `${Math.max(4, verifyProgress?.percent ?? 4)}%` }}
            />
          </div>
          <p className="text-slate-300">
            Running in background worker: packaging output .zip, checking SHA-256 fingerprints,
            validating JSON/JS/TS syntax, and re-running the secret scan.
          </p>
        </div>
      )}

      {/* Isolation confirmation */}
      <div className="flex items-start gap-3 rounded-lg border border-emerald-500/35 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-100">
        <CopyCheck className="mt-0.5 h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold">Original upload untouched:</strong>{' '}
          <span className="font-mono">{ingest.archiveName}</span> stays read-only.{' '}
          <strong className="tabular-nums">{appliedCount}</strong> change(s) applied,{' '}
          <strong className="tabular-nums">{rolledBackCount}</strong> rolled back.
        </span>
      </div>

      {rolledBackCount > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-xs text-amber-100"
        >
          {rolledBackCount} change(s) failed syntax, import, or secret checks and were rolled back
          automatically. All other approved changes and untouched files remain safe.
        </div>
      )}

      {/* Per-proposal status log */}
      <section className="rounded-lg border border-slate-800 bg-[#111620] overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-100">Change status</h2>
          <p className="text-xs text-slate-400">
            Each change runs syntax, import, dependency, and secret checks before it is kept.
          </p>
        </div>

        {apply.outcomes.length === 0 ? (
          <div className="px-5 py-6 text-xs text-slate-300 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            <span>
              No code/config proposals were ticked. Only {apply.changelogPath} and{' '}
              {apply.noticePath} were added.
            </span>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {apply.outcomes.map((item, idx) => {
              const appliedOk = item.status === 'applied';
              return (
                <li key={item.proposalId} className="px-5 py-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-slate-400 tabular-nums">#{idx + 1}</span>
                      <span className="font-semibold text-slate-100">{item.title}</span>
                      <span className="text-slate-400">· {item.licence}</span>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                        appliedOk ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {appliedOk ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span>{appliedOk ? 'Done' : 'Rolled back'}</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{item.reason}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
                    {item.touchedPaths.map((p) => (
                      <span key={p} className="break-all">
                        {p}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Summary of files added and modified */}
      <section className="rounded-lg border border-slate-800 bg-[#111620] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-100">
          Files added ({apply.addedPaths.length}) &amp; changed ({apply.modifiedPaths.length})
        </h2>
        <div className="space-y-1.5 font-mono text-xs">
          {apply.addedPaths.map((p) => (
            <div key={`add:${p}`} className="flex items-center gap-2 text-emerald-300">
              <span className="w-4 font-bold shrink-0">+</span>
              <span className="break-all">{p}</span>
            </div>
          ))}
          {apply.modifiedPaths.map((p) => (
            <div key={`mod:${p}`} className="flex items-center gap-2 text-amber-300">
              <span className="w-4 font-bold shrink-0">~</span>
              <span className="break-all">{p}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
