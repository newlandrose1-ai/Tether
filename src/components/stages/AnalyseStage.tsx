'use client';

import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { usePipelineStore } from '../../store/pipelineStore';

export function AnalyseStage() {
  const ingest = usePipelineStore((s) => s.ingest);
  const analysis = usePipelineStore((s) => s.analysis);
  const runAnalysis = usePipelineStore((s) => s.runAnalysis);
  const goToStage = usePipelineStore((s) => s.goToStage);
  const advanceFromAnalyse = usePipelineStore((s) => s.advanceFromAnalyse);

  const [showDetails, setShowDetails] = useState(false);
  const [reanalyzedNote, setReanalyzedNote] = useState(false);

  const result = analysis.result;

  const handleRerun = () => {
    runAnalysis();
    setReanalyzedNote(true);
  };

  if (!ingest || !result) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-8 text-center space-y-3">
        <h1 className="text-lg font-semibold text-slate-100">Upload a project first</h1>
        <p className="text-sm text-slate-300">
          What happens next: Upload a .zip file so we can inspect its languages, tools, and setup.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => goToStage('upload')}
            className="rounded-md border border-slate-700 bg-transparent px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            Back to Upload
          </button>
          {ingest && (
            <button
              type="button"
              onClick={handleRerun}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap"
            >
              Inspect project
            </button>
          )}
        </div>
      </div>
    );
  }

  const secretCount = ingest.secretFindings.length;
  const languagesSummary =
    result.languages.length > 0
      ? result.languages.map((l) => `${l.language} (${l.percentage}%)`).join(', ')
      : 'None recognized';
  const frameworkSummary =
    result.frameworks.length > 0
      ? result.frameworks.join(', ')
      : result.bundlers.length > 0
      ? result.bundlers.join(', ')
      : 'None detected';

  const booleanChecks = [
    {
      label: 'Tests (automated checks for your code)',
      present: result.hygiene.hasTests,
      detail: result.hygiene.hasTests
        ? result.hygiene.testPaths.slice(0, 2).join(', ')
        : 'No test files found',
    },
    {
      label: 'CI (automatic checks when code is pushed)',
      present: result.hygiene.hasCI,
      detail: result.hygiene.hasCI
        ? result.hygiene.ciPaths.slice(0, 2).join(', ')
        : 'No CI workflow found',
    },
    {
      label: 'Lockfile (pins exact dependency versions)',
      present: result.hygiene.hasLockfile,
      detail: result.hygiene.hasLockfile
        ? result.hygiene.lockfilePaths.slice(0, 2).join(', ')
        : 'No dependency lockfile found',
    },
  ];

  return (
    <div className="space-y-6">
      {/* 3-part stage header */}
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Analyse project setup
            </h1>
            <p className="text-sm text-slate-300">
              <strong className="font-medium text-slate-100">What happens next:</strong> We use
              these facts to guess your project type so you can confirm it in the next step.
            </p>
            {reanalyzedNote && (
              <p role="status" className="text-xs text-emerald-300">
                Analysis refreshed from your uploaded files.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => goToStage('upload')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={handleRerun}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Re-analyse</span>
            </button>
            <button
              type="button"
              onClick={advanceFromAnalyse}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap"
            >
              <span>Continue to Confirm type</span>
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {result.analyzableFileCount === 0 && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-100"
        >
          No readable source or config files were found (only binary or unwanted files). You can
          still continue, or go back to Upload and choose a different .zip.
        </div>
      )}

      {/* Main summary card */}
      <section
        aria-label="Project summary"
        className="rounded-lg border border-slate-800 bg-[#111620] p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <h2 className="text-base font-semibold text-slate-100">Project summary</h2>
          <span className="text-xs text-slate-400 font-mono tabular-nums">
            {result.analyzableFileCount} readable files inspected
          </span>
        </div>

        <dl className="divide-y divide-slate-800/80 text-sm">
          <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-slate-400">Languages</dt>
            <dd className="font-medium text-slate-100 sm:text-right">{languagesSummary}</dd>
          </div>

          <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-slate-400">Framework &amp; tools</dt>
            <dd className="font-medium text-slate-100 sm:text-right">{frameworkSummary}</dd>
          </div>

          {booleanChecks.map((item) => (
            <div
              key={item.label}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <dt className="text-slate-400">{item.label}</dt>
              <dd className="flex items-center gap-2 sm:justify-end">
                {item.present ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
                ) : (
                  <XCircle className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                )}
                <span
                  className={`font-semibold ${
                    item.present ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                >
                  {item.present ? 'Yes' : 'No'}
                </span>
                <span className="font-mono text-xs text-slate-400">({item.detail})</span>
              </dd>
            </div>
          ))}

          <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-slate-400">Secrets found</dt>
            <dd className="flex items-center gap-2 sm:justify-end">
              {secretCount > 0 ? (
                <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
              )}
              <span
                className={`font-semibold tabular-nums ${
                  secretCount > 0 ? 'text-amber-300' : 'text-emerald-300'
                }`}
              >
                {secretCount > 0 ? `${secretCount} found (hidden from AI)` : '0 found'}
              </span>
            </dd>
          </div>
        </dl>

        {/* Secrets listed by file and line only */}
        {secretCount > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-950/25 p-4 space-y-2.5">
            <div className="flex items-start gap-2.5 text-xs text-amber-100">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  These were hidden from the AI and will never be sent.
                </p>
                <p className="mt-0.5 text-amber-200/90">
                  Only the file name and line number are shown below; raw secret values stay masked.
                </p>
              </div>
            </div>
            <ul className="space-y-1 pl-6 font-mono text-xs text-amber-200">
              {ingest.secretFindings.map((finding) => (
                <li key={finding.id} className="break-all">
                  {finding.path} — line {finding.line} ({finding.label})
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.detectedInstallScripts.length > 0 && (
          <div
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-950/25 p-4 space-y-2"
          >
            <div className="flex items-start gap-2.5 text-xs text-amber-100">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  Install scripts detected in uploaded package.json (review before running install)
                </p>
                <p className="mt-0.5 text-amber-200/90">
                  Lifecycle scripts such as preinstall, install, or postinstall run shell commands
                  automatically on npm/pnpm/yarn install. Zip Upgrader never adds or executes them.
                </p>
              </div>
            </div>
            <ul className="space-y-1 pl-6 font-mono text-xs text-amber-200">
              {result.detectedInstallScripts.map((script, idx) => (
                <li key={`${script.file}:${script.scriptName}:${idx}`} className="break-all">
                  {script.file} → &ldquo;{script.scriptName}&rdquo;: {script.command}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Quiet collapsible technical details */}
      <section className="rounded-lg border border-slate-800 bg-[#111620]">
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left text-xs font-medium text-slate-300 hover:text-slate-100"
        >
          <span>
            Inspect detected packages ({result.dependencies.length}) &amp; entry files (
            {result.entryPoints.length})
          </span>
          {showDetails ? (
            <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          )}
        </button>

        {showDetails && (
          <div className="border-t border-slate-800 px-5 py-4 space-y-5 text-xs">
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-200">Entry &amp; config files</h3>
              {result.entryPoints.length === 0 && result.configFiles.length === 0 ? (
                <p className="text-slate-400">No standard entry or config files detected.</p>
              ) : (
                <ul className="space-y-1 font-mono text-slate-300">
                  {[...result.entryPoints, ...result.configFiles].map((item) => (
                    <li key={item} className="break-all">
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-slate-200">
                Packages ({result.dependencies.length})
              </h3>
              {result.dependencies.length === 0 ? (
                <p className="text-slate-400">No package dependency files found.</p>
              ) : (
                <div className="max-h-60 overflow-auto rounded border border-slate-800">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-[#161C28] text-slate-300">
                      <tr className="border-b border-slate-800">
                        <th className="px-3 py-2 font-medium">Package</th>
                        <th className="px-3 py-2 font-medium">Version</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {result.dependencies.map((dep, idx) => (
                        <tr key={`${dep.sourceFile}:${dep.name}:${dep.scope}:${idx}`}>
                          <td className="px-3 py-2 font-mono text-slate-100">{dep.name}</td>
                          <td className="px-3 py-2 font-mono tabular-nums text-slate-300">
                            {dep.version}
                          </td>
                          <td className="px-3 py-2 text-slate-400">{dep.scope}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
