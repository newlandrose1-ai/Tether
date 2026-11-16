'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Download,
  LogOut,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { exportWorkspaceToJson } from '../lib/exportImport';
import {
  enterBrowserFullscreen,
  exitBrowserFullscreen,
  isBrowserFullscreen,
} from '../lib/viewportFullscreen';

export function ViewportControls() {
  const hasLaunchedWorkspace = useWorkspaceStore((s) => s.hasLaunchedWorkspace);
  const isExitConfirmOpen = useWorkspaceStore((s) => s.isExitConfirmOpen);
  const openExitConfirm = useWorkspaceStore((s) => s.openExitConfirm);
  const closeExitConfirm = useWorkspaceStore((s) => s.closeExitConfirm);
  const exitWorkspaceGracefully = useWorkspaceStore((s) => s.exitWorkspaceGracefully);
  const projects = useWorkspaceStore((s) => s.projects);
  const groups = useWorkspaceStore((s) => s.groups);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const tethers = useWorkspaceStore((s) => s.tethers);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const isHeaderCollapsed = useWorkspaceStore((s) => s.isHeaderCollapsed);
  const isSidebarCollapsed = useWorkspaceStore((s) => s.isSidebarCollapsed);
  const toggleHeader = useWorkspaceStore((s) => s.toggleHeader);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);

  const [isNativeFullscreen, setIsNativeFullscreen] = useState<boolean>(() =>
    isBrowserFullscreen()
  );
  const [isExpandedFallback, setIsExpandedFallback] = useState(false);
  const [fullscreenNotice, setFullscreenNotice] = useState<string | null>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const nativeActive = isBrowserFullscreen();
      setIsNativeFullscreen(nativeActive);
      if (nativeActive) {
        setIsExpandedFallback(false);
        setFullscreenNotice(null);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!fullscreenNotice) return;
    const timer = window.setTimeout(() => setFullscreenNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [fullscreenNotice]);

  useEffect(() => {
    if (!isExitConfirmOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeExitConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExitConfirmOpen, closeExitConfirm]);

  const isFullscreenActive = isNativeFullscreen || isExpandedFallback;

  const handleToggleFullscreen = async () => {
    if (isNativeFullscreen) {
      await exitBrowserFullscreen();
      setIsNativeFullscreen(false);
      setIsExpandedFallback(false);
      return;
    }

    if (isExpandedFallback) {
      setIsExpandedFallback(false);
      if (hasLaunchedWorkspace) {
        if (isHeaderCollapsed) toggleHeader();
        if (typeof window !== 'undefined' && window.innerWidth >= 768 && isSidebarCollapsed) {
          toggleSidebar();
        }
      }
      return;
    }

    const res = await enterBrowserFullscreen();
    if (res.entered) {
      setIsNativeFullscreen(true);
      setIsExpandedFallback(false);
      setFullscreenNotice(null);
    } else if (hasLaunchedWorkspace) {
      // Host iframe restricted native fullscreen — gracefully expand workspace chrome instead
      if (!isHeaderCollapsed) toggleHeader();
      if (!isSidebarCollapsed) toggleSidebar();
      setIsExpandedFallback(true);
      setFullscreenNotice(res.fallbackReason || 'Expanded viewport active.');
    } else {
      setFullscreenNotice(res.fallbackReason || 'Native fullscreen unavailable in this frame.');
    }
  };

  const handleConfirmGracefulExit = async () => {
    if (isBrowserFullscreen()) {
      await exitBrowserFullscreen();
    }
    setIsNativeFullscreen(false);
    setIsExpandedFallback(false);
    setFullscreenNotice(null);
    exitWorkspaceGracefully();
  };

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <>
      {/* Always-accessible Viewport Controls (Fullscreen + Graceful Exit) */}
      <div
        className="fixed bottom-[60px] md:bottom-3.5 right-3.5 z-[70] flex flex-col items-end gap-1.5 pointer-events-none font-mono"
        aria-label="Viewport controls"
      >
        {fullscreenNotice && (
          <div
            role="status"
            className="pointer-events-auto max-w-xs glass-menu border border-zinc-700/80 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 flex items-center gap-2 shadow-xl animate-panel-in"
          >
            <span className="leading-snug">{fullscreenNotice}</span>
            <button
              type="button"
              onClick={() => setFullscreenNotice(null)}
              className="text-zinc-400 hover:text-zinc-100 p-0.5 rounded cursor-pointer shrink-0"
              aria-label="Dismiss fullscreen notice"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="pointer-events-auto flex items-center gap-1 glass-menu border border-zinc-700/80 rounded-lg p-1 shadow-xl">
          <button
            type="button"
            onClick={() => void handleToggleFullscreen()}
            aria-pressed={isFullscreenActive}
            aria-label={isFullscreenActive ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreenActive ? 'Exit fullscreen' : 'Toggle fullscreen'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 rounded text-[11px] transition cursor-pointer whitespace-nowrap ${
              isFullscreenActive
                ? 'bg-orange-500/20 text-orange-100 border border-orange-500/60 font-semibold'
                : 'text-zinc-200 hover:text-white hover:bg-zinc-800/80 border border-transparent'
            }`}
          >
            {isFullscreenActive ? (
              <Minimize2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            )}
            <span className="hidden sm:inline">
              {isFullscreenActive ? 'Exit Full' : 'Fullscreen'}
            </span>
          </button>

          {hasLaunchedWorkspace && (
            <>
              <div className="w-px h-4 bg-zinc-700/80" aria-hidden="true" />
              <button
                type="button"
                onClick={openExitConfirm}
                aria-label="Exit app"
                title="Exit workspace"
                className="flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 rounded text-[11px] text-zinc-300 hover:text-red-200 hover:bg-red-950/45 border border-transparent hover:border-red-900/60 transition cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="hidden sm:inline">Exit</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Graceful Exit App Confirmation Window */}
      {isExitConfirmOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeExitConfirm}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="exit-app-dialog-title"
          aria-describedby="exit-app-dialog-desc"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm glass-menu border border-zinc-600/80 border-t-orange-500/80 rounded-xl p-5 space-y-4 shadow-2xl animate-panel-in font-mono"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-orange-500/15 border border-orange-500/50 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <h2
                    id="exit-app-dialog-title"
                    className="text-sm font-semibold text-zinc-100"
                  >
                    Exit Workspace?
                  </h2>
                  <p className="text-[11px] text-zinc-400">
                    Return to the launch menu
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeExitConfirm}
                className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition cursor-pointer"
                aria-label="Close exit confirmation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              id="exit-app-dialog-desc"
              className="p-3 rounded-lg bg-zinc-900/75 border border-zinc-800/90 text-xs space-y-1.5 font-sans text-zinc-300"
            >
              <p>
                Your projects and blocks are saved locally in browser storage. Exiting will close
                open editor views{isFullscreenActive ? ', leave fullscreen,' : ''} and return you to
                the launch menu.
              </p>
              {activeProject && (
                <p className="text-[11px] font-mono text-zinc-400 pt-1 border-t border-zinc-800/80">
                  Active: <span className="text-zinc-200">{activeProject.name}</span> ·{' '}
                  {blocks.filter((b) => b.projectId === activeProject.id).length} blocks
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => exportWorkspaceToJson({ projects, groups, blocks, tethers })}
                className="w-full py-1.5 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-200 hover:text-white text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-orange-400" />
                <span>Download JSON Backup First</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeExitConfirm}
                  className="flex-1 py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
                >
                  Stay
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmGracefulExit()}
                  className="flex-1 py-2 px-3 rounded-lg bg-red-900/85 hover:bg-red-800 border border-red-700/80 text-red-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Exit App</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
