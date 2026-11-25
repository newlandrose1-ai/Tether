'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Package,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react';
import { getFindingsAiPreview } from '../../lib/findingsEngine';
import { getLoadedProfiles } from '../../lib/intentClassifier';
import { usePipelineStore } from '../../store/pipelineStore';
import type { FindingItem, ProposalItem, RiskTier } from '../../types/pipeline';
import { AiPayloadPreviewCard } from '../AiPayloadPreviewCard';

const TIER_META: Record<
  RiskTier,
  {
    header: string;
    badgeLabel: string;
    subtitle: string;
    icon: typeof ShieldCheck;
    toneClass: string;
  }
> = {
  A: {
    header: 'Safe setup changes',
    badgeLabel: 'Tier A · Safe setup',
    subtitle:
      'Additive config files, templates, and documentation. Pre-ticked for you because they do not alter existing app logic.',
    icon: ShieldCheck,
    toneClass: 'text-emerald-300',
  },
  B: {
    header: 'Dependency changes',
    badgeLabel: 'Tier B · Dependency change',
    subtitle:
      'Allowed open-source libraries added to package.json (your project dependency list) with a small starter helper.',
    icon: Package,
    toneClass: 'text-blue-300',
  },
  C: {
    header: 'Code changes, review carefully',
    badgeLabel: 'Tier C · Code change',
    subtitle:
      'New runtime code, handlers, or middleware. Read the diff preview carefully before approving.',
    icon: Wrench,
    toneClass: 'text-amber-300',
  },
};

function renderUnifiedDiffLines(diff: string) {
  return diff.split('\n').map((line, index) => {
    const isHeader = line.startsWith('+++') || line.startsWith('---');
    const isHunk = line.startsWith('@@');
    const isAdded = !isHeader && line.startsWith('+');
    const isRemoved = !isHeader && line.startsWith('-');

    let rowClass = 'text-slate-300';
    let marker = ' ';
    let content = line;

    if (isHeader || isHunk) {
      rowClass = 'text-slate-400 font-semibold';
    } else if (isAdded) {
      rowClass = 'bg-emerald-950/40 text-emerald-200';
      marker = '+';
      content = line.slice(1);
    } else if (isRemoved) {
      rowClass = 'bg-rose-950/40 text-rose-200';
      marker = '-';
      content = line.slice(1);
    }

    return (
      <div key={`${index}:${line.slice(0, 24)}`} className={`flex gap-2 px-3 py-0.5 ${rowClass}`}>
        {!isHeader && !isHunk && (
          <span
            aria-hidden="true"
            className="w-3 shrink-0 select-none text-center font-bold"
          >
            {marker}
          </span>
        )}
        <span className="min-w-0 whitespace-pre-wrap break-all">{content || ' '}</span>
      </div>
    );
  });
}

function sourceLabel(proposal: ProposalItem): string {
  if (proposal.aiSuggested) return 'AI-suggested, review before applying';
  if (proposal.source === 'registry-library') return 'Library';
  return 'Generated';
}

export function FindingsProposalsStage() {
  const ingest = usePipelineStore((s) => s.ingest);
  const analysis = usePipelineStore((s) => s.analysis);
  const intent = usePipelineStore((s) => s.intent);
  const aiEnabled = usePipelineStore((s) => s.aiEnabled);
  const findingsState = usePipelineStore((s) => s.findings);
  const runFindingsGeneration = usePipelineStore((s) => s.runFindingsGeneration);
  const requestGeminiFindings = usePipelineStore((s) => s.requestGeminiFindings);
  const rejectAiProposal = usePipelineStore((s) => s.rejectAiProposal);
  const restoreAiProposal = usePipelineStore((s) => s.restoreAiProposal);
  const toggleProposalApproval = usePipelineStore((s) => s.toggleProposalApproval);
  const setTierApproval = usePipelineStore((s) => s.setTierApproval);
  const goToStage = usePipelineStore((s) => s.goToStage);
  const advanceFromFindings = usePipelineStore((s) => s.advanceFromFindings);

  const [findingFilter, setFindingFilter] = useState<'gaps' | 'all' | 'satisfied'>('gaps');
  const [expandedDiffIds, setExpandedDiffIds] = useState<Record<string, boolean>>({});
  const [showPolicyLog, setShowPolicyLog] = useState(false);
  const [showAiPreview, setShowAiPreview] = useState(false);

  useEffect(() => {
    if (
      ingest &&
      analysis.status === 'ready' &&
      intent.status === 'locked' &&
      findingsState.status === 'pending'
    ) {
      runFindingsGeneration();
    }
  }, [ingest, analysis.status, intent.status, findingsState.status, runFindingsGeneration]);

  if (!ingest || !analysis.result || intent.status !== 'locked' || !intent.projectKind) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-8 text-center space-y-3">
        <h1 className="text-lg font-semibold text-slate-100">Confirm your project type first</h1>
        <p className="text-sm text-slate-300">
          What happens next: Confirm your project type so we know which setup checks and upgrades
          apply.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => goToStage('intent')}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap"
          >
            Go to Confirm type
          </button>
        </div>
      </div>
    );
  }

  const profile = getLoadedProfiles().find((p) => p.id === intent.projectKind);
  const allFindings = findingsState.findings;
  const gapFindings = allFindings.filter((f) => f.status === 'gap');
  const satisfiedFindings = allFindings.filter((f) => f.status === 'satisfied');

  const visibleFindings =
    findingFilter === 'gaps'
      ? gapFindings
      : findingFilter === 'satisfied'
      ? satisfiedFindings
      : allFindings;

  const proposals = findingsState.proposals;
  const approvedCount = proposals.filter((p) => p.approved).length;
  const findingById = new Map<string, FindingItem>(allFindings.map((f) => [f.id, f]));

  const toggleDiff = (proposalId: string) => {
    setExpandedDiffIds((prev) => ({
      ...prev,
      [proposalId]: !(prev[proposalId] ?? false),
    }));
  };

  return (
    <div className="space-y-6 pb-20">
      {/* 3-part stage header */}
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Review findings and suggested changes
            </h1>
            <p className="text-sm text-slate-300">
              <strong className="font-medium text-slate-100">What happens next:</strong> Pick the
              changes you want for your <strong className="text-slate-100">{profile?.name}</strong>{' '}
              project, then confirm them in Approve. Nothing is changed yet.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => goToStage('intent')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={runFindingsGeneration}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Re-check</span>
            </button>
            <button
              type="button"
              disabled={findingsState.geminiStatus === 'loading'}
              onClick={() => {
                if (!aiEnabled) {
                  void requestGeminiFindings();
                } else {
                  setShowAiPreview((v) => !v);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800/70 disabled:opacity-50 whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5 text-blue-400 shrink-0" aria-hidden="true" />
              <span>
                {!aiEnabled
                  ? 'AI help is Off'
                  : findingsState.geminiStatus === 'loading'
                  ? 'Asking AI...'
                  : showAiPreview
                  ? 'Hide AI preview'
                  : 'Ask AI for other gaps'}
              </span>
            </button>
          </div>
        </div>

        {showAiPreview && aiEnabled && (() => {
          const deterministicFindings = allFindings.filter((f) => !f.aiSuggested);
          const preview = getFindingsAiPreview(
            ingest,
            analysis.result,
            intent.projectKind,
            intent.modifiers,
            deterministicFindings
          );
          return (
            <div className="mt-4">
              <AiPayloadPreviewCard
                title={`What will be sent to AI (${preview.promptVersion})`}
                description="Review the exact redacted summary and prioritized <file> chunks before sending to Gemini."
                fileCount={preview.fileCount}
                strippedCount={preview.strippedCount}
                charCount={preview.charCount}
                maxChars={preview.maxChars}
                previewText={preview.previewText}
                isLoading={findingsState.geminiStatus === 'loading'}
                onCancel={() => setShowAiPreview(false)}
                onConfirmSend={() => {
                  setShowAiPreview(false);
                  void requestGeminiFindings();
                }}
              />
            </div>
          );
        })()}

        {findingsState.geminiStatus === 'loading' && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 rounded-md border border-blue-500/40 bg-blue-950/20 px-4 py-3 text-xs text-blue-100"
          >
            Asking Gemini for extra non-checklist gaps using prioritized redacted chunks only...
          </div>
        )}

        {findingsState.geminiStatus === 'skipped' && findingsState.geminiSkipReason && (
          <div
            role="status"
            className="mt-4 rounded-md border border-slate-700 bg-[#0B0E14] px-4 py-3 text-xs text-slate-200 space-y-1"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                Skipped
              </span>
              <span className="font-semibold text-slate-100">
                AI extra gap check skipped — deterministic rules still run
              </span>
              {findingsState.geminiPromptVersion && (
                <span className="font-mono text-[11px] text-slate-400">
                  ({findingsState.geminiPromptVersion})
                </span>
              )}
            </div>
            <p className="text-slate-300">{findingsState.geminiSkipReason}</p>
          </div>
        )}

        {findingsState.geminiStatus === 'error' && findingsState.geminiError && (
          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
            AI gap check skipped ({findingsState.geminiError}). Deterministic checks above still
            apply.
          </div>
        )}

        {findingsState.geminiStatus === 'ready' && (
          <div className="mt-4 rounded-md border border-blue-500/40 bg-blue-950/20 px-4 py-3 text-xs text-blue-200 flex flex-wrap items-center gap-2">
            <span>
              AI scan finished ({findingsState.geminiPromptVersion ?? 'gap-analysis@1.0.0'}
              {findingsState.geminiCacheHit ? ', cached by file SHA-256' : ''}): suggested{' '}
              {allFindings.filter((f) => f.aiSuggested).length} item(s). Review or reject any AI
              suggestion below.
            </span>
          </div>
        )}
      </div>

      {analysis.result.detectedInstallScripts.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-xs text-amber-100 space-y-1.5"
        >
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span>
              Existing package.json install scripts detected ({analysis.result.detectedInstallScripts.length})
            </span>
          </div>
          <p className="text-amber-200/90">
            Zip Upgrader blocks adding any install lifecycle scripts. Inspect existing scripts below
            before running install locally:
          </p>
          <ul className="space-y-0.5 pl-6 font-mono text-amber-200">
            {analysis.result.detectedInstallScripts.map((script, idx) => (
              <li key={`${script.file}:${script.scriptName}:${idx}`} className="break-all">
                {script.file} → &ldquo;{script.scriptName}&rdquo;: {script.command}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Section 1: Findings (plain statements of what's missing) */}
      <section
        aria-label="Findings: what is missing"
        className="rounded-lg border border-slate-800 bg-[#111620] p-5 space-y-4"
      >
        <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              1. Findings — what&rsquo;s missing ({gapFindings.length} missing)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Plain facts checked against your project type and general best practices.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B0E14] p-1 self-start">
            {(
              [
                { id: 'gaps', label: `Missing (${gapFindings.length})` },
                { id: 'all', label: `All (${allFindings.length})` },
                { id: 'satisfied', label: `Present (${satisfiedFindings.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFindingFilter(tab.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  findingFilter === tab.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {visibleFindings.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            No items match this filter.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {visibleFindings.map((finding) => {
              const isMissing = finding.status === 'gap';
              return (
                <li
                  key={finding.id}
                  className="flex flex-col gap-1.5 py-3.5 text-xs sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {isMissing ? (
                      <XCircle className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 text-emerald-400 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-100">{finding.title}</span>
                        <span
                          className={`text-[11px] font-medium ${
                            isMissing ? 'text-amber-300' : 'text-emerald-300'
                          }`}
                        >
                          ({isMissing ? 'Missing' : 'Present'})
                        </span>
                        {finding.aiSuggested && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-300">
                            <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
                            AI-suggested, review before applying
                          </span>
                        )}
                      </div>
                      <p className="text-slate-300">{finding.evidence}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Section 2: Proposals grouped by Risk */}
      <section aria-label="Suggested changes" className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            2. Proposals — suggested changes ({proposals.length})
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Each change fixes a specific finding above. Safe setup changes are pre-ticked;
            dependencies and code changes wait for your tick.
          </p>
        </div>

        {(['A', 'B', 'C'] as const).map((tier) => {
          const tierProposals = proposals.filter((p) => p.riskTier === tier);
          const meta = TIER_META[tier];
          const TierIcon = meta.icon;
          const tierCheckedCount = tierProposals.filter((p) => p.approved).length;

          return (
            <div key={tier} className="rounded-lg border border-slate-800 bg-[#111620] p-5 space-y-4">
              <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <TierIcon className={`h-4 w-4 shrink-0 ${meta.toneClass}`} aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-slate-100">{meta.header}</h3>
                    <span className="font-mono text-xs tabular-nums text-slate-400">
                      ({tierCheckedCount}/{tierProposals.length} selected)
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{meta.subtitle}</p>
                </div>

                {tierProposals.length > 0 && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setTierApproval(tier, true)}
                      className="rounded border border-slate-700 bg-transparent px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setTierApproval(tier, false)}
                      className="rounded border border-slate-800 bg-transparent px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-slate-200 whitespace-nowrap"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {tierProposals.length === 0 ? (
                <p className="py-3 text-xs text-slate-400">
                  No {meta.header.toLowerCase()} needed for this project.
                </p>
              ) : (
                <div className="space-y-3">
                  {tierProposals.map((proposal) => {
                    const linkedFinding = findingById.get(proposal.findingId);
                    const isDiffOpen = expandedDiffIds[proposal.id] ?? false;

                    return (
                      <article
                        key={proposal.id}
                        className={`rounded-md border p-4 space-y-3 transition-colors ${
                          proposal.approved
                            ? 'border-blue-500/40 bg-[#0E131D]'
                            : 'border-slate-800 bg-[#0B0E14]'
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <label className="flex items-start gap-3 cursor-pointer flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={proposal.approved && !proposal.aiRejected}
                              disabled={Boolean(proposal.aiRejected)}
                              onChange={() => toggleProposalApproval(proposal.id)}
                              className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-600 disabled:opacity-40"
                            />
                            <div className="space-y-1.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`text-sm font-semibold ${
                                    proposal.aiRejected
                                      ? 'text-slate-500 line-through'
                                      : 'text-slate-100'
                                  }`}
                                >
                                  {proposal.title}
                                </span>
                                {proposal.aiSuggested && (
                                  <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-[11px] font-medium text-amber-200">
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
                                  <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                                    Rejected by you
                                  </span>
                                )}
                                {proposal.unverifiedPackage && (
                                  <span className="inline-flex items-center gap-1 rounded border border-rose-500/50 bg-rose-950/40 px-2 py-0.5 text-[11px] font-medium text-rose-200">
                                    <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                                    not in registry, unverified
                                  </span>
                                )}
                              </div>

                              {/* What it adds */}
                              <p className="text-xs text-slate-200">{proposal.expectedEffect}</p>

                              {proposal.securityWarnings && proposal.securityWarnings.length > 0 && (
                                <div className="rounded border border-amber-500/40 bg-amber-950/20 px-2.5 py-1.5 text-xs text-amber-200 space-y-0.5">
                                  {proposal.securityWarnings.map((warn, wIdx) => (
                                    <p key={wIdx}>Security warning: {warn}</p>
                                  ))}
                                </div>
                              )}

                              {/* One-sentence AI reason shown prominently next to AI label */}
                              {proposal.aiSuggested && (
                                <p className="text-xs text-amber-200">
                                  <strong className="font-medium">Why AI suggested this:</strong>{' '}
                                  {proposal.why}
                                </p>
                              )}

                              {/* Metadata row: linked finding, source, licence, risk tier */}
                              <dl className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-slate-400">
                                {linkedFinding && (
                                  <div className="flex gap-1">
                                    <dt className="text-slate-400">Fixes:</dt>
                                    <dd className="text-slate-200">{linkedFinding.title}</dd>
                                  </div>
                                )}
                                <div className="flex gap-1">
                                  <dt className="text-slate-400">Source:</dt>
                                  <dd className="text-slate-200">{sourceLabel(proposal)}</dd>
                                </div>
                                <div className="flex gap-1">
                                  <dt className="text-slate-400">Licence:</dt>
                                  <dd className="text-slate-200">{proposal.licence}</dd>
                                </div>
                                <div className="flex gap-1">
                                  <dt className="text-slate-400">Risk:</dt>
                                  <dd className={meta.toneClass}>{meta.badgeLabel}</dd>
                                </div>
                              </dl>

                              {/* Files touched */}
                              <div className="text-xs text-slate-400">
                                <span className="text-slate-400">Files touched: </span>
                                {proposal.filesToAddOrChange.map((fc, idx) => (
                                  <React.Fragment key={fc.path}>
                                    {idx > 0 && <span aria-hidden="true"> · </span>}
                                    <span className="font-mono text-slate-200 break-all">
                                      {fc.path} ({fc.action === 'add' ? 'add' : 'change'})
                                    </span>
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          </label>

                          <div className="flex flex-wrap items-center gap-2 self-start shrink-0">
                            {proposal.aiSuggested &&
                              (proposal.aiRejected ? (
                                <button
                                  type="button"
                                  onClick={() => restoreAiProposal(proposal.id)}
                                  className="rounded border border-slate-700 bg-transparent px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
                                >
                                  Restore AI item
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => rejectAiProposal(proposal.id)}
                                  className="rounded border border-rose-500/40 bg-transparent px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-950/30 whitespace-nowrap"
                                >
                                  Reject AI suggestion
                                </button>
                              ))}

                            <button
                              type="button"
                              aria-expanded={isDiffOpen}
                              onClick={() => toggleDiff(proposal.id)}
                              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-transparent px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
                            >
                              {isDiffOpen ? (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              )}
                              <span>{isDiffOpen ? 'Hide diff' : 'View diff'}</span>
                            </button>
                          </div>
                        </div>

                        {!proposal.aiSuggested && (
                          <p className="pl-7 text-xs text-slate-400">
                            <strong className="font-medium text-slate-300">Why:</strong>{' '}
                            {proposal.why}
                          </p>
                        )}

                        {isDiffOpen && (
                          <div className="pl-0 sm:pl-7 space-y-1">
                            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                              <span className="text-emerald-300 font-mono">+ Added line</span>
                              <span className="text-rose-300 font-mono">- Removed line</span>
                            </div>
                            <div className="overflow-x-auto rounded border border-slate-800 bg-[#090C11] py-2 font-mono text-[11px] leading-relaxed">
                              {renderUnifiedDiffLines(proposal.diffPreview)}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Quiet registry audit disclosure */}
      <section className="rounded-lg border border-slate-800 bg-[#111620] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <ShieldAlert className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            <span>
              Licence &amp; safety filter: {findingsState.eligibleRegistryIds.length} allowed ·{' '}
              {findingsState.excludedRegistryNotes.length} excluded
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowPolicyLog((v) => !v)}
            className="rounded border border-slate-700 bg-transparent px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {showPolicyLog ? 'Hide details' : 'Show excluded packages'}
          </button>
        </div>

        {showPolicyLog && (
          <div className="mt-3 max-h-56 overflow-auto border-t border-slate-800 pt-3">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="text-slate-300">
                <tr className="border-b border-slate-800">
                  <th className="py-1.5 pr-4 font-medium">Package</th>
                  <th className="py-1.5 font-medium">Reason excluded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {findingsState.excludedRegistryNotes.map((note) => (
                  <tr key={note.entryId}>
                    <td className="py-1.5 pr-4 font-mono text-slate-200 whitespace-nowrap">
                      {note.packageName}
                    </td>
                    <td className="py-1.5 text-slate-400">{note.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sticky footer bar */}
      <div className="sticky bottom-3 z-20 rounded-lg border border-slate-700 bg-[#111620]/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-200">
            <strong className="font-semibold tabular-nums">{approvedCount}</strong> change
            {approvedCount === 1 ? '' : 's'} selected
            <span className="ml-2 text-xs text-slate-400 hidden sm:inline">
              Next: confirm selection before patching
            </span>
          </div>
          <button
            type="button"
            onClick={advanceFromFindings}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap shrink-0"
          >
            <span>Apply {approvedCount} changes</span>
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
