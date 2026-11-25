'use client';

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { ManifestEntry } from '../../types/pipeline';

interface ManifestTableViewProps {
  manifest: ManifestEntry[];
  flaggedPaths: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function statusPlainLabel(status: ManifestEntry['analysisStatus']): string {
  switch (status) {
    case 'analyzable':
      return 'Readable';
    case 'ignored-dir':
      return 'Unwanted folder';
    case 'build-output':
      return 'Build output';
    case 'binary':
      return 'Binary';
    case 'nested-archive':
      return 'Nested zip';
    case 'huge-file':
      return 'Huge file skipped';
    case 'text-capped':
      return 'Large text';
  }
}

export function ManifestTableView({ manifest, flaggedPaths }: ManifestTableViewProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'analyzable' | 'retained-only' | 'flagged'>('all');
  const flaggedSet = useMemo(() => new Set(flaggedPaths), [flaggedPaths]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return manifest.filter((entry) => {
      if (scope === 'analyzable' && entry.isIgnoredForAnalysis) return false;
      if (scope === 'retained-only' && !entry.isIgnoredForAnalysis) return false;
      if (scope === 'flagged' && !flaggedSet.has(entry.path)) return false;
      if (!q) return true;
      return entry.path.toLowerCase().includes(q) || entry.sha256.toLowerCase().includes(q);
    });
  }, [manifest, query, scope, flaggedSet]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#111620]">
      <div className="border-b border-slate-800 px-4 py-3 text-xs text-slate-300">
        Every file receives a <strong className="text-slate-100">SHA-256 fingerprint</strong> — a
        fingerprint used to prove untouched files are unchanged in the final download.
      </div>

      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative flex flex-1 items-center">
          <span className="sr-only">Search files or fingerprints</span>
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search file path or fingerprint..."
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-400"
          />
        </label>

        <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-800 bg-[#0B0E14] p-1">
          {(
            [
              { id: 'all', label: `All (${manifest.length})` },
              { id: 'analyzable', label: 'Readable' },
              { id: 'retained-only', label: 'Unwanted / Binary' },
              { id: 'flagged', label: `Hidden (${flaggedPaths.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScope(tab.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                scope === tab.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[400px] overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-[#161C28] text-slate-300">
            <tr className="border-b border-slate-800">
              <th className="px-4 py-2.5 font-medium">File</th>
              <th className="px-3 py-2.5 font-medium">Handling</th>
              <th className="px-3 py-2.5 text-right font-medium">Size</th>
              <th className="px-4 py-2.5 font-medium">Fingerprint (SHA-256)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  No files match the current filter.
                </td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr key={entry.path} className="hover:bg-slate-800/35">
                  <td className="max-w-[240px] truncate px-4 py-2.5 font-mono text-slate-100">
                    {entry.path}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-300">
                    {flaggedSet.has(entry.path) ? (
                      <span className="text-amber-300 font-medium">Hidden from AI</span>
                    ) : (
                      <span>{statusPlainLabel(entry.analysisStatus)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                    {formatBytes(entry.size)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">
                    {entry.sha256}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
