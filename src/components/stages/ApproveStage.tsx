'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileCode2,
  ShieldAlert,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { usePipelineStore } from '../../store/pipelineStore';
import type { RiskTier } from '../../types/pipeline';

const TIER_ORDER: readonly RiskTier[] = ['A', 'B', 'C'];

const TIER_LABEL: Record<RiskTier, string> = {
  A: 'Safe setup changes (Tier A)',
  B: 'Dependency changes (Tier B)',
  C: 'Code changes, review carefully (Tier C)',
};

export function ApproveStage() {
  const ingest = usePipelineStore((s) => s.ingest);
  const analysis = usePipelineStore((s) => s.analysis);
  const findingsState = usePipelineStore((s) => s.findings);
  const toggleProposalApproval = usePipelineStore((s) => s.toggleProposalApproval);
  const rejectAiProposal = usePipelineStore((s) => s.rejectAiProposal);
  const restoreAiProposal = usePipelineStore((s) => s.restoreAiProposal);
  const setTierApproval = usePipelineStore((s) => s.setTierApproval);
  const isApplying = usePipelineStore((s) => s.isApplying);
  const executeApplyStage = usePipelineStore((s) => s.executeApplyStage);
  const goToStage = usePipelineStore((s) => s.goToStage);

  const [expandedDiffIds, setExpandedDiffIds] = useState<Record<string, boolean>>({});

  if (!ingest || findingsState.status !== 'ready') {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-8 text-center space-y-3">
        <h1 className="text-lg font-semibold text-slate-100">Review suggested changes first</h1>
        <p className="text-sm text-slate-300">
          What happens next: Open Review to choose which improvements to include before approving.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => goToStage('findings')}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap"
          >
            Go to Review
          </button>
        </div>
      </div>
    );
  }

  const proposals = findingsState.proposals;
  const approvedProposals = proposals.filter((p) => p.approved);
  const hasTierC = approvedProposals.some((p) => p.riskTier === 'C');

  const toggleDiff = (id: string) => {
    setExpandedDiffIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      {/* 3-part stage header */}
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-5 sm:p-6 space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Approve changes to apply
            </h1>
            <p className="text-sm text-slate-300">
              <strong className="font-medium text-slate-100">What happens next:</strong> Each
              approved change is applied one by one to a safe copy of your project, and any broken
              change is rolled back automatically.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isApplying}
              onClick={() => goToStage('findings')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800/70 hover:text-slate-100 disabled:opacity-60 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Back to Review</span>
            </button>
            <button
              type="button"
              disabled={isApplying}
              onClick={executeApplyStage}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 whitespace-nowrap"
            >
              <span>{isApplying ? 'Applying...' : `Apply ${approvedProposals.length} changes`}</span>
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* One confirmation line explaining the consequence */}
        <div className="flex items-start gap-2.5 rounded-md border border-slate-700 bg-[#0B0E14] px-4 py-3 text-xs text-slate-200">
          {hasTierC ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
          )}
          <span>
            <strong className="font-semibold text-slate-100">Confirmation:</strong> Applying writes{' '}
            {approvedProposals.length} change{approvedProposals.length === 1 ? '' : 's'} plus a
            changelog and notice file to a separate browser copy—your original{' '}
            <span className="font-mono">{ingest.archiveName}</span> is never modified.
          </span>
        </div>
      </div>

      {analysis.result && analysis.result.detectedInstallScripts.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-xs text-amber-100 space-y-1"
        >
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span>
              Uploaded archive defines {analysis.result.detectedInstallScripts.length} package.json install script(s)
            </span>
          </div>
          <p className="text-amber-200/90">
            Zip Upgrader blocks adding any install scripts; verify existing scripts before running install after download.
          </p>
        </div>
      )}

      {approvedProposals.length === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-100">
          No proposals are currently ticked. Continuing now will keep all project files untouched
          and add only <span className="font-mono">CHANGELOG.md</span> and{' '}
          <span className="font-mono">NOTICE.md</span>.
        </div>
      )}

      {/* Single-column grouped checklist */}
      <div className="space-y-4">
        {TIER_ORDER.map((tier) => {
          const tierItems = proposals.filter((p) => p.riskTier === tier);
          if (tierItems.length === 0) return null;
          const approvedCount = tierItems.filter((p) => p.approved).length;
          const allTicked = approvedCount === tierItems.length;

          return (
            <section
              key={tier}
              className="rounded-lg border border-slate-800 bg-[#111620] overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">{TIER_LABEL[tier]}</h2>
                  <p className="text-xs text-slate-400 tabular-nums">
                    {approvedCount} of {tierItems.length} selected
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTierApproval(tier, !allTicked)}
                  className="rounded-md border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
                >
                  {allTicked ? 'Clear section' : 'Select all'}
                </button>
              </div>

              <div className="divide-y divide-slate-800/70">
                {tierItems.map((proposal) => {
                  const isOpen = Boolean(expandedDiffIds[proposal.id]);
                  return (
                    <div key={proposal.id} className="px-5 py-3.5 space-y-2.5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            disabled={Boolean(proposal.aiRejected)}
                            onClick={() => toggleProposalApproval(proposal.id)}
                            aria-label={`Toggle approval for ${proposal.title}`}
                            className="mt-0.5 text-slate-300 hover:text-blue-400 disabled:opacity-40 shrink-0"
                          >
                            {proposal.approved && !proposal.aiRejected ? (
                              <CheckSquare className="h-4 w-4 text-blue-400" />
                            ) : (
                              <Square className="h-4 w-4 text-slate-500" />
                            )}
                          </button>
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span
                                className={`font-semibold ${
                                  proposal.aiRejected
                                    ? 'text-slate-500 line-through'
                                    : 'text-slate-100'
                                }`}
                              >
                                {proposal.title}
                              </span>
                              {proposal.aiSuggested && (
                                <span className="inline-flex items-center gap-1 font-medium text-amber-300">
                                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  AI-suggested, review before applying
                                </span>
                              )}
                              {proposal.promptVersion && (
                                <span className="font-mono text-[11px] text-slate-400">
                                  {proposal.promptVersion}
                                </span>
                              )}
                              {proposal.aiRejected && (
                                <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                                  Rejected
                                </span>
                              )}
                              {proposal.unverifiedPackage && (
                                <span className="inline-flex items-center gap-1 rounded border border-rose-500/50 bg-rose-950/40 px-2 py-0.5 text-[11px] font-medium text-rose-200">
                                  <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  not in registry, unverified
                                </span>
                              )}
                              <span className="text-slate-400">· {proposal.licence}</span>
                            </div>
                            <p className="text-xs text-slate-300">{proposal.expectedEffect}</p>
                            {proposal.securityWarnings && proposal.securityWarnings.length > 0 && (
                              <p className="text-xs text-amber-200">
                                Security warning: {proposal.securityWarnings.join(' ')}
                              </p>
                            )}
                            {proposal.aiSuggested && (
                              <p className="text-xs text-amber-200">{proposal.why}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
                              <FileCode2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              {proposal.targetPaths.map((tp) => (
                                <span key={tp} className="text-slate-200 break-all">
                                  {tp}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-start shrink-0">
                          {proposal.aiSuggested &&
                            (proposal.aiRejected ? (
                              <button
                                type="button"
                                onClick={() => restoreAiProposal(proposal.id)}
                                className="rounded border border-slate-700 bg-transparent px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
                              >
                                Restore
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => rejectAiProposal(proposal.id)}
                                className="rounded border border-rose-500/40 bg-transparent px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-950/30 whitespace-nowrap"
                              >
                                Reject AI item
                              </button>
                            ))}

                          <button
                            type="button"
                            onClick={() => toggleDiff(proposal.id)}
                            aria-expanded={isOpen}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-transparent px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            {isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            {isOpen ? 'Hide diff' : 'Inspect diff'}
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <pre className="max-h-60 overflow-auto rounded-md border border-slate-800 bg-[#0B0E14] p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                          {proposal.diffPreview}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
