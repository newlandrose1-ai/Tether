'use client';

import React from 'react';
import { ArrowLeft, Layers } from 'lucide-react';
import { PIPELINE_STAGES, type PipelineStage } from '../../types/pipeline';
import { usePipelineStore } from '../../store/pipelineStore';

interface StagePlaceholderViewProps {
  stage: Exclude<PipelineStage, 'upload'>;
}

const STAGE_SPECIFICATIONS: Record<
  Exclude<PipelineStage, 'upload'>,
  {
    purpose: string;
    inputs: string[];
    rules: string[];
  }
> = {
  analyse: {
    purpose:
      'Inspects the ingested file tree and capped text files deterministically to classify the software stack, entry points, and configuration files.',
    inputs: [
      'Ingested file tree and manifest metadata from Upload & Ingest',
      'Analyzable text files with any flagged secret files scheduled for redaction before Gemini',
    ],
    rules: [
      'Deterministic detection runs first in plain TypeScript; Gemini is reserved strictly for ambiguous project judgement calls.',
      'Ignored directories (node_modules, .git, build outputs) and binary files are excluded from analysis.',
    ],
  },
  intent: {
    purpose:
      'Presents the inferred project type and proposed upgrade scope so the user explicitly locks intent before findings and proposals are generated.',
    inputs: [
      'Deterministic stack summary and optional structured Gemini intent classification',
    ],
    rules: [
      'Requires explicit user confirmation before moving into Findings and proposals.',
      'Gemini responses must conform to a strict JSON schema validated before display.',
    ],
  },
  findings: {
    purpose:
      'Lists deterministic project gaps and structured upgrade proposals grounded in the locked project intent.',
    inputs: [
      'Locked project intent and redacted text files',
    ],
    rules: [
      'Secrets flagged during Upload & Ingest are redacted before any Gemini call.',
      'Proposals are typed, file-scoped, and never touch files outside the user-approved selection.',
    ],
  },
  approve: {
    purpose:
      'Lets the user inspect exact proposed changes and toggle approval per proposal before patching.',
    inputs: [
      'Validated proposal list from Findings & proposals',
    ],
    rules: [
      'No proposal is applied automatically without explicit approval.',
    ],
  },
  apply: {
    purpose:
      'Applies approved upgrades strictly to an isolated in-memory copy of the archive.',
    inputs: [
      'Approved proposals and the untouched rawEntriesByPath copy from Upload & Ingest',
    ],
    rules: [
      'Original uploaded buffer remains untouched.',
      'Every unchanged file stays byte-identical to its input SHA-256 digest.',
    ],
  },
  verify: {
    purpose:
      'Verifies structural integrity of the patched copy and runs static checks on modified files.',
    inputs: [
      'Updated file copy and original SHA-256 manifest',
    ],
    rules: [
      'Reports explicitly which checks passed (structural, static).',
      'Explicitly states that builds and tests were not run inside the browser.',
    ],
  },
  download: {
    purpose:
      'Packages the updated copy into a downloadable .zip archive alongside a human-readable changelog and SHA-256 verification summary.',
    inputs: [
      'Verified file copy, changelog markdown, and input/output SHA-256 manifest comparison',
    ],
    rules: [
      'Every unchanged file is guaranteed byte-identical to the original upload.',
    ],
  },
};

export function StagePlaceholderView({ stage }: StagePlaceholderViewProps) {
  const ingest = usePipelineStore((s) => s.ingest);
  const goToStage = usePipelineStore((s) => s.goToStage);
  const meta = PIPELINE_STAGES.find((s) => s.id === stage)!;
  const spec = STAGE_SPECIFICATIONS[stage];

  return (
    <div className="rounded-lg border border-slate-800 bg-[#111620] p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Layers className="h-4 w-4 text-blue-400 shrink-0" aria-hidden="true" />
            <span className="font-mono tabular-nums">
              Stage {String(meta.step).padStart(2, '0')}
            </span>
            <span aria-hidden="true">·</span>
            <span>Scaffolded stage</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">{meta.label}</h1>
          <p className="max-w-2xl text-sm text-slate-400">{spec.purpose}</p>
        </div>

        <button
          type="button"
          onClick={() => goToStage('upload')}
          className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Back to Upload &amp; Ingest</span>
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-xs font-semibold text-slate-200">Stage inputs</h2>
          <ul className="mt-2.5 space-y-2 text-xs text-slate-400">
            {spec.inputs.map((item) => (
              <li key={item} className="leading-relaxed">
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-xs font-semibold text-slate-200">Stage constraints</h2>
          <ul className="mt-2.5 space-y-2 text-xs text-slate-400">
            {spec.rules.map((rule) => (
              <li key={rule} className="leading-relaxed">
                {rule}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {ingest && (
        <div className="mt-6 border-t border-slate-800 pt-5 text-xs text-slate-400">
          Shared state ready from{' '}
          <span className="font-mono text-slate-200">{ingest.archiveName}</span>
          <span aria-hidden="true" className="mx-2 text-slate-600">
            ·
          </span>
          <span className="font-mono tabular-nums">{ingest.manifest.length}</span> manifest entries
          <span aria-hidden="true" className="mx-2 text-slate-600">
            ·
          </span>
          <span className="font-mono tabular-nums">{Object.keys(ingest.textFiles).length}</span>{' '}
          analyzable text files
          <span aria-hidden="true" className="mx-2 text-slate-600">
            ·
          </span>
          <span className="font-mono tabular-nums text-amber-400">
            {ingest.flaggedPaths.length}
          </span>{' '}
          file(s) flagged redact before AI
        </div>
      )}
    </div>
  );
}
