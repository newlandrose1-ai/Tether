'use client';

import React, { useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  FolderTree,
  FolderUp,
  Hash,
  ListFilter,
  Loader2,
  ShieldAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  extractDropUpload,
  fileListToFolderInputs,
} from '../../lib/folderIngest';
import {
  MAX_FILE_COUNT,
  MAX_NESTING_DEPTH,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ZIPPED_BYTES,
} from '../../config/ingestConfig';
import { usePipelineStore } from '../../store/pipelineStore';
import type { IngestErrorCode } from '../../types/pipeline';
import { FileTreeView } from '../ingest/FileTreeView';
import { ManifestTableView } from '../ingest/ManifestTableView';
import { SecretFindingsView } from '../ingest/SecretFindingsView';
import { SkippedListView } from '../ingest/SkippedListView';

type IngestTab = 'tree' | 'manifest' | 'secrets' | 'skipped';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getErrorAdvice(code: IngestErrorCode): string {
  switch (code) {
    case 'INVALID_EXTENSION':
      return 'Compress your project folder as a standard .zip file and try uploading it again.';
    case 'EMPTY_FILE':
      return 'Make sure the .zip file is not empty before uploading.';
    case 'MALFORMED_ZIP':
    case 'DECOMPRESS_FAILED':
      return 'Re-create the .zip archive using your operating system or zip tool, as this file appears damaged.';
    case 'MAX_ZIPPED_SIZE_EXCEEDED':
    case 'MAX_UNCOMPRESSED_SIZE_EXCEEDED':
      return 'Remove large build folders, media assets, or node_modules before zipping, then upload again.';
    case 'MAX_FILE_COUNT_EXCEEDED':
      return 'Exclude node_modules, .git, or generated build output when creating your .zip so total files stay under 5,000.';
    case 'COMPRESSION_RATIO_EXCEEDED':
      return 'Re-zip the project normally. Archives that expand by 100x or more are blocked for browser safety.';
    case 'MAX_DEPTH_EXCEEDED':
      return 'Flatten deeply nested directories so no folder is more than 20 levels deep.';
    case 'UNSAFE_PATH':
      return 'Remove relative parent paths (".."), backslashes, or absolute paths from the archive and re-zip cleanly.';
    case 'SYMLINK_REJECTED':
      return 'Re-zip without symbolic links (for example, using zip without preserving symlinks) and try again.';
    case 'NESTED_ARCHIVE_REJECTED':
      return 'Remove inner .zip/.tar archives or switch nested archive handling to "Skip inner zips" below.';
    case 'WEB_CRYPTO_UNAVAILABLE':
      return 'Open this app in a modern browser over HTTPS or localhost so file fingerprinting works.';
  }
}

export function UploadIngestStage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<IngestTab>('tree');

  const ingestStatus = usePipelineStore((s) => s.ingestStatus);
  const ingestProgress = usePipelineStore((s) => s.ingestProgress);
  const ingestError = usePipelineStore((s) => s.ingestError);
  const ingest = usePipelineStore((s) => s.ingest);
  const nestedArchivePolicy = usePipelineStore((s) => s.nestedArchivePolicy);
  const setNestedArchivePolicy = usePipelineStore((s) => s.setNestedArchivePolicy);
  const ingestFile = usePipelineStore((s) => s.ingestFile);
  const ingestFolder = usePipelineStore((s) => s.ingestFolder);
  const cancelActiveOperation = usePipelineStore((s) => s.cancelActiveOperation);
  const advanceFromUpload = usePipelineStore((s) => s.advanceFromUpload);
  const resetPipeline = usePipelineStore((s) => s.resetPipeline);

  const handleFiles = (files: FileList | null) => {
    if (ingestStatus === 'ingesting' || !files || files.length === 0) return;
    if (files.length === 1) {
      void ingestFile(files[0]);
      return;
    }
    void ingestFolder(fileListToFolderInputs(files));
  };

  const handleFolderFiles = (files: FileList | null) => {
    if (ingestStatus === 'ingesting' || !files || files.length === 0) return;
    void ingestFolder(fileListToFolderInputs(files));
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (ingestStatus === 'ingesting') return;
    const extracted = await extractDropUpload(e.dataTransfer);
    if (extracted.kind === 'single-zip') {
      await ingestFile(extracted.file);
    } else if (extracted.kind === 'folder-inputs') {
      await ingestFolder(extracted.inputs);
    }
  };

  const maxZippedMb = (MAX_ZIPPED_BYTES / (1024 * 1024)).toFixed(0);
  const maxUnpackedMb = (MAX_UNCOMPRESSED_BYTES / (1024 * 1024)).toFixed(0);

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="sr-only"
        aria-label="Choose .zip project archive"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        className="sr-only"
        aria-label="Choose project folder"
        onChange={(e) => {
          handleFolderFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Consistent 3-part stage header */}
      <div className="rounded-lg border border-slate-800 bg-[#111620] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Upload your project .zip or folder
            </h1>
            <p className="text-sm text-slate-300">
              <strong className="font-medium text-slate-100">What happens next:</strong>{' '}
              {ingest && ingestStatus === 'ready'
                ? 'Continue to analyse your project’s languages, tools, and missing setup.'
                : 'We pack/unpack a read-only copy in your browser, record a SHA-256 fingerprint (used to prove untouched files stay unchanged), and hide any secrets.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {ingest && ingestStatus === 'ready' ? (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap"
                >
                  Choose .zip
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="rounded-md border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap"
                >
                  Choose folder
                </button>
                <button
                  type="button"
                  onClick={advanceFromUpload}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap"
                >
                  <span>Continue to Analyse</span>
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={ingestStatus === 'ingesting'}
                  onClick={() => folderInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800/70 disabled:opacity-60 whitespace-nowrap"
                >
                  <FolderUp className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Select folder</span>
                </button>
                <button
                  type="button"
                  disabled={ingestStatus === 'ingesting'}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60 whitespace-nowrap"
                >
                  <UploadCloud className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{ingestStatus === 'ingesting' ? 'Reading...' : 'Select .zip file'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Rejection alert */}
      {ingestStatus === 'error' && ingestError && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/60 bg-red-950/30 p-5 space-y-3"
        >
          <div className="flex items-start gap-3">
            <AlertOctagon className="mt-0.5 h-5 w-5 text-red-400 shrink-0" aria-hidden="true" />
            <div className="space-y-2 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-red-300">
                  Upload rejected
                </span>
                <span aria-hidden="true" className="text-red-400">
                  ·
                </span>
                <h2 className="text-sm font-semibold text-red-100">{ingestError.title}</h2>
              </div>

              <p className="text-sm text-red-100">{ingestError.detail}</p>

              {ingestError.offendingPath && (
                <p className="text-xs text-red-200">
                  <strong className="font-semibold">File involved:</strong>{' '}
                  <span className="font-mono break-all">{ingestError.offendingPath}</span>
                </p>
              )}

              <p className="text-xs text-red-200">
                <strong className="font-semibold">What you can do:</strong>{' '}
                {getErrorAdvice(ingestError.code)}
              </p>

              <p className="border-t border-red-500/30 pt-2 text-xs font-medium text-red-100">
                Nothing was changed or kept. No files from this archive remain in browser memory.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pl-8">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap"
            >
              Try a different .zip
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="rounded-md border border-slate-700 bg-transparent px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
            >
              Select a folder instead
            </button>
            <button
              type="button"
              onClick={resetPipeline}
              className="rounded-md border border-red-400/50 bg-transparent px-3.5 py-1.5 text-xs font-medium text-red-100 hover:bg-red-900/40 whitespace-nowrap"
            >
              Clear error
            </button>
          </div>
        </div>
      )}

      {/* Reading progress state */}
      {ingestStatus === 'ingesting' && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-blue-500/40 bg-[#111620] p-6 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-100">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400 shrink-0" aria-hidden="true" />
              <span>{ingestProgress?.label ?? 'Reading your project files locally...'}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono text-xs font-semibold tabular-nums text-blue-300">
                {ingestProgress?.percent ?? 0}%
              </span>
              <button
                type="button"
                onClick={cancelActiveOperation}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-transparent px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
              >
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Cancel</span>
              </button>
            </div>
          </div>

          <div
            role="progressbar"
            aria-label="Reading archive"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={ingestProgress?.percent ?? 0}
            aria-valuetext={
              ingestProgress?.label ??
              'Checking safety limits, computing file fingerprints, and scanning for secrets'
            }
            className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
          >
            <div
              className="h-full rounded-full bg-blue-500 transition-[width] duration-150"
              style={{ width: `${Math.max(4, ingestProgress?.percent ?? 4)}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span>
              Running in background worker: checking safety limits, SHA-256 fingerprints, and
              secrets. Nothing is uploaded.
            </span>
            {ingestProgress?.currentPath && (
              <span className="truncate max-w-xs font-mono text-[11px] text-slate-400">
                {ingestProgress.currentPath}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Drop zone when empty or retrying */}
      {(!ingest || ingestStatus === 'error') && ingestStatus !== 'ingesting' && (
        <div className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop a .zip archive or project folder here, or press Enter to browse a .zip file"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              void handleDrop(e);
            }}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-8 sm:p-10 text-center transition-colors ${
              isDragging
                ? 'border-blue-400 bg-blue-500/10'
                : 'border-slate-700 bg-[#111620] hover:border-slate-500'
            }`}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-700 bg-[#161C28]">
              <UploadCloud className="h-6 w-6 text-blue-400" aria-hidden="true" />
            </div>
            <p className="mt-4 text-base font-semibold text-slate-100">
              Drop a .zip file or project folder here, or click to browse a .zip
            </p>
            <p className="mt-1.5 text-sm text-slate-300">
              Up to {maxZippedMb} MB zipped, {MAX_FILE_COUNT.toLocaleString()} files (up to{' '}
              {maxUnpackedMb} MB unpacked, {MAX_NESTING_DEPTH} folders deep).
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Your original files are never edited — upgrades always apply to an in-browser copy.
            </p>
          </div>

          {/* Quiet secondary option for nested archives */}
          <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-[#111620] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium text-slate-200">
                If your zip contains another .zip file inside it:
              </p>
              <p className="text-xs text-slate-400">
                Nested archives can either be skipped from reading or rejected immediately.
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label="Nested archive handling"
              className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B0E14] p-1 shrink-0 self-start sm:self-center"
            >
              <button
                type="button"
                role="radio"
                aria-checked={nestedArchivePolicy === 'skip'}
                onClick={() => setNestedArchivePolicy('skip')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  nestedArchivePolicy === 'skip'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Skip inner zips
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={nestedArchivePolicy === 'reject'}
                onClick={() => setNestedArchivePolicy('reject')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  nestedArchivePolicy === 'reject'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Reject upload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success state */}
      {ingest && ingestStatus === 'ready' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-[#111620] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                    <span>Archive ready</span>
                  </div>
                  <h2 className="truncate font-mono text-base font-semibold text-slate-100">
                    {ingest.archiveName}
                  </h2>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 font-mono tabular-nums">
                <span>{formatBytes(ingest.zippedBytes)} zipped</span>
                <span aria-hidden="true">·</span>
                <span>{formatBytes(ingest.uncompressedBytes)} unpacked</span>
                <span aria-hidden="true">·</span>
                <span>{ingest.fileCount} files</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-4 sm:grid-cols-4">
              <div>
                <div className="text-xs text-slate-400">Fingerprints (SHA-256)</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
                  {ingest.manifest.length}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Readable text files</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
                  {Object.keys(ingest.textFiles).length}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Unwanted &amp; binary files</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
                  {ingest.skipped.length}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Secrets hidden from AI</div>
                <div
                  className={`mt-1 font-mono text-base font-semibold tabular-nums ${
                    ingest.secretFindings.length > 0 ? 'text-amber-300' : 'text-emerald-300'
                  }`}
                >
                  {ingest.secretFindings.length}
                </div>
              </div>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Uploaded archive details"
            className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-[#111620] p-1 w-full sm:w-fit"
          >
            {(
              [
                {
                  id: 'tree',
                  label: 'Files',
                  icon: FolderTree,
                  count: ingest.fileCount,
                },
                {
                  id: 'manifest',
                  label: 'Fingerprints',
                  icon: Hash,
                  count: ingest.manifest.length,
                },
                {
                  id: 'secrets',
                  label: 'Secrets',
                  icon: ShieldAlert,
                  count: ingest.secretFindings.length,
                },
                {
                  id: 'skipped',
                  label: 'Unwanted files',
                  icon: ListFilter,
                  count: ingest.skipped.length,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                  <span className="font-mono tabular-nums text-[11px] text-slate-400">
                    ({tab.count})
                  </span>
                </button>
              );
            })}
          </div>

          {activeTab === 'tree' && (
            <FileTreeView nodes={ingest.fileTree} textFiles={ingest.textFiles} />
          )}
          {activeTab === 'manifest' && (
            <ManifestTableView manifest={ingest.manifest} flaggedPaths={ingest.flaggedPaths} />
          )}
          {activeTab === 'secrets' && (
            <SecretFindingsView
              findings={ingest.secretFindings}
              flaggedPaths={ingest.flaggedPaths}
            />
          )}
          {activeTab === 'skipped' && <SkippedListView skipped={ingest.skipped} />}
        </div>
      )}
    </div>
  );
}
