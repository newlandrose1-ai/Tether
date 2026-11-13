'use client';

import React, { useState, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  extractProjectExportFiles,
  generateStandaloneWebHtml,
  exportProjectToSingleHtml,
  exportProjectToWebZip,
} from '../../lib/webHtmlExport';
import {
  Globe,
  FileCode,
  FolderArchive,
  Download,
  ExternalLink,
  X,
  Check,
  Folder,
  Layers,
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

  const [isExportingZip, setIsExportingZip] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  const exportFiles = useMemo(() => {
    if (!activeProject) return [];
    return extractProjectExportFiles(activeProject, blocks);
  }, [activeProject, blocks]);

  const totalLines = useMemo(() => {
    return exportFiles.reduce((acc, f) => acc + f.lineCount, 0);
  }, [exportFiles]);

  const totalBytes = useMemo(() => {
    return exportFiles.reduce((acc, f) => acc + f.size, 0);
  }, [exportFiles]);

  const uniqueFolders = useMemo(() => {
    const folders = new Set<string>();
    exportFiles.forEach((f) => {
      const parts = f.path.split('/');
      if (parts.length > 1) {
        folders.add(parts.slice(0, -1).join('/'));
      }
    });
    return Array.from(folders);
  }, [exportFiles]);

  if (!isOpen || !activeProject) return null;

  const handleDownloadSingleHtml = () => {
    exportProjectToSingleHtml(activeProject, blocks);
  };

  const handleDownloadWebZip = async () => {
    try {
      setIsExportingZip(true);
      await exportProjectToWebZip(activeProject, blocks);
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleLivePreview = () => {
    const html = generateStandaloneWebHtml(activeProject, exportFiles);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const handleCopyRawHtml = async () => {
    const html = generateStandaloneWebHtml(activeProject, exportFiles);
    await navigator.clipboard.writeText(html);
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-label="Close dialog"
      />

      {/* Modal Dialog */}
      <div className="relative z-50 w-full max-w-xl glass-menu border border-zinc-600/80 border-t-orange-500/75 rounded-xl overflow-hidden font-mono text-xs text-zinc-200 animate-panel-in">
        {/* Header */}
        <div className="h-12 px-4 border-b border-zinc-700/75 glass-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-orange-400" />
            <span className="font-semibold text-zinc-100 text-sm tracking-wide">
              Export Web HTML Folder
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-100 rounded hover:bg-zinc-800/80 transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Summary Banner */}
          <div className="glass-card border border-zinc-700/75 rounded-lg p-3.5 space-y-2">
            <div className="flex items-center justify-between text-zinc-400 text-[11px]">
              <span className="uppercase tracking-wider font-semibold text-zinc-300">
                Project Manifest
              </span>
              <span className="text-orange-400 font-bold">{activeProject.name}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="bg-zinc-950/70 p-2 rounded border border-zinc-700/70 text-center">
                <div className="text-zinc-400 text-[10px]">Files</div>
                <div className="text-sm font-bold text-zinc-100 mt-0.5 tabular-nums">{exportFiles.length}</div>
              </div>
              <div className="bg-zinc-950/70 p-2 rounded border border-zinc-700/70 text-center">
                <div className="text-zinc-400 text-[10px]">Folders</div>
                <div className="text-sm font-bold text-zinc-100 mt-0.5 tabular-nums">{uniqueFolders.length}</div>
              </div>
              <div className="bg-zinc-950/70 p-2 rounded border border-zinc-700/70 text-center">
                <div className="text-zinc-400 text-[10px]">Total Lines</div>
                <div className="text-sm font-bold text-zinc-100 mt-0.5 tabular-nums">
                  {totalLines.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Export Options */}
          <div className="space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Export Formats
            </div>

            {/* Option 1: Standalone Single Web HTML */}
            <div className="p-3 glass-card border border-zinc-700/75 hover:border-orange-500/60 rounded-lg transition flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-100 text-xs">
                  <Globe className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span>Standalone Web HTML (.html)</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  One portable self-contained file with full interactive folder tree, code syntax highlighting, search, and copy. Runs offline in any browser.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadSingleHtml}
                className="px-3 py-2 min-h-[38px] bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/70 text-orange-100 hover:text-white rounded font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-orange-400" />
                <span>Export .html</span>
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
                  Archive containing root <code>index.html</code> web explorer plus all project source files preserved in their actual nested folders. Ready for static hosting.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadWebZip}
                disabled={isExportingZip}
                className="px-3 py-2 min-h-[38px] bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-600/80 hover:border-orange-500/60 text-zinc-100 rounded font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-orange-400" />
                <span>{isExportingZip ? 'Packing...' : 'Export .zip'}</span>
              </button>
            </div>

            {/* Option 3: Live In-Browser Preview & Copy */}
            <div className="p-3 glass-card border border-zinc-700/75 rounded-lg flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-200 text-xs">
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span>Live Browser Preview</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Immediately open and test the interactive web code explorer in a new tab without saving to disk.
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
                  <ExternalLink className="w-3.5 h-3.5" />
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
              <span>Included Files & Folders</span>
              <span className="tabular-nums">{(totalBytes / 1024).toFixed(1)} KB total</span>
            </div>
            <div className="max-h-36 overflow-y-auto bg-zinc-950/75 border border-zinc-700/75 rounded p-2 divide-y divide-zinc-800/80">
              {exportFiles.map((file) => (
                <div key={file.id} className="py-1 flex items-center justify-between text-[11px] text-zinc-300">
                  <span className="truncate pr-2 font-mono">{file.path}</span>
                  <span className="text-zinc-500 shrink-0 tabular-nums">{file.lineCount}L</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-11 px-4 border-t border-zinc-700/75 glass-header flex items-center justify-between text-zinc-400 text-[11px]">
          <span>Format: Self-contained HTML5 · Zero dependencies</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-600/70 text-zinc-200 rounded transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
