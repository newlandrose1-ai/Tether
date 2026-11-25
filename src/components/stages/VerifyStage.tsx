'use client';

import React, { useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileDiff,
  FileText,
  Loader2,
  Scale,
  X,
  XCircle,
} from 'lucide-react';
import { usePipelineStore } from '../../store/pipelineStore';
import type { VerificationCheckDetail } from '../../types/pipeline';

type PreviewTab = 'changelog' | 'diff' | 'notice' | 'report';

function getPlainCheckTitle(chk: VerificationCheckDetail): string {
  switch (chk.id) {
    case 'structural-zip-open':
      return 'Output zip opens and has all expected files';
    case 'structural-sha256-manifest':
      return 'Untouched files match original SHA-256 fingerprints';
    case 'structural-exec-permissions':
      return 'Script run permissions are preserved';
    case 'static-json-parse':
      return 'JSON config files are valid';
    case 'static-jsts-parse':
      return 'JavaScript and TypeScript files have valid syntax';
    case 'static-dependencies':
      return 'No duplicate or conflicting packages in package.json';
    case 'static-import-resolution':
      return 'File imports point to real files or listed packages';
    case 'secret-rescan-output':
      return 'No new secrets introduced in output files';
    default:
      return chk.label;
  }
}

function triggerBrowserDownload(filename: string, content: BlobPart, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function VerifyStage() {
  const ingest = usePipelineStore((s) => s.ingest);
  const analysis = usePipelineStore((s) => s.analysis);
  const aiUsageLog = usePipelineStore((s) => s.aiUsageLog);
  const verify = usePipelineStore((s) => s.verify);
  const download = usePipelineStore((s) => s.download);
  const isVerifying = usePipelineStore((s) => s.isVerifying);
  const verifyProgress = usePipelineStore((s) => s.verifyProgress);
  const executeVerifyStage = usePipelineStore((s) => s.executeVerifyStage);
  const cancelActiveOperation = usePipelineStore((s) => s.cancelActiveOperation);
  const goToStage = usePipelineStore((s) => s.goToStage);

  const [activeTab, setActiveTab] = useState<PreviewTab>('changelog');

  if (!ingest || verify.status !== 'complete' || !verify.outputZipBytes) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-8 text-center space-y-4">
        <h1 className="text-lg font-semibold text-slate-100">Verify and prepare your download</h1>
        <p className="text-sm text-slate-300">
          What happens next: We check file fingerprints (SHA-256 — used to prove untouched files are
          unchanged) and syntax, then build your downloadable .zip.
        </p>

        {isVerifying && (
          <div className="mx-auto max-w-lg space-y-2.5 rounded-md border border-blue-500/40 bg-[#0B0E14] p-4 text-left text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-100">
                {verifyProgress?.label ?? 'Verifying archive...'}
              </span>
              <span className="font-mono font-semibold tabular-nums text-blue-300">
                {verifyProgress?.percent ?? 0}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Verification progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={verifyProgress?.percent ?? 0}
              className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
            >
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-150"
                style={{ width: `${Math.max(4, verifyProgress?.percent ?? 4)}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
          <button
            type="button"
            disabled={isVerifying}
            onClick={() => void executeVerifyStage()}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 whitespace-nowrap"
          >
            {isVerifying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
                <span>Checking integrity &amp; building .zip...</span>
              </>
            ) : (
              <span>Run verification &amp; build .zip</span>
            )}
          </button>
          {isVerifying && (
            <button
              type="button"
              onClick={cancelActiveOperation}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
            >
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Cancel</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const archiveFilename = download.outputArchiveName ?? 'upgraded-project.zip';
  const stem = archiveFilename.replace(/\.zip$/i, '');
  const diffFilename = `${stem}.patch`;

  const allChecksPassed =
    verify.structuralPassed === true &&
    verify.staticPassed === true &&
    verify.secretScanPassed === true;

  const handleDownloadZip = () => {
    if (!verify.outputZipBytes) return;
    const copyBytes = new Uint8Array(verify.outputZipBytes.byteLength);
    copyBytes.set(verify.outputZipBytes);
    triggerBrowserDownload(archiveFilename, copyBytes.buffer, 'application/zip');
  };

  const handleDownloadChangelog = () => {
    triggerBrowserDownload(
      'CHANGELOG.md',
      download.changelogMarkdown ?? '',
      'text/markdown;charset=utf-8'
    );
  };

  const handleDownloadDiff = () => {
    triggerBrowserDownload(
      diffFilename,
      download.unifiedPatchDiff ?? '',
      'text/x-diff;charset=utf-8'
    );
  };

  const handleDownloadNotice = () => {
    triggerBrowserDownload(
      'NOTICE.md',
      download.noticeMarkdown ?? '',
      'text/markdown;charset=utf-8'
    );
  };

  const tabContent: Record<PreviewTab, string> = {
    changelog: download.changelogMarkdown ?? '',
    diff: download.unifiedPatchDiff ?? '',
    notice: download.noticeMarkdown ?? '',
    report: download.beforeAfterReportMarkdown ?? '',
  };

  return (
    <div className="space-y-6">
      {/* 3-part stage header with primary Updated zip CTA */}
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Verify and download
            </h1>
            <p className="text-sm text-slate-300">
              <strong className="font-medium text-slate-100">What happens next:</strong> Download
              your updated .zip archive, then run your project&rsquo;s build and tests locally.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => goToStage('apply')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Back to Apply</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadZip}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Updated zip</span>
            </button>
          </div>
        </div>
      </div>

      {!allChecksPassed && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-500/50 bg-red-950/30 px-4 py-3 text-xs text-red-100"
        >
          <AlertOctagon className="mt-0.5 h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">Some verification checks failed.</strong> Inspect the
            checks marked Fail below before using the downloaded archive.
          </span>
        </div>
      )}

      {/* Exact honest wording + plain-language summary + 4 download actions */}
      <section
        aria-label="Download artifacts"
        className="rounded-lg border border-slate-700 bg-[#111620] p-5 space-y-4"
      >
        <div className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-xs font-medium text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
          <span>Checked: file integrity and syntax. Not checked: build and tests.</span>
        </div>

        {analysis.result && analysis.result.detectedInstallScripts.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-xs text-amber-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">Warning:</strong> Original package.json defines{' '}
              {analysis.result.detectedInstallScripts
                .map((s) => `${s.file} (${s.scriptName})`)
                .join(', ')}
              . Inspect those install scripts before running install on the downloaded zip.
            </span>
          </div>
        )}

        <p className="text-sm font-medium text-slate-100 tabular-nums">
          {verify.addedVerifiedCount} {verify.addedVerifiedCount === 1 ? 'file' : 'files'} added,{' '}
          {verify.modifiedVerifiedCount} changed, {verify.untouchedVerifiedCount} untouched and
          identical
        </p>

        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={handleDownloadZip}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap"
          >
            <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Updated zip ({(verify.outputZipBytes.byteLength / 1024).toFixed(1)} KB)</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadChangelog}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800/70 whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Changelog</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadDiff}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800/70 whitespace-nowrap"
          >
            <FileDiff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Diff</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadNotice}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800/70 whitespace-nowrap"
          >
            <Scale className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Notice file</span>
          </button>
        </div>
      </section>

      {/* Verification panel listing each check with pass/fail and plain-English line */}
      <section
        aria-label="Verification checks"
        className="rounded-lg border border-slate-800 bg-[#111620] overflow-hidden"
      >
        <div className="border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-100">Verification checks</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            SHA-256 is a fingerprint used to prove untouched files are unchanged.
          </p>
        </div>
        <ul className="divide-y divide-slate-800/70">
          {verify.checks.map((chk) => (
            <li key={chk.id} className="px-5 py-3.5 space-y-1">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  {chk.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
                  )}
                  <span className="font-semibold text-slate-100">{getPlainCheckTitle(chk)}</span>
                </div>
                <span
                  className={`text-xs font-semibold shrink-0 ${
                    chk.passed ? 'text-emerald-300' : 'text-red-300'
                  }`}
                >
                  {chk.passed ? 'Pass' : 'Fail'}
                </span>
              </div>
              <p className="pl-6 text-xs text-slate-300">{chk.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* AI Decisions & Prompt Versions Log */}
      {aiUsageLog.length > 0 && (
        <section
          aria-label="AI activity and prompt versions"
          className="rounded-lg border border-slate-800 bg-[#111620] overflow-hidden"
        >
          <div className="border-b border-slate-800 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-slate-100">
              AI activity &amp; prompt versions ({aiUsageLog.length})
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Audit trail showing every AI decision, prompt version, cache hit, or fallback skip
              reason.
            </p>
          </div>
          <ul className="divide-y divide-slate-800/70">
            {aiUsageLog.map((entry) => (
              <li key={entry.id} className="px-5 py-3 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-100">{entry.callType}</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {entry.promptVersion}
                    </span>
                    <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200">
                      {entry.status}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    {entry.model} · hash {entry.contentHashKey.slice(0, 8)}
                  </span>
                </div>
                <p className="text-slate-300">{entry.decisionSummary}</p>
                {entry.skipReason && (
                  <p className="text-slate-400">Reason: {entry.skipReason}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Interactive preview of generated files */}
      <section className="rounded-lg border border-slate-800 bg-[#111620] overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 px-4 py-2.5">
          {(
            [
              { id: 'changelog', label: 'Changelog' },
              { id: 'diff', label: 'Diff' },
              { id: 'notice', label: 'Notice file' },
              { id: 'report', label: 'Full report' },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-600/20 text-blue-200 border border-blue-500/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <pre className="max-h-[380px] overflow-auto bg-[#0B0E14] p-5 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
          {tabContent[activeTab]}
        </pre>
      </section>
    </div>
  );
}
