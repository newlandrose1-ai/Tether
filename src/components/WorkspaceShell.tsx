'use client';

import React, { useRef, useState, useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ProjectSidebar } from './ProjectSidebar';
import { BlockCanvas } from './BlockCanvas';
import { BlockInspector } from './inspector/BlockInspector';
import { WorkspaceSearch } from './WorkspaceSearch';
import {
  exportWorkspaceToJson,
  validateWorkspaceExport,
  type TetherWorkspaceExport,
} from '../lib/exportImport';
import { HeroBlockView } from './HeroBlockView';
import { CodeEditorWorkspace } from './editor/CodeEditorWorkspace';
import { ContextInspector } from './inspector/ContextInspector';
import { WorkspaceStatusBar } from './status/WorkspaceStatusBar';
import {
  Download,
  Upload,
  AlertTriangle,
  X,
  Minimize2,
  Edit3,
  Eye,
  Globe,
  ChevronDown,
  ChevronUp,
  PanelLeft,
  PanelRight,
  FolderGit2,
} from 'lucide-react';
import { WebHtmlExportModal } from './export/WebHtmlExportModal';
import { GitHubDeployModal } from './github/GitHubDeployModal';
import { fetchGitHubSession, type GitHubSessionInfo } from '../lib/githubClient';

export function WorkspaceShell() {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeGroupId = useWorkspaceStore((s) => s.activeGroupId);
  const projects = useWorkspaceStore((s) => s.projects);
  const groups = useWorkspaceStore((s) => s.groups);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const tethers = useWorkspaceStore((s) => s.tethers);
  const selectedBlockId = useWorkspaceStore((s) => s.selectedBlockId);
  const focusedBlockId = useWorkspaceStore((s) => s.focusedBlockId);
  const setFocusedBlockId = useWorkspaceStore((s) => s.setFocusedBlockId);
  const importWorkspace = useWorkspaceStore((s) => s.importWorkspace);

  const isEditorOpen = useWorkspaceStore((s) => s.isEditorOpen);
  const activeEditorBlockId = useWorkspaceStore((s) => s.activeEditorBlockId);
  const openBlockIds = useWorkspaceStore((s) => s.openBlockIds);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const closeEditorModal = useWorkspaceStore((s) => s.closeEditorModal);

  const isSidebarCollapsed = useWorkspaceStore((s) => s.isSidebarCollapsed);
  const isHeaderCollapsed = useWorkspaceStore((s) => s.isHeaderCollapsed);
  const isInspectorCollapsed = useWorkspaceStore((s) => s.isInspectorCollapsed);
  const isBlockInspectorCollapsed = useWorkspaceStore((s) => s.isBlockInspectorCollapsed);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const toggleHeader = useWorkspaceStore((s) => s.toggleHeader);
  const toggleBlockInspector = useWorkspaceStore((s) => s.toggleBlockInspector);

  const [isHeroInspectorOpen, setIsHeroInspectorOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importCandidate, setImportCandidate] = useState<TetherWorkspaceExport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isWebExportOpen, setIsWebExportOpen] = useState(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [githubSession, setGithubSession] = useState<GitHubSessionInfo | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchGitHubSession()
      .then((info) => setGithubSession(info))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as globalThis.Node)) {
        setIsExportMenuOpen(false);
      }
    };
    if (isExportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExportMenuOpen]);

  // Collapse sidebar on narrow mobile viewports on initial mount so the user lands directly on the canvas
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768 && !useWorkspaceStore.getState().isSidebarCollapsed) {
      useWorkspaceStore.getState().toggleSidebar();
    }
  }, []);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId);

  const handleExport = () => {
    exportWorkspaceToJson({ projects, groups, blocks, tethers });
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        const validation = validateWorkspaceExport(parsed);

        if (!validation.valid) {
          setImportError(validation.error);
        } else {
          setImportCandidate(validation.data);
        }
      } catch {
        setImportError('Failed to parse file: Selected file is not valid JSON.');
      }
    };

    reader.onerror = () => {
      setImportError('Failed to read file from disk.');
    };

    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!importCandidate) return;
    await importWorkspace(importCandidate);
    setImportCandidate(null);
  };

  const canResumeEditor = !isEditorOpen && openBlockIds.length > 0 && activeEditorBlockId;
  const isSelectedBinaryOrUpload = Boolean(
    selectedBlock &&
      (selectedBlock.kind === 'upload' ||
        (selectedBlock.kind === 'file' && (selectedBlock.data as { binary?: boolean })?.binary))
  );
  const showRightInspector = !focusedBlockId ? Boolean(selectedBlockId) : isHeroInspectorOpen;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#090B0E] text-zinc-100 font-sans antialiased select-none safe-top">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Collapsible Top Navigation Bar */}
      {!isHeaderCollapsed && (
        <header className="h-12 sm:h-11 glass-header border-b border-zinc-700/75 px-2.5 sm:px-3 flex items-center justify-between flex-shrink-0 z-20 gap-2">
          {/* Left: Hierarchy Toggle, Brand & Project/Group Breadcrumb */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={toggleSidebar}
              className={`hidden md:flex w-7 h-7 items-center justify-center rounded border transition cursor-pointer ${
                !isSidebarCollapsed
                  ? 'text-orange-300 bg-orange-500/15 border-orange-500/40'
                  : 'text-zinc-400 border-transparent hover:text-zinc-100 hover:bg-zinc-800/70 hover:border-zinc-700/70'
              }`}
              title={isSidebarCollapsed ? 'Show project hierarchy' : 'Hide project hierarchy'}
              aria-label={isSidebarCollapsed ? 'Show project hierarchy' : 'Hide project hierarchy'}
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            <span className="flex items-center gap-1.5 font-semibold text-xs tracking-wider text-zinc-100 font-mono pr-2.5 sm:border-r border-zinc-700/75">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
              <span>TETHER</span>
            </span>

            <div className="flex items-center gap-1.5 text-xs font-mono min-w-0">
              <span className="text-zinc-200 truncate max-w-[130px] sm:max-w-[180px]">
                {activeProject ? activeProject.name : 'No Project'}
              </span>
              {activeGroup && (
                <>
                  <span className="hidden md:inline text-zinc-500">/</span>
                  <span className="hidden md:inline text-zinc-400 truncate max-w-[140px]">
                    {activeGroup.name}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right: Quick Pop-up Viewer/Editor Trigger, Search, Export, Header Collapse */}
          <div className="flex items-center gap-1.5">
            {selectedBlock ? (
              <button
                type="button"
                onClick={() => openBlockInEditor(selectedBlock.id)}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 min-h-[30px] bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/70 text-orange-100 rounded text-xs font-mono font-medium transition cursor-pointer whitespace-nowrap shrink-0"
                title={isSelectedBinaryOrUpload ? 'View selected block' : 'Edit selected block'}
              >
                {isSelectedBinaryOrUpload ? (
                  <Eye className="w-3.5 h-3.5 text-orange-400" />
                ) : (
                  <Edit3 className="w-3.5 h-3.5 text-orange-400" />
                )}
                <span>
                  {isSelectedBinaryOrUpload ? 'View' : 'Edit'} {selectedBlock.title}
                </span>
              </button>
            ) : canResumeEditor ? (
              <button
                type="button"
                onClick={() => openBlockInEditor(activeEditorBlockId)}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 min-h-[30px] bg-zinc-900/80 hover:bg-zinc-800/90 border border-zinc-700/80 hover:border-orange-500/50 text-zinc-200 rounded text-xs font-mono transition cursor-pointer whitespace-nowrap shrink-0"
                title="Re-open editor pop-up"
              >
                <Edit3 className="w-3.5 h-3.5 text-orange-400" />
                <span>Open Editor ({openBlockIds.length})</span>
              </button>
            ) : null}

            <WorkspaceSearch />

            <button
              type="button"
              onClick={() => setIsGitHubModalOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 min-h-[32px] border rounded text-xs font-mono transition cursor-pointer whitespace-nowrap shrink-0 ${
                githubSession?.connected
                  ? 'bg-emerald-500/12 hover:bg-emerald-500/20 border-emerald-500/45 text-emerald-200'
                  : 'bg-zinc-900/75 hover:bg-zinc-800/85 border-zinc-700/80 hover:border-orange-500/60 text-zinc-300 hover:text-white'
              }`}
              title={
                githubSession?.connected && githubSession.user
                  ? `Connected to GitHub as @${githubSession.user.login}`
                  : 'Connect & deploy to GitHub'
              }
            >
              <FolderGit2
                className={`w-3.5 h-3.5 ${
                  githubSession?.connected ? 'text-emerald-400' : 'text-orange-400'
                }`}
              />
              <span className="hidden sm:inline">
                {githubSession?.connected && githubSession.user
                  ? `@${githubSession.user.login}`
                  : 'GitHub'}
              </span>
            </button>

            {focusedBlockId && (
              <button
                type="button"
                onClick={() => setFocusedBlockId(null)}
                className="flex items-center gap-1 px-2.5 py-1.5 min-h-[32px] bg-orange-500/15 hover:bg-orange-500/25 text-orange-100 border border-orange-500/60 rounded text-xs font-mono transition cursor-pointer whitespace-nowrap shrink-0"
                title="Exit focus mode (Esc)"
              >
                <Minimize2 className="w-3.5 h-3.5 text-orange-400" />
                <span className="hidden sm:inline">Exit Focus</span>
              </button>
            )}

            {/* Export / Import Menu */}
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                className={`flex items-center gap-1.5 px-2.5 py-1 min-h-[32px] border rounded text-xs font-mono transition cursor-pointer whitespace-nowrap shrink-0 ${
                  isExportMenuOpen
                    ? 'bg-orange-500/20 border-orange-500/70 text-orange-100'
                    : 'bg-zinc-900/75 hover:bg-zinc-800/85 border-zinc-700/80 hover:border-zinc-600 text-zinc-300'
                }`}
                title="Export or import project"
                aria-expanded={isExportMenuOpen}
                aria-haspopup="true"
              >
                <Download className="w-3.5 h-3.5 text-orange-400" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown
                  className={`w-3 h-3 text-zinc-400 transition-transform ${
                    isExportMenuOpen ? 'rotate-180 text-orange-400' : ''
                  }`}
                />
              </button>

              {isExportMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-48 glass-menu border border-zinc-600/80 rounded-lg z-50 p-1 font-mono text-xs space-y-0.5 animate-panel-in">
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      setIsGitHubModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-zinc-200 hover:text-white hover:bg-orange-500/15 rounded transition cursor-pointer"
                  >
                    <FolderGit2 className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                    <span>Deploy to GitHub</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      setIsWebExportOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    <span>Web HTML / ZIP</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      handleExport();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    <span>JSON Backup</span>
                  </button>

                  <div className="border-t border-zinc-700/70 my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    <span>Import JSON</span>
                  </button>
                </div>
              )}
            </div>

            {/* Collapse Header Button */}
            <button
              type="button"
              onClick={toggleHeader}
              className="w-7 h-7 flex items-center justify-center rounded border border-transparent text-zinc-400 hover:text-orange-300 hover:bg-zinc-800/70 hover:border-zinc-700/70 transition cursor-pointer"
              title="Collapse top bar for larger canvas"
              aria-label="Collapse top bar"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          </div>
        </header>
      )}

      {/* Import Confirmation Dialog */}
      {importCandidate && (
        <div className="p-3 bg-zinc-900/95 border-b border-amber-900/60 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between z-30 font-mono text-xs text-zinc-200 gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div>
              <span className="font-semibold text-amber-300">Replace current workspace?</span>{' '}
              Imports {importCandidate.projects.length} project(s), {importCandidate.blocks.length}{' '}
              block(s). Existing local data will be replaced.
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleConfirmImport}
              className="flex-1 sm:flex-initial px-4 py-2 min-h-[40px] bg-amber-950/90 hover:bg-amber-900 border border-amber-700 text-amber-200 rounded text-xs font-semibold transition cursor-pointer"
            >
              Confirm & Replace
            </button>
            <button
              type="button"
              onClick={() => setImportCandidate(null)}
              className="flex-1 sm:flex-initial px-3 py-2 min-h-[40px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Import Error Banner */}
      {importError && (
        <div className="p-3 bg-red-950/60 border-b border-red-900/80 flex items-center justify-between z-30 font-mono text-xs text-red-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{importError}</span>
          </div>
          <button
            type="button"
            onClick={() => setImportError(null)}
            className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-200 rounded cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Primary View: Project Hierarchy + Spatial Canvas */}
      <main className="flex-1 flex min-w-0 overflow-hidden relative">
        {/* Desktop Left Project Hierarchy Sidebar */}
        <div
          className={`hidden md:flex h-full flex-shrink-0 transition-all duration-200 ${
            isSidebarCollapsed ? 'w-0 overflow-hidden' : 'w-64'
          }`}
        >
          <ProjectSidebar />
        </div>

        {/* Mobile Project Hierarchy Drawer */}
        <div className="md:hidden">
          {!isSidebarCollapsed && (
            <div className="fixed inset-0 z-50 flex">
              <div
                className="fixed inset-0 bg-black/75 backdrop-blur-xs"
                onClick={toggleSidebar}
                aria-label="Close Sidebar"
              />
              <div className="relative z-50 w-[85vw] max-w-[300px] h-full glass-panel border-r border-zinc-700/80 shadow-2xl safe-top safe-bottom flex flex-col">
                <ProjectSidebar />
              </div>
            </div>
          )}
        </div>

        {/* Spatial Canvas & Focus Mode Hero View */}
        <div className="flex-1 relative overflow-hidden flex pb-13 md:pb-0">
          {/* Floating Restore Controls when Header or Right Inspector are collapsed */}
          {(isHeaderCollapsed || (isSidebarCollapsed && !focusedBlockId)) && (
            <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 glass-menu border border-zinc-700/80 rounded-lg p-1 font-mono text-xs animate-panel-in">
              {isHeaderCollapsed && (
                <button
                  type="button"
                  onClick={toggleHeader}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-zinc-200 hover:text-white hover:bg-orange-500/15 transition cursor-pointer"
                  title="Expand top bar"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  <span className="font-semibold tracking-wider">TETHER</span>
                  <ChevronDown className="w-3.5 h-3.5 text-orange-400" />
                </button>
              )}

              {isSidebarCollapsed && (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800/80 transition cursor-pointer"
                  title="Show hierarchy sidebar"
                >
                  <PanelLeft className="w-3.5 h-3.5 text-orange-400" />
                  <span>Hierarchy</span>
                </button>
              )}
            </div>
          )}

          {showRightInspector && isBlockInspectorCollapsed && (
            <button
              type="button"
              onClick={toggleBlockInspector}
              className="hidden md:flex absolute top-3 right-3 z-20 items-center gap-1.5 px-2.5 py-1.5 glass-menu border border-zinc-700/80 hover:border-orange-500/60 rounded-lg text-xs font-mono text-zinc-200 hover:text-white transition cursor-pointer animate-panel-in"
              title="Expand Block Details"
            >
              <PanelRight className="w-3.5 h-3.5 text-orange-400" />
              <span>Details</span>
            </button>
          )}

          <div
            className={`flex-1 relative h-full overflow-hidden transition-opacity duration-200 ${
              focusedBlockId ? 'opacity-10 pointer-events-none' : 'opacity-100'
            }`}
          >
            <BlockCanvas />
          </div>

          {focusedBlockId && (
            <HeroBlockView
              onToggleInspector={() => setIsHeroInspectorOpen((prev) => !prev)}
              isInspectorOpen={isHeroInspectorOpen}
            />
          )}

          {/* Desktop Selected Block Inspector (collapsible) */}
          {showRightInspector && !isBlockInspectorCollapsed && (
            <div className="hidden md:flex h-full flex-shrink-0">
              <BlockInspector />
            </div>
          )}

          {/* Mobile Selected Block Inspector Drawer */}
          {showRightInspector && (
            <div className="md:hidden">
              <div className="fixed inset-0 z-50 flex justify-end">
                <div
                  className="fixed inset-0 bg-black/75 backdrop-blur-xs"
                  onClick={() => {
                    if (focusedBlockId) setIsHeroInspectorOpen(false);
                    else useWorkspaceStore.getState().selectBlock(null);
                  }}
                  aria-label="Close Inspector"
                />
                <div className="relative z-50 w-[88vw] max-w-[340px] h-full glass-panel border-l border-zinc-700/80 shadow-2xl safe-top safe-bottom flex flex-col">
                  <BlockInspector />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Pop-Up Editor Overlay Modal (activates only when editing a block) */}
      {isEditorOpen && activeEditorBlockId && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 md:p-6"
          onClick={closeEditorModal}
          role="dialog"
          aria-modal="true"
          aria-label="Block Code Editor"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full h-full sm:w-[96vw] sm:max-w-5xl sm:h-[88vh] glass-menu border-0 sm:border sm:border-zinc-600/80 sm:border-t-orange-500/75 sm:rounded-xl flex overflow-hidden animate-panel-in"
          >
            <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
              <CodeEditorWorkspace onClose={closeEditorModal} />
            </div>

            {!isInspectorCollapsed && (
              <div className="hidden md:flex h-full flex-shrink-0">
                <ContextInspector />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      <WorkspaceStatusBar />

      {/* Standalone Web HTML / ZIP Export Modal */}
      <WebHtmlExportModal
        isOpen={isWebExportOpen}
        onClose={() => setIsWebExportOpen(false)}
        onOpenGitHubDeploy={() => {
          setIsWebExportOpen(false);
          setIsGitHubModalOpen(true);
        }}
      />

      {/* GitHub Connection & Repository Deployment Modal */}
      <GitHubDeployModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        onSessionChange={(info) => setGithubSession(info)}
      />
    </div>
  );
}
