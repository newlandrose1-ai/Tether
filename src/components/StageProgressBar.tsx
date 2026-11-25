'use client';

import React from 'react';
import { Check, CircleDot, Lock } from 'lucide-react';
import { PIPELINE_STAGES, type PipelineStage } from '../types/pipeline';

interface StageProgressBarProps {
  currentStage: PipelineStage;
  highestUnlockedStage: PipelineStage;
  completedStages: PipelineStage[];
  onSelectStage: (stage: PipelineStage) => void;
}

interface VisualStep {
  key: string;
  stepNumber: number;
  label: string;
  targetStage: PipelineStage;
  matchesStages: PipelineStage[];
}

const VISUAL_STEPS: readonly VisualStep[] = [
  { key: 'upload', stepNumber: 1, label: 'Upload', targetStage: 'upload', matchesStages: ['upload'] },
  { key: 'analyse', stepNumber: 2, label: 'Analyse', targetStage: 'analyse', matchesStages: ['analyse'] },
  { key: 'intent', stepNumber: 3, label: 'Confirm type', targetStage: 'intent', matchesStages: ['intent'] },
  { key: 'findings', stepNumber: 4, label: 'Review', targetStage: 'findings', matchesStages: ['findings'] },
  { key: 'approve', stepNumber: 5, label: 'Approve', targetStage: 'approve', matchesStages: ['approve'] },
  { key: 'apply', stepNumber: 6, label: 'Apply', targetStage: 'apply', matchesStages: ['apply'] },
  {
    key: 'download',
    stepNumber: 7,
    label: 'Download',
    targetStage: 'verify',
    matchesStages: ['verify', 'download'],
  },
];

export function StageProgressBar({
  currentStage,
  highestUnlockedStage,
  completedStages,
  onSelectStage,
}: StageProgressBarProps) {
  const highestIdx = PIPELINE_STAGES.findIndex((s) => s.id === highestUnlockedStage);
  const completedSet = new Set(completedStages);
  const currentVisualIdx = VISUAL_STEPS.findIndex((step) =>
    step.matchesStages.includes(currentStage)
  );
  const activeStepNumber = currentVisualIdx >= 0 ? currentVisualIdx + 1 : 1;

  return (
    <section
      aria-label="Upgrade progress"
      className="border-b border-slate-800 bg-[#0E131C]"
    >
      <div className="mx-auto max-w-4xl px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
          <span>
            Step <span className="font-mono font-semibold tabular-nums">{activeStepNumber}</span>{' '}
            of <span className="font-mono font-semibold tabular-nums">{VISUAL_STEPS.length}</span>:{' '}
            <strong className="font-semibold text-slate-100">
              {VISUAL_STEPS[currentVisualIdx]?.label ?? 'Upload'}
            </strong>
          </span>
          <span className="text-slate-400 hidden sm:inline">
            Completed steps can be revisited anytime
          </span>
        </div>

        <nav aria-label="Pipeline steps" className="overflow-x-auto pb-1">
          <ol className="flex items-stretch gap-1.5 min-w-max">
            {VISUAL_STEPS.map((step) => {
              const isCurrent = step.matchesStages.includes(currentStage);
              const isDone =
                !isCurrent &&
                (step.key === 'download'
                  ? completedSet.has('verify') && completedSet.has('download')
                  : completedSet.has(step.targetStage));

              const stepMinInternalIdx = Math.min(
                ...step.matchesStages.map((s) => PIPELINE_STAGES.findIndex((p) => p.id === s))
              );
              const isUnlocked = stepMinInternalIdx <= highestIdx;
              const targetToSelect: PipelineStage =
                step.key === 'download' && completedSet.has('verify')
                  ? 'download'
                  : step.targetStage;

              const statusText = isCurrent ? 'Current' : isDone ? 'Done' : isUnlocked ? 'Ready' : 'Upcoming';
              const canClick = isUnlocked && !isCurrent;

              return (
                <li key={step.key} className="flex items-center">
                  <button
                    type="button"
                    disabled={!isUnlocked}
                    aria-current={isCurrent ? 'step' : undefined}
                    aria-label={`Step ${step.stepNumber}: ${step.label} (${statusText})`}
                    onClick={() => {
                      if (canClick) onSelectStage(targetToSelect);
                    }}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors whitespace-nowrap shrink-0 ${
                      isCurrent
                        ? 'border-blue-500 bg-blue-600/20 text-slate-100'
                        : isDone
                        ? 'border-emerald-600/40 bg-[#111620] text-slate-200 hover:border-slate-500 hover:bg-slate-800/70'
                        : isUnlocked
                        ? 'border-slate-700 bg-[#111620] text-slate-200 hover:border-slate-500 hover:bg-slate-800/70'
                        : 'cursor-not-allowed border-slate-800/70 bg-transparent text-slate-400 opacity-65'
                    }`}
                  >
                    <span className="shrink-0" aria-hidden="true">
                      {isDone ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : isCurrent ? (
                        <CircleDot className="h-3.5 w-3.5 text-blue-400" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 text-slate-400" />
                      )}
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="font-semibold">
                        {step.stepNumber}. {step.label}
                      </span>
                      <span
                        className={`text-[10px] font-medium ${
                          isCurrent
                            ? 'text-blue-300'
                            : isDone
                            ? 'text-emerald-300'
                            : 'text-slate-400'
                        }`}
                      >
                        {statusText}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </section>
  );
}
