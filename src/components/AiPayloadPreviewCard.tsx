'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, ShieldCheck, Sparkles, X } from 'lucide-react';

export interface AiPayloadPreviewCardProps {
  title: string;
  description: string;
  fileCount: number;
  strippedCount: number;
  charCount: number;
  maxChars: number;
  previewText: string;
  isLoading: boolean;
  onConfirmSend: () => void;
  onCancel?: () => void;
  sendLabel?: string;
}

export function AiPayloadPreviewCard({
  title,
  description,
  fileCount,
  strippedCount,
  charCount,
  maxChars,
  previewText,
  isLoading,
  onConfirmSend,
  onCancel,
  sendLabel = 'Send redacted summary to AI',
}: AiPayloadPreviewCardProps) {
  const [showRawPayload, setShowRawPayload] = useState(false);

  return (
    <div
      role="region"
      aria-label={title}
      className="rounded-md border border-blue-500/40 bg-[#0B0E14] p-4 space-y-3 text-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-semibold text-slate-100">
            <Eye className="h-3.5 w-3.5 text-blue-400 shrink-0" aria-hidden="true" />
            <span>{title}</span>
          </div>
          <p className="text-slate-300 leading-relaxed">{description}</p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close AI payload preview"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 shrink-0"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-2 rounded border border-slate-800 bg-[#111620] p-3 sm:grid-cols-3">
        <div>
          <dt className="text-slate-400">File excerpts included</dt>
          <dd className="mt-0.5 font-mono font-semibold text-slate-100 tabular-nums">
            {fileCount} {fileCount === 1 ? 'file' : 'files'} (inside &lt;file&gt; blocks)
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Files stripped for secrets</dt>
          <dd
            className={`mt-0.5 font-mono font-semibold tabular-nums ${
              strippedCount > 0 ? 'text-amber-300' : 'text-emerald-300'
            }`}
          >
            {strippedCount} {strippedCount === 1 ? 'file' : 'files'} excluded
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Payload size limit</dt>
          <dd className="mt-0.5 font-mono font-semibold text-slate-100 tabular-nums">
            {charCount.toLocaleString()} / {maxChars.toLocaleString()} chars
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowRawPayload((v) => !v)}
          aria-expanded={showRawPayload}
          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-transparent px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
        >
          {showRawPayload ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{showRawPayload ? 'Hide exact payload' : 'Inspect exact payload'}</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirmSend}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{isLoading ? 'Sending...' : sendLabel}</span>
          </button>
        </div>
      </div>

      {showRawPayload && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Files flagged for secrets are removed above; remaining excerpts are redacted and
              tagged as passive data.
            </span>
          </div>
          <pre className="max-h-64 overflow-auto rounded border border-slate-800 bg-[#090C11] p-3 font-mono text-[11px] leading-relaxed text-slate-200 whitespace-pre-wrap break-all">
            {previewText}
          </pre>
        </div>
      )}
    </div>
  );
}
