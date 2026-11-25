'use client';

import React from 'react';
import { Archive } from 'lucide-react';
import type { SkippedEntry } from '../../types/pipeline';

interface SkippedListViewProps {
  skipped: SkippedEntry[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function categoryPlainLabel(cat: SkippedEntry['category']): string {
  switch (cat) {
    case 'ignored-dir':
      return 'Unwanted folder';
    case 'build-output':
      return 'Build output';
    case 'binary':
      return 'Binary file';
    case 'nested-archive':
      return 'Nested zip';
    case 'huge-file':
      return 'Huge file (>5 MB)';
    case 'text-cap':
      return 'Large text file';
  }
}

export function SkippedListView({ skipped }: SkippedListViewProps) {
  if (skipped.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111620] px-6 py-10 text-center">
        <Archive className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" />
        <h3 className="mt-3 text-sm font-semibold text-slate-100">No unwanted or skipped files</h3>
        <p className="mx-auto mt-1.5 max-w-lg text-xs text-slate-300">
          Every file in this archive is readable text under the size cap.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#111620]">
      <div className="border-b border-slate-800 px-4 py-3 text-xs text-slate-300">
        Unwanted files (like dependencies, git history, binaries, and build output) are skipped
        during analysis but kept unchanged in your final zip.
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-[#161C28] text-slate-300">
            <tr className="border-b border-slate-800">
              <th className="px-4 py-2.5 font-medium">File</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 text-right font-medium">Size</th>
              <th className="px-4 py-2.5 font-medium">Why skipped</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {skipped.map((item) => (
              <tr key={`${item.category}:${item.path}`} className="hover:bg-slate-800/35">
                <td className="max-w-[240px] truncate px-4 py-2.5 font-mono text-slate-100">
                  {item.path}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-300">
                  {categoryPlainLabel(item.category)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                  {formatBytes(item.size)}
                </td>
                <td className="px-4 py-2.5 text-slate-300">{item.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
