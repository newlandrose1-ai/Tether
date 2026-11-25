'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Lock,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import {
  getIntentAiPreview,
  getLoadedModifiers,
  getLoadedProfiles,
} from '../../lib/intentClassifier';
import { usePipelineStore } from '../../store/pipelineStore';
import type { ProfileEvidenceItem, ProfileId, RankedProfileScore } from '../../types/pipeline';
import { AiPayloadPreviewCard } from '../AiPayloadPreviewCard';

function formatEvidenceLines(ranked: RankedProfileScore): string[] {
  const lines: string[] = [];
  for (const ev of ranked.evidence) {
    if (ev.weightAwarded <= 0 && ev.matchedItems.length === 0) continue;
    lines.push(formatSingleEvidence(ev));
  }
  if (lines.length === 0) {
    lines.push('No strong matching signals were detected for this project type.');
  }
  return lines;
}

function formatSingleEvidence(ev: ProfileEvidenceItem): string {
  const items = ev.matchedItems.slice(0, 3).join(', ');
  switch (ev.signal) {
    case 'dependencies':
      return items ? `Found ${items} in your package dependencies` : ev.summary;
    case 'entry_points':
      return items ? `Found entry file(s): ${items}` : ev.summary;
    case 'config_files':
      return items ? `Found config file(s): ${items}` : ev.summary;
    case 'asset_types':
      return items ? `Found project assets (${items})` : ev.summary;
    case 'code_patterns':
      return items ? `Detected code patterns: ${items}` : ev.summary;
    case 'readme':
      return items ? `README keywords matched: ${items}` : ev.summary;
  }
}

export function IntentLockStage() {
  const intent = usePipelineStore((s) => s.intent);
  const analysis = usePipelineStore((s) => s.analysis);
  const ingest = usePipelineStore((s) => s.ingest);
  const aiEnabled = usePipelineStore((s) => s.aiEnabled);
  const goToStage = usePipelineStore((s) => s.goToStage);
  const lockIntent = usePipelineStore((s) => s.lockIntent);
  const toggleIntentModifier = usePipelineStore((s) => s.toggleIntentModifier);
  const requestGeminiIntentAdvice = usePipelineStore((s) => s.requestGeminiIntentAdvice);
  const rejectGeminiIntentAdvice = usePipelineStore((s) => s.rejectGeminiIntentAdvice);
  const repivotToSuggestedProfile = usePipelineStore((s) => s.repivotToSuggestedProfile);
  const dismissContradiction = usePipelineStore((s) => s.dismissContradiction);
  const advanceFromIntent = usePipelineStore((s) => s.advanceFromIntent);

  const [showChangeType, setShowChangeType] = useState(false);
  const [showAiPreview, setShowAiPreview] = useState(false);

  const profiles = getLoadedProfiles();
  const modifiers = getLoadedModifiers();

  if (!ingest || intent.rankedProfiles.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-8 text-center space-y-3">
        <h1 className="text-lg font-semibold text-slate-100">Analyse your project first</h1>
        <p className="text-sm text-slate-300">
          What happens next: Run the Analyse step so we can identify your project type from your
          files.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => goToStage('analyse')}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap"
          >
            Go to Analyse
          </button>
        </div>
      </div>
    );
  }

  const topScore = intent.rankedProfiles[0];
  const activeProfileId: ProfileId =
    intent.projectKind ??
    intent.geminiAdvice?.recommendedProfileId ??
    topScore.profileId;
  const activeScore =
    intent.rankedProfiles.find((r) => r.profileId === activeProfileId) ?? topScore;
  const runnerUpScore =
    intent.rankedProfiles.find((r) => r.profileId !== activeScore.profileId) ?? null;

  const topEvidenceLines = formatEvidenceLines(activeScore);

  const handleConfirmPrimary = () => {
    if (intent.status !== 'locked' || intent.projectKind !== activeScore.profileId) {
      lockIntent(
        activeScore.profileId,
        intent.modifiers,
        intent.geminiAdvice?.recommendedProfileId === activeScore.profileId
          ? 'gemini-confirmed'
          : 'user-override'
      );
    }
    advanceFromIntent();
  };

  return (
    <div className="space-y-6">
      {/* Contradiction banner if locked type disagrees with updated signals */}
      {intent.contradiction && !intent.contradiction.dismissed && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/50 bg-amber-950/25 p-4 space-y-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-400 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-amber-100">
                Your files look closer to another project type
              </h2>
              <p className="text-xs text-amber-200">{intent.contradiction.reason}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-8">
            <button
              type="button"
              onClick={repivotToSuggestedProfile}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 whitespace-nowrap"
            >
              Switch to{' '}
              {profiles.find((p) => p.id === intent.contradiction?.suggestedProfileId)?.name}
            </button>
            <button
              type="button"
              onClick={dismissContradiction}
              className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/40 whitespace-nowrap"
            >
              Keep current choice
            </button>
          </div>
        </div>
      )}

      {/* 3-part stage header */}
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Confirm your project type
            </h1>
            <p className="text-sm text-slate-300">
              <strong className="font-medium text-slate-100">What happens next:</strong> Locking
              this type keeps all gap checks and upgrade suggestions matched to your app for this
              session.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => goToStage('analyse')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={() => setShowChangeType((v) => !v)}
              className="rounded-md border border-slate-700 bg-transparent px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800/70 whitespace-nowrap"
            >
              {showChangeType ? 'Close choices' : 'Change type'}
            </button>
            <button
              type="button"
              onClick={handleConfirmPrimary}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap"
            >
              <span>Yes, that&rsquo;s right</span>
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Top guess card */}
      <section
        aria-label="Best matching project type"
        className="rounded-lg border border-blue-500/40 bg-[#111620] p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-blue-300">
              {intent.status === 'locked' ? (
                <Lock className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-blue-400 shrink-0" aria-hidden="true" />
              )}
              <span>
                {intent.status === 'locked'
                  ? 'Top guess · Locked for this session'
                  : 'Top guess · Needs your confirmation'}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-slate-100">{activeScore.name}</h2>
            <p className="text-xs text-slate-300">{activeScore.description}</p>
          </div>

          <div className="text-left sm:text-right shrink-0">
            <div className="text-xs text-slate-400">Match confidence</div>
            <div className="font-mono text-lg font-bold tabular-nums text-slate-100">
              {activeScore.confidence}%
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        <div
          role="progressbar"
          aria-label={`Confidence ${activeScore.confidence}%`}
          aria-valuenow={activeScore.confidence}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-full bg-slate-800"
        >
          <div
            className="h-full rounded-full bg-blue-500"
            style={{ width: `${Math.max(4, activeScore.confidence)}%` }}
          />
        </div>

        {/* Evidence short list */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-200">Why we think so:</p>
          <ul className="space-y-1 text-xs text-slate-300">
            {topEvidenceLines.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <CheckCircle2
                  className="mt-0.5 h-3.5 w-3.5 text-emerald-400 shrink-0"
                  aria-hidden="true"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Hybrid modifiers as removable chips */}
        <div className="border-t border-slate-800 pt-4 space-y-2.5">
          <div>
            <p className="text-xs font-semibold text-slate-200">
              Extra features (hybrid modifiers)
            </p>
            <p className="text-xs text-slate-400">
              Include or remove add-on targets such as offline PWA support.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {modifiers.map((mod) => {
              const active = intent.modifiers.includes(mod.id);
              return (
                <button
                  key={mod.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleIntentModifier(mod.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'border-blue-500 bg-blue-600/20 text-slate-100'
                      : 'border-slate-700 bg-[#0B0E14] text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {active ? (
                    <X className="h-3.5 w-3.5 text-blue-300 shrink-0" aria-hidden="true" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                  )}
                  <span>{mod.name}</span>
                  <span className="text-[11px] text-slate-400">
                    ({active ? 'Added · click to remove' : 'Add'})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Smaller runner-up card */}
      {runnerUpScore && (
        <section
          aria-label="Runner-up project type"
          className="rounded-lg border border-slate-800 bg-[#111620] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">Runner-up:</span>
              <span className="font-semibold text-slate-200">{runnerUpScore.name}</span>
              <span className="font-mono tabular-nums text-slate-400">
                ({runnerUpScore.confidence}%)
              </span>
            </div>
            <p className="text-xs text-slate-400">{formatEvidenceLines(runnerUpScore)[0]}</p>
          </div>
          <button
            type="button"
            onClick={() => lockIntent(runnerUpScore.profileId, intent.modifiers, 'user-override')}
            className="self-start sm:self-center rounded-md border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800/70 whitespace-nowrap shrink-0"
          >
            Use this instead
          </button>
        </section>
      )}

      {/* Manual profile picker & optional Gemini tie-breaker */}
      {(showChangeType || intent.status !== 'locked') && (
        <section className="rounded-lg border border-slate-800 bg-[#111620] p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Choose a project type</h2>
              <p className="text-xs text-slate-400">
                Inspect the exact redacted summary before anything leaves your browser.
              </p>
            </div>
            <button
              type="button"
              disabled={intent.geminiStatus === 'loading'}
              onClick={() => {
                if (!aiEnabled) {
                  void requestGeminiIntentAdvice();
                } else {
                  setShowAiPreview((v) => !v);
                }
              }}
              className="self-start sm:self-center rounded-md border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800/70 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {!aiEnabled
                ? 'AI help is Off'
                : intent.geminiStatus === 'loading'
                ? 'Asking AI...'
                : showAiPreview
                ? 'Hide AI preview'
                : 'Ask AI to help decide'}
            </button>
          </div>

          {showAiPreview && aiEnabled && analysis.result && (() => {
            const preview = getIntentAiPreview(
              ingest,
              analysis.result,
              intent.rankedProfiles,
              intent.suggestedModifiers
            );
            return (
              <AiPayloadPreviewCard
                title={`What will be sent to AI (${preview.promptVersion})`}
                description="Review the exact redacted project structure and prioritized <file> chunks before sending."
                fileCount={preview.fileCount}
                strippedCount={preview.strippedCount}
                charCount={preview.charCount}
                maxChars={preview.maxChars}
                previewText={preview.previewText}
                isLoading={intent.geminiStatus === 'loading'}
                onCancel={() => setShowAiPreview(false)}
                onConfirmSend={() => {
                  setShowAiPreview(false);
                  void requestGeminiIntentAdvice();
                }}
              />
            );
          })()}

          {intent.geminiStatus === 'loading' && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border border-blue-500/40 bg-blue-950/20 px-4 py-3 text-xs text-blue-100"
            >
              Asking Gemini to review prioritized file chunks (secrets stripped &amp; redacted)...
            </div>
          )}

          {intent.geminiStatus === 'skipped' && intent.geminiSkipReason && (
            <div
              role="status"
              className="rounded-md border border-slate-700 bg-[#0B0E14] p-3.5 text-xs text-slate-200 space-y-1"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                  Skipped
                </span>
                <span className="font-semibold text-slate-100">
                  AI classification skipped — deterministic scoring used
                </span>
                {intent.geminiPromptVersion && (
                  <span className="font-mono text-[11px] text-slate-400">
                    ({intent.geminiPromptVersion})
                  </span>
                )}
              </div>
              <p className="text-slate-300">{intent.geminiSkipReason}</p>
            </div>
          )}

          {intent.geminiStatus === 'ready' && intent.geminiAdvice && (
            <div className="rounded-md border border-blue-500/40 bg-blue-950/20 p-4 text-xs space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-blue-100">
                    AI suggestion:{' '}
                    {profiles.find((p) => p.id === intent.geminiAdvice?.recommendedProfileId)?.name}
                  </span>
                  {intent.geminiAdvice.promptVersion && (
                    <span className="rounded border border-blue-500/30 bg-blue-950/40 px-2 py-0.5 font-mono text-[11px] text-blue-200">
                      {intent.geminiAdvice.promptVersion}
                    </span>
                  )}
                  {intent.geminiCacheHit && (
                    <span className="rounded border border-emerald-500/40 bg-emerald-950/30 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                      Cached by file hash
                    </span>
                  )}
                  {intent.geminiRejected && (
                    <span className="rounded border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                      Rejected by you
                    </span>
                  )}
                </div>
                <span className="font-mono tabular-nums text-blue-300">
                  {intent.geminiAdvice.confidence}% confidence
                </span>
              </div>
              <p className="text-slate-200 leading-relaxed">{intent.geminiAdvice.reasoning}</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    lockIntent(
                      intent.geminiAdvice!.recommendedProfileId,
                      intent.modifiers,
                      'gemini-confirmed'
                    );
                    setShowChangeType(false);
                  }}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap"
                >
                  Use AI suggestion
                </button>
                {!intent.geminiRejected && (
                  <button
                    type="button"
                    onClick={rejectGeminiIntentAdvice}
                    className="rounded-md border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
                  >
                    Reject AI suggestion
                  </button>
                )}
              </div>
            </div>
          )}

          {intent.geminiStatus === 'error' && intent.geminiError && (
            <div className="rounded-md border border-amber-500/40 bg-amber-950/20 p-3.5 text-xs text-amber-200">
              AI suggestion skipped ({intent.geminiError}). Pick a project type below.
            </div>
          )}

          <div className="space-y-2.5">
            {profiles.map((p) => {
              const score = intent.rankedProfiles.find((r) => r.profileId === p.id);
              const isCurrent = intent.status === 'locked' && intent.projectKind === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    lockIntent(p.id as ProfileId, intent.modifiers, 'user-override');
                    setShowChangeType(false);
                  }}
                  className={`flex w-full items-center justify-between gap-4 rounded-md border p-4 text-left transition-colors ${
                    isCurrent
                      ? 'border-blue-500 bg-blue-600/15'
                      : 'border-slate-800 bg-[#0B0E14] hover:border-slate-600'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-100">{p.name}</span>
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">{p.description}</p>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-slate-300 shrink-0">
                    {score?.confidence ?? 0}%
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
