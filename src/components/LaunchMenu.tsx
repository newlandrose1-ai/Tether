'use client';

import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Folder,
  FolderPlus,
  Layers,
  Upload,
  X,
} from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { validateWorkspaceExport } from '../lib/exportImport';

export function LaunchMenu() {
  const projects = useWorkspaceStore((s) => s.projects);
  const groups = useWorkspaceStore((s) => s.groups);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const lastExitedAt = useWorkspaceStore((s) => s.lastExitedAt);
  const enterWorkspace = useWorkspaceStore((s) => s.enterWorkspace);
  const createProject = useWorkspaceStore((s) => s.createProject);
  const createGroup = useWorkspaceStore((s) => s.createGroup);
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);
  const importWorkspace = useWorkspaceStore((s) => s.importWorkspace);

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [showExitNotice, setShowExitNotice] = useState(() => Boolean(lastExitedAt));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;

  const activeProjectBlockCount = activeProject
    ? blocks.filter((b) => b.projectId === activeProject.id).length
    : 0;

  const activeProjectGroupCount = activeProject
    ? groups.filter((g) => g.projectId === activeProject.id).length
    : 0;

  const handleEnter = () => {
    enterWorkspace(activeProject?.id);
  };

  const handleCreateAndEnter = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    const created = await createProject(trimmed);
    await createGroup(created.id, 'Main');
    setNewProjectName('');
    setIsCreatingProject(false);
    enterWorkspace(created.id);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result ?? ''));
        const validation = validateWorkspaceExport(parsed);
        if (!validation.valid) {
          setImportError(validation.error);
          return;
        }
        await importWorkspace(validation.data);
        enterWorkspace();
      } catch {
        setImportError('Selected file is not a valid Tether JSON backup.');
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read the selected backup file.');
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <main
      className="relative min-h-screen w-screen bg-[#090B0E] text-zinc-100 flex items-center justify-center p-4 sm:p-6 overflow-y-auto select-none"
      aria-label="Tether App Launch Menu"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleImportFile}
        className="hidden"
      />

      {/* Subtle ambient background accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(249,115,22,0.10),transparent_55%)]"
      />

      <motion.section
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md glass-menu border border-zinc-700/80 border-t-orange-500/80 rounded-xl p-6 space-y-5 shadow-2xl font-mono"
      >
        {/* Brand & Brief Summary */}
        <header className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.75)]" />
              <h1 className="text-sm font-semibold tracking-widest text-zinc-100 uppercase">
                Tether
              </h1>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded border border-zinc-700/80 bg-zinc-900/80 text-zinc-400">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </span>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed font-sans">
            Modular code blocks, tethered file trees, and instant project packaging.
          </p>
        </header>

        {/* Graceful Exit Confirmation Notice */}
        {showExitNotice && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-950/35 border border-emerald-700/50 text-[11px] text-emerald-200"
          >
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">Exited workspace cleanly. Local data preserved.</span>
            </div>
            <button
              type="button"
              onClick={() => setShowExitNotice(false)}
              className="text-emerald-300/75 hover:text-emerald-100 p-0.5 rounded cursor-pointer shrink-0"
              aria-label="Dismiss exit notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Primary Launch Action */}
        <div className="space-y-2.5">
          {activeProject && (
            <div className="px-3 py-2.5 rounded-lg bg-zinc-900/70 border border-zinc-800/90 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Folder className="w-4 h-4 text-orange-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-zinc-100 font-semibold truncate">
                    {activeProject.name}
                  </div>
                  <div className="text-[11px] text-zinc-400 tabular-nums">
                    {activeProjectGroupCount} {activeProjectGroupCount === 1 ? 'group' : 'groups'} ·{' '}
                    {activeProjectBlockCount} {activeProjectBlockCount === 1 ? 'block' : 'blocks'}
                  </div>
                </div>
              </div>

              {projects.length > 1 && (
                <select
                  aria-label="Select project to open"
                  value={activeProject.id}
                  onChange={(e) => setActiveProject(e.target.value)}
                  className="bg-zinc-950 border border-zinc-700/80 hover:border-orange-500/60 focus:border-orange-500 rounded px-2 py-1 text-[11px] text-zinc-200 outline-none cursor-pointer max-w-[130px]"
                >
                  {projects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleEnter}
            className="w-full py-2.5 px-4 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/75 text-orange-100 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer shadow-sm"
          >
            <Layers className="w-4 h-4 text-orange-400" />
            <span>{activeProject ? 'Open Workspace & Canvas' : 'Enter Workspace'}</span>
            <ArrowRight className="w-3.5 h-3.5 text-orange-300" />
          </button>
        </div>

        {/* Brief Quick Start Options */}
        <div className="pt-3 border-t border-zinc-800/90 space-y-2.5">
          {isCreatingProject ? (
            <form onSubmit={handleCreateAndEnter} className="flex items-center gap-1.5">
              <input
                type="text"
                autoFocus
                aria-label="New project name"
                placeholder="New project name..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsCreatingProject(false);
                    setNewProjectName('');
                  }
                }}
                className="flex-1 bg-zinc-950 border border-zinc-700 focus:border-orange-500 rounded-md px-2.5 py-1.5 text-base sm:text-xs text-zinc-100 placeholder:text-zinc-500 outline-none"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 bg-emerald-900/80 hover:bg-emerald-800 border border-emerald-600/80 text-emerald-100 rounded-md text-xs flex items-center gap-1 cursor-pointer"
                aria-label="Create and open project"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Create</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingProject(false);
                  setNewProjectName('');
                }}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md cursor-pointer"
                aria-label="Cancel new project"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsCreatingProject(true)}
                className="py-2 px-3 rounded-lg bg-zinc-900/75 hover:bg-zinc-800/85 border border-zinc-700/80 hover:border-zinc-600 text-zinc-200 hover:text-white text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span>New Project</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="py-2 px-3 rounded-lg bg-zinc-900/75 hover:bg-zinc-800/85 border border-zinc-700/80 hover:border-zinc-600 text-zinc-200 hover:text-white text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>Import Backup</span>
              </button>
            </div>
          )}

          {importError && (
            <p role="alert" className="text-[11px] text-red-300 bg-red-950/40 border border-red-900/60 rounded px-2.5 py-1.5">
              {importError}
            </p>
          )}
        </div>
      </motion.section>
    </main>
  );
}
