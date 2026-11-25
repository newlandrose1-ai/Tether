'use client';

import React from 'react';
import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { SecretFinding } from '../../types/pipeline';

interface SecretFindingsViewProps {
  findings: SecretFinding[];
  flaggedPaths: string[];
}

export function SecretFindingsView({ findings, flaggedPaths }: SecretFindingsViewProps) {
  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111620] px-6 py-10 text-center">
        <ShieldCheck className="mx-auto h-7 w-7 text-emerald-400" aria-hidden="true" />
        <h3 className="mt-3 text-sm font-semibold text-slate-100">
          No secrets or API keys found
        </h3>
        <p className="mx-auto mt-1.5 max-w-lg text-xs text-slate-300">
          We scanned your environment, config, and source files locally in your browser and found
          nothing sensitive.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-xs text-amber-100">
        <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold tabular-nums">{findings.length}</strong> possible secret(s)
          found across <strong className="font-semibold tabular-nums">{flaggedPaths.length}</strong>{' '}
          file(s). These are masked here and <strong className="font-semibold">hidden from the AI</strong>.
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#111620]">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-[#161C28] text-slate-300">
              <tr className="border-b border-slate-800">
                <th className="px-4 py-2.5 font-medium">File</th>
                <th className="px-3 py-2.5 text-right font-medium">Line</th>
                <th className="px-3 py-2.5 font-medium">Risk level</th>
                <th className="px-3 py-2.5 font-medium">What was detected</th>
                <th className="px-4 py-2.5 font-medium">AI handling</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {findings.map((finding) => (
                <tr key={finding.id} className="hover:bg-slate-800/35">
                  <td className="max-w-[240px] truncate px-4 py-2.5 font-mono text-slate-100">
                    {finding.path}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                    Line {finding.line}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        finding.severity === 'high' ? 'text-red-300' : 'text-amber-300'
                      }`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {finding.severity === 'high' ? 'High risk' : 'Medium risk'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-300">{finding.label}</td>
                  <td className="px-4 py-2.5 font-medium text-amber-300 whitespace-nowrap">
                    Hidden from AI
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
