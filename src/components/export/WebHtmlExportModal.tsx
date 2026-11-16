'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  extractProjectExportFiles,
  generateStandaloneWebHtml,
  exportProjectToSingleHtml,
  exportProjectToWebZip,
} from '../../lib/webHtmlExport';
import {
  collectProjectZipManifest,
  exportProjectToZip,
} from '../../lib/projectZipExport';
import { formatFileSize } from '../../lib/fileTypes';
import {
  Globe,
  FileArchive,
  FolderArchive,
  Download,
  Eye,
  ArrowLeft,
  X,
  Check,
  Folder,
  Copy,
  FolderGit2,
} from 'lucide-react';

interface WebHtmlExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenGitHubDeploy?: () => void;
}

export function WebHtmlExportModal({ isOpen, onClose, onOpenGitHubDeploy }: WebHtmlExportModalProps) {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const projects = useWorkspaceStore((s) => s.projects);
  const blocks = useWorkspaceStore((s) => s.blocks);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const [includeUntethered, setIncludeUntethered] = useState(true);
  const [isExportingProjectZip, setIsExportingProjectZip] = useState(false);
  const [isExportingWebZip, setIsExportingWebZip] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const zipManifest = useMemo(() => {
    if (!activeProject) return null;
    return collectProjectZipManifest(activeProject, blocks, { includeUntethered });
  }, [activeProject, blocks, includeUntethered]);

  const exportFiles = useMemo(() => {
    if (!activeProject) return [];
    return extractProjectExportFiles(activeProject, blocks);
  }, [activeProject, blocks]);

  const handleClose = React.useCallback(() => {
    setPreviewHtml(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (previewHtml) {
          setPreviewHtml(null);
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, previewHtml, handleClose]);

  if (!isOpen || !activeProject || !zipManifest) return null;

  const handleDownloadProjectZip = async () => {
    try {
      setIsExportingProjectZip(true);
      await exportProjectToZip(activeProject, blocks, { includeUntethered });
    } finally {
      setIsExportingProjectZip(false);
    }
  };

  const handleDownloadSingleHtml = () => {
    exportProjectToSingleHtml(activeProject, blocks);
  };

  const handleDownloadWebZip = async () => {
    try {
      setIsExportingWebZip(true);
      await exportProjectToWebZip(activeProject, blocks);
    } finally {
      setIsExportingWebZip(false);
    }
  };

  const handleLivePreview = () => {
    const html = generateStandaloneWebHtml(activeProject, exportFiles);
    setPreviewHtml(html);
  };

  const handleCopyRawHtml = async () => {
    try {
      const html = generateStandaloneWebHtml(activeProject, exportFiles);
      await navigator.clipboard.writeText(html);
      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 2000);
    } catch {
      // Clipboard may be blocked in restricted iframe contexts
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Export Project Archive and Web Bundle"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
        onClick={handleClose}
        aria-label="Close dialog"
      />

      {/* Modal Dialog */}
      <div
        className={`relative z-50 w-full ${
          previewHtml ? 'max-w-4xl' : 'max-w-xl'
        } glass-menu border border-zinc-600/80 border-t-orange-500/75 rounded-xl overflow-hidden font-mono text-xs text-zinc-200 animate-panel-in transition-all`}
      >
        {/* Header */}
        <div className="h-12 px-4 border-b border-zinc-700/75 glass-header flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {previewHtml ? (
              <button
                type="button"
                onClick={() => setPreviewHtml(null)}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 transition cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-orange-400" />
                <span>Back</span>
              </button>
            ) : (
              <FileArchive className="w-4 h-4 text-orange-400 shrink-0" />
            )}
            <span className="font-semibold text-zinc-100 text-sm tracking-wide truncate">
              {previewHtml
                ? `Live Web Explorer Preview — ${activeProject.name}`
                : 'Export Project Archive & Web Bundle'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-100 rounded hover:bg-zinc-800/80 transition cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        {previewHtml ? (
          <div className="h-[72vh] bg-zinc-950 flex flex-col">
            <iframe
              title="Live Web Explorer Preview"
              sandbox="allow-scripts"
              srcDoc={previewHtml}
              className="w-full h-full border-0 bg-zinc-950"
            />
          </div>
        ) : (
        <>
        <div className="p-4 sm:p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Summary Banner */}
          <div className="glass-card border border-zinc-700/75 rounded-lg p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px]">
              <span className="uppercase tracking-wider font-semibold text-zinc-300">
                Live Project Manifest
              </span>
              <span className="text-orange-400 font-bold">{activeProject.name}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-0.5">
              <div className="bg-zinc-950/70 p-2 rounded border border-zinc-700/70 text-center">
                <div className="text-zinc-400 text-[10px]">Files</div>
                <div className="text-sm font-bold text-zinc-100 mt-0.5 tabular-nums">
                  {zipManifest.files.length}
                </div>
                <div className="text-[10px] text-zinc-500 tabular-nums">
                  {zipManifest.tetheredFileCount} tethered · {zipManifest.untetheredFileCount} canvas
                </div>
              </div>
              <div className="bg-zinc-950/70 p-2 rounded border border-zinc-700/70 text-center">
                <div className="text-zinc-400 text-[10px]">Folders</div>
                <div className="text-sm font-bold text-zinc-100 mt-0.5 tabular-nums">
                  {zipManifest.folders.length}
                </div>
                <div className="text-[10px] text-zinc-500">live hierarchy</div>
              </div>
              <div className="bg-zinc-950/70 p-2 rounded border border-zinc-700/70 text-center">
                <div className="text-zinc-400 text-[10px]">Archive Size</div>
                <div className="text-sm font-bold text-zinc-100 mt-0.5 tabular-nums">
                  {formatFileSize(zipManifest.totalBytes)}
                </div>
                <div className="text-[10px] text-zinc-500 truncate">{zipManifest.archiveFileName}</div>
              </div>
            </div>

            <label className="flex items-center justify-between gap-2 pt-1.5 border-t border-zinc-800/80 text-[11px] text-zinc-300 cursor-pointer select-none">
              <span>Include untethered canvas blocks in .zip</span>
              <input
                type="checkbox"
                checked={includeUntethered}
                onChange={(e) => setIncludeUntethered(e.target.checked)}
                className="accent-orange-500 w-3.5 h-3.5 cursor-pointer"
              />
            </label>
          </div>

          {/* Export Options */}
          <div className="space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Export Formats
            </div>

            {/* Option 1: Real Project .zip Archive */}
            <div className="p-3 glass-card border border-orange-500/45 hover:border-orange-500/80 rounded-lg transition flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-100 text-xs">
                  <FileArchive className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span>Project Archive (.zip)</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Download a real <code>.zip</code> matching the live synced folder tree and canvas blocks, preserving filenames, code, configs, and binary assets.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadProjectZip}
                disabled={isExportingProjectZip || (zipManifest.files.length === 0 && zipManifest.folders.length === 0)}
                className="px-3 py-2 min-h-[38px] bg-orange-500/20 hover:bg-orange-500/30 disabled:opacity-50 border border-orange-500/70 text-orange-100 hover:text-white rounded font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-orange-400" />
                <span>{isExportingProjectZip ? 'Zipping...' : 'Download .zip'}</span>
              </button>
            </div>

            {/* Option 2: Full Web Folder Bundle ZIP */}
            <div className="p-3 glass-card border border-zinc-700/75 hover:border-orange-500/60 rounded-lg transition flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-100 text-xs">
                  <FolderArchive className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span>Complete Web Folder (.zip)</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Project archive plus an interactive web explorer (<code>index.html</code>, or <code>tether-explorer.html</code> if root already has <code>index.html</code>).
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadWebZip}
                disabled={isExportingWebZip}
                className="px-3 py-2 min-h-[38px] bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-600/80 hover:border-orange-500/60 text-zinc-100 rounded font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-orange-400" />
                <span>{isExportingWebZip ? 'Packing...' : 'Export Web .zip'}</span>
              </button>
            </div>

            {/* Option 3: Standalone Single Web HTML */}
            <div className="p-3 glass-card border border-zinc-700/75 hover:border-orange-500/60 rounded-lg transition flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-100 text-xs">
                  <Globe className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span>Standalone Web HTML (.html)</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  One portable self-contained file with interactive folder tree, syntax highlighting, search, and copy.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadSingleHtml}
                className="px-3 py-2 min-h-[38px] bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-600/80 hover:border-orange-500/60 text-zinc-100 rounded font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-orange-400" />
                <span>Export .html</span>
              </button>
            </div>

            {/* Option 4: Live In-Browser Preview & Copy */}
            <div className="p-3 glass-card border border-zinc-700/75 rounded-lg flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-200 text-xs">
                  <Eye className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span>Live Browser Preview</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Immediately preview and inspect the web code explorer right here without saving to disk.
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyRawHtml}
                  className="px-2.5 py-1.5 min-h-[36px] bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition cursor-pointer flex items-center gap-1"
                  title="Copy full HTML markup"
                >
                  {copiedSuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSuccess ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleLivePreview}
                  className="px-3 py-1.5 min-h-[36px] bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-600 text-zinc-100 rounded transition cursor-pointer flex items-center gap-1 font-semibold"
                >
                  <Eye className="w-3.5 h-3.5 text-orange-400" />
                  <span>Preview</span>
                </button>
              </div>
            </div>

            {onOpenGitHubDeploy && (
              <div className="p-3 glass-card border border-zinc-700/75 hover:border-orange-500/60 rounded-lg transition flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-zinc-100 text-xs">
                    <FolderGit2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                    <span>Deploy to GitHub Repository</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Push this web explorer and all project source folders directly to any connected GitHub branch.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenGitHubDeploy}
                  className="px-3 py-2 min-h-[38px] bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/70 text-orange-100 hover:text-white rounded font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-orange-400" />
                  <span>GitHub Deploy</span>
                </button>
              </div>
            )}
          </div>

          {/* Files Preview list */}
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400 flex items-center justify-between">
              <span>Archive Contents ({zipManifest.archiveFileName})</span>
              <span className="tabular-nums">{formatFileSize(zipManifest.totalBytes)} total</span>
            </div>
            <div className="max-h-40 overflow-y-auto bg-zinc-950/75 border border-zinc-700/75 rounded p-2 divide-y divide-zinc-800/80">
              {zipManifest.folders.map((folderPath) => (
                <div key={`folder:${folderPath}`} className="py-1 flex items-center justify-between text-[11px] text-zinc-400">
                  <span className="truncate pr-2 font-mono flex items-center gap-1.5">
                    <Folder className="w-3 h-3 text-orange-400/80 shrink-0" />
                    <span>{folderPath}/</span>
                  </span>
                  <span className="text-[10px] text-zinc-500 shrink-0">folder</span>
                </div>
              ))}
              {zipManifest.files.map((file) => (
                <div key={file.blockId} className="py-1 flex items-center justify-between text-[11px] text-zinc-300 gap-2">
                  <span className="truncate font-mono">{file.path}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`px-1 py-0.5 rounded text-[9px] uppercase border ${
                        file.isTethered
                          ? 'bg-orange-500/15 border-orange-500/40 text-orange-300'
                          : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                      }`}
                    >
                      {file.isTethered ? 'tethered' : 'canvas'}
                    </span>
                    <span className="text-zinc-500 tabular-nums w-14 text-right">
                      {formatFileSize(file.byteSize)}
                    </span>
                  </div>
                </div>
              ))}
              {zipManifest.files.length === 0 && zipManifest.folders.length === 0 && (
                <div className="py-3 text-center text-zinc-500 text-[11px]">
                  No exportable files or folders in current selection.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-11 px-4 border-t border-zinc-700/75 glass-header flex items-center justify-between text-zinc-400 text-[11px]">
          <span>Single source of truth · Real DEFLATE .zip archive</span>
          <button
            type="button"
            onClick={handleClose}
            className="px-3 py-1 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-600/70 text-zinc-200 rounded transition cursor-pointer"
          >
            Close
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
