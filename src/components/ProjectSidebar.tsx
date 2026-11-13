'use client';

import React, { useState, useMemo } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { FileTreeNode, type TreeNodeItem } from './explorer/FileTreeNode';
import type { Block, CodeBlockData, FileBlockData } from '../types/model';
import {
  Folder,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Search,
  FilePlus,
  ChevronsDown,
  ChevronsUp,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
} from 'lucide-react';

export function ProjectSidebar() {
  const projects = useWorkspaceStore((s) => s.projects);
  const groups = useWorkspaceStore((s) => s.groups);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeGroupId = useWorkspaceStore((s) => s.activeGroupId);
  const selectedBlockId = useWorkspaceStore((s) => s.selectedBlockId);
  const isSidebarCollapsed = useWorkspaceStore((s) => s.isSidebarCollapsed);

  const createProject = useWorkspaceStore((s) => s.createProject);
  const renameProject = useWorkspaceStore((s) => s.renameProject);
  const deleteProject = useWorkspaceStore((s) => s.deleteProject);

  const createGroup = useWorkspaceStore((s) => s.createGroup);
  const renameGroup = useWorkspaceStore((s) => s.renameGroup);
  const deleteGroup = useWorkspaceStore((s) => s.deleteGroup);

  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);
  const setActiveGroup = useWorkspaceStore((s) => s.setActiveGroup);
  const selectBlock = useWorkspaceStore((s) => s.selectBlock);
  const requestFocusViewport = useWorkspaceStore((s) => s.requestFocusViewport);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const copyBlockForEdit = useWorkspaceStore((s) => s.copyBlockForEdit);
  const createBlock = useWorkspaceStore((s) => s.createBlock);
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const deleteBlock = useWorkspaceStore((s) => s.deleteBlock);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);

  // Project & Group editing states
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editProjectName, setEditProjectName] = useState('');
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<string | null>(null);

  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);

  // Hierarchy tree states
  const [filterQuery, setFilterQuery] = useState('');
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<Set<string>>(new Set());
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileKind, setNewFileKind] = useState<'code' | 'text'>('code');
  const [renamingBlock, setRenamingBlock] = useState<Block | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingBlock, setDeletingBlock] = useState<Block | null>(null);

  // Independently collapsible sidebar sections
  const [isProjectsExpanded, setIsProjectsExpanded] = useState(true);
  const [isGroupsExpanded, setIsGroupsExpanded] = useState(true);
  const [isHierarchyExpanded, setIsHierarchyExpanded] = useState(true);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeProjectGroups = groups.filter((g) => g.projectId === activeProjectId);

  // Build hierarchical tree for active project (showing active group blocks or all project blocks)
  const { treeData, allFolderPaths, matchCount } = useMemo(() => {
    if (!activeProjectId) {
      return { treeData: [], allFolderPaths: new Set<string>(), matchCount: 0 };
    }

    const scopedBlocks = blocks.filter(
      (b) =>
        b.projectId === activeProjectId &&
        (!activeGroupId || b.groupId === activeGroupId)
    );
    const query = filterQuery.trim().toLowerCase();

    const rootItems: TreeNodeItem[] = [];
    const folderMap = new Map<string, TreeNodeItem>();
    const folderPaths = new Set<string>();
    let matches = 0;

    const getOrCreateFolder = (
      currPath: string,
      seg: string,
      parent: TreeNodeItem | null
    ): TreeNodeItem => {
      folderPaths.add(currPath);
      let folderItem = folderMap.get(currPath);
      if (!folderItem) {
        folderItem = {
          id: `folder-${currPath}`,
          name: seg,
          isFolder: true,
          path: currPath,
          children: [],
        };
        folderMap.set(currPath, folderItem);
        if (parent) {
          parent.children?.push(folderItem);
        } else {
          rootItems.push(folderItem);
        }
      }
      return folderItem;
    };

    scopedBlocks.forEach((b) => {
      let rawPath =
        b.sourcePath ||
        (b.data as CodeBlockData | FileBlockData)?.path ||
        b.title;
      rawPath = rawPath.replace(/^\/+/, '');
      const segments = rawPath.split('/');

      if (segments.length === 1) {
        const fileName = segments[0];
        const isMatch =
          !query ||
          fileName.toLowerCase().includes(query) ||
          rawPath.toLowerCase().includes(query);
        if (isMatch) {
          if (query) matches++;
          rootItems.push({
            id: b.id,
            name: fileName,
            isFolder: false,
            path: rawPath,
            block: b,
          });
        }
      } else {
        const fileName = segments[segments.length - 1];
        const isMatch =
          !query ||
          fileName.toLowerCase().includes(query) ||
          rawPath.toLowerCase().includes(query);
        if (isMatch) {
          if (query) matches++;
          let currPath = '';
          let parentFolder: TreeNodeItem | null = null;
          for (let i = 0; i < segments.length - 1; i++) {
            const seg = segments[i];
            currPath = currPath ? `${currPath}/${seg}` : seg;
            parentFolder = getOrCreateFolder(currPath, seg, parentFolder);
          }

          const fileNode: TreeNodeItem = {
            id: b.id,
            name: fileName,
            isFolder: false,
            path: rawPath,
            block: b,
          };

          if (parentFolder) {
            parentFolder.children?.push(fileNode);
          } else {
            rootItems.push(fileNode);
          }
        }
      }
    });

    const sortTree = (items: TreeNodeItem[]) => {
      items.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      items.forEach((item) => {
        if (item.isFolder && item.children) {
          sortTree(item.children);
        }
      });
    };

    sortTree(rootItems);

    return {
      treeData: rootItems,
      allFolderPaths: folderPaths,
      matchCount: query ? matches : scopedBlocks.length,
    };
  }, [blocks, activeProjectId, activeGroupId, filterQuery]);

  const isFiltering = Boolean(filterQuery.trim());
  const expandedFolders = useMemo(() => {
    if (isFiltering) return allFolderPaths;
    const expanded = new Set<string>();
    allFolderPaths.forEach((path) => {
      if (!collapsedFolderPaths.has(path)) expanded.add(path);
    });
    return expanded;
  }, [allFolderPaths, collapsedFolderPaths, isFiltering]);

  const handleToggleFolder = (path: string) => {
    setCollapsedFolderPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const areFoldersCollapsed = collapsedFolderPaths.size > 0;
  const handleToggleExpandAll = () => {
    if (collapsedFolderPaths.size > 0) setCollapsedFolderPaths(new Set());
    else setCollapsedFolderPaths(new Set(allFolderPaths));
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    const proj = await createProject(newProjectName.trim());
    await createGroup(proj.id, 'Main');
    setNewProjectName('');
    setIsCreatingProject(false);
  };

  const handleSaveRenameProject = async (id: string) => {
    if (editProjectName.trim()) {
      await renameProject(id, editProjectName.trim());
    }
    setEditingProjectId(null);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProjectId || !newGroupName.trim()) return;
    await createGroup(activeProjectId, newGroupName.trim());
    setNewGroupName('');
    setIsCreatingGroup(false);
  };

  const handleSaveRenameGroup = async (id: string) => {
    if (editGroupName.trim()) {
      await renameGroup(id, editGroupName.trim());
    }
    setEditingGroupId(null);
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilePath.trim() || !activeProjectId) return;

    const rawInput = newFilePath.trim().replace(/^\/+/, '');
    const segments = rawInput.split('/');
    const cleanTitle = segments[segments.length - 1];

    const isCode = newFileKind === 'code' || cleanTitle.includes('.');
    const defaultGroup = groups.find((g) => g.projectId === activeProjectId);
    const targetGroupId = activeGroupId || defaultGroup?.id || 'default';
    const existingCount = blocks.filter(
      (b) => b.projectId === activeProjectId && b.groupId === targetGroupId
    ).length;

    const created = await createBlock({
      projectId: activeProjectId,
      groupId: targetGroupId,
      kind: isCode ? 'code' : 'text',
      title: cleanTitle,
      x: 100 + (existingCount % 3) * 340,
      y: 80 + Math.floor(existingCount / 3) * 240,
      data: isCode
        ? {
            path: rawInput,
            language: cleanTitle.endsWith('.json')
              ? 'json'
              : cleanTitle.endsWith('.ts') || cleanTitle.endsWith('.tsx')
              ? 'typescript'
              : cleanTitle.endsWith('.html')
              ? 'html'
              : cleanTitle.endsWith('.css')
              ? 'css'
              : 'javascript',
            currentContent: `// ${cleanTitle}\n\nexport function main() {\n  return true;\n}\n`,
            revisions: [],
          }
        : { content: `# ${cleanTitle}\n` },
    });

    if (segments.length > 1) {
      const parentFolder = segments.slice(0, -1).join('/');
      setCollapsedFolderPaths((prev) => {
        const next = new Set(prev);
        next.delete(parentFolder);
        return next;
      });
    }

    openBlockInEditor(created.id);
    setNewFilePath('');
    setIsCreatingFile(false);
  };

  const handleSaveRename = async () => {
    if (renamingBlock && renameValue.trim()) {
      const nextTitle = renameValue.trim();
      const oldPath =
        renamingBlock.sourcePath ||
        (renamingBlock.data as { path?: string })?.path ||
        renamingBlock.title;
      const parts = oldPath.replace(/^\/+/, '').split('/');
      const nextPath =
        parts.length > 1 ? `${parts.slice(0, -1).join('/')}/${nextTitle}` : nextTitle;
      await updateBlock(renamingBlock.id, { title: nextTitle, sourcePath: nextPath });
    }
    setRenamingBlock(null);
  };

  const handleSelectTreeBlock = (blockId: string) => {
    selectBlock(blockId);
    requestFocusViewport(blockId);
    if (typeof window !== 'undefined' && window.innerWidth < 768 && !isSidebarCollapsed) {
      toggleSidebar();
    }
  };

  return (
    <aside
      className="w-full sm:w-64 flex-shrink-0 glass-panel border-r border-zinc-700/75 flex flex-col h-full select-none text-zinc-300"
      aria-label="Project Hierarchy"
    >
      {/* Mobile Drawer Header */}
      <div className="md:hidden h-12 px-3 border-b border-zinc-700/75 flex items-center justify-between glass-header">
        <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-100 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          <span>Project Hierarchy</span>
        </span>
        <button
          type="button"
          onClick={toggleSidebar}
          className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded transition cursor-pointer"
          aria-label="Close Sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Desktop Sidebar Header */}
      <div className="hidden md:flex h-10 px-3 border-b border-zinc-700/75 items-center justify-between glass-header flex-shrink-0">
        <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-200 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          <span>Workspace</span>
        </span>
        <button
          type="button"
          onClick={toggleSidebar}
          className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-orange-300 hover:bg-zinc-800/80 rounded transition cursor-pointer"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Top Section: Projects & Groups */}
      <div className="px-3 py-2 border-b border-zinc-700/65 space-y-2 bg-zinc-950/35 flex-shrink-0">
        {/* Projects */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <button
              type="button"
              onClick={() => setIsProjectsExpanded((prev) => !prev)}
              className="flex items-center gap-1 text-[11px] font-mono tracking-wider text-zinc-400 hover:text-zinc-200 uppercase font-medium cursor-pointer"
              aria-expanded={isProjectsExpanded}
            >
              {isProjectsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
              )}
              <span>Projects</span>
              <span className="text-[10px] text-zinc-500 tabular-nums">({projects.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsProjectsExpanded(true);
                setIsCreatingProject(true);
                setNewProjectName('');
              }}
              className="text-zinc-400 hover:text-orange-300 w-7 h-7 flex items-center justify-center hover:bg-orange-500/15 rounded transition cursor-pointer"
              title="Create new project"
              aria-label="Create new project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {isProjectsExpanded && isCreatingProject && (
            <form onSubmit={handleCreateProject} className="mb-1.5">
              <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1">
                <input
                  type="text"
                  autoFocus
                  placeholder="Project name..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full bg-transparent text-base sm:text-xs text-zinc-200 outline-none placeholder:text-zinc-600 font-mono"
                />
                <button
                  type="submit"
                  className="w-7 h-7 flex items-center justify-center text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  aria-label="Save project"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingProject(false)}
                  className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  aria-label="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          )}

          {isProjectsExpanded && (
            <div className="space-y-0.5 max-h-28 overflow-y-auto">
            {projects.map((proj) => {
              const isActive = proj.id === activeProjectId;
              const isEditing = editingProjectId === proj.id;
              const isConfirmingDelete = confirmDeleteProjectId === proj.id;

              if (isEditing) {
                return (
                  <div
                    key={proj.id}
                    className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={editProjectName}
                      onChange={(e) => setEditProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRenameProject(proj.id);
                        if (e.key === 'Escape') setEditingProjectId(null);
                      }}
                      className="w-full bg-transparent text-xs text-zinc-200 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveRenameProject(proj.id)}
                      className="text-emerald-400 p-0.5 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingProjectId(null)}
                      className="text-zinc-400 p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }

              if (isConfirmingDelete) {
                return (
                  <div
                    key={proj.id}
                    className="p-2 bg-red-950/40 border border-red-900/60 rounded text-xs space-y-1.5"
                  >
                    <div className="text-red-300 font-medium truncate">
                      Delete &ldquo;{proj.name}&rdquo;?
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          deleteProject(proj.id);
                          setConfirmDeleteProjectId(null);
                        }}
                        className="px-2 py-0.5 bg-red-800 hover:bg-red-700 text-red-100 rounded text-xs cursor-pointer"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteProjectId(null)}
                        className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={proj.id}
                  onClick={() => setActiveProject(proj.id)}
                  className={`group flex items-center justify-between px-2 py-1 rounded text-xs cursor-pointer transition border ${
                    isActive
                      ? 'bg-orange-500/12 border-orange-500/45 text-zinc-100 font-medium'
                      : 'border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Folder className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-orange-400' : 'text-zinc-400'}`} />
                    <span className="truncate">{proj.name}</span>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProjectId(proj.id);
                        setEditProjectName(proj.name);
                      }}
                      className="p-1 hover:text-zinc-200 rounded cursor-pointer"
                      aria-label="Rename project"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteProjectId(proj.id);
                      }}
                      className="p-1 hover:text-red-400 rounded cursor-pointer"
                      aria-label="Delete project"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>

        {/* Tether Groups */}
        {activeProject && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <button
                type="button"
                onClick={() => setIsGroupsExpanded((prev) => !prev)}
                className="flex items-center gap-1 text-[11px] font-mono tracking-wider text-zinc-400 hover:text-zinc-200 uppercase font-medium cursor-pointer"
                aria-expanded={isGroupsExpanded}
              >
                {isGroupsExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                )}
                <span>Groups</span>
                <span className="text-[10px] text-zinc-500 tabular-nums">({activeProjectGroups.length})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsGroupsExpanded(true);
                  setIsCreatingGroup(true);
                  setNewGroupName('');
                }}
                className="text-zinc-400 hover:text-orange-300 w-7 h-7 flex items-center justify-center hover:bg-orange-500/15 rounded transition cursor-pointer"
                title="Create tether group"
                aria-label="Create tether group"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {isGroupsExpanded && isCreatingGroup && (
              <form onSubmit={handleCreateGroup} className="mb-1.5">
                <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Group name..."
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="w-full bg-transparent text-base sm:text-xs text-zinc-200 outline-none placeholder:text-zinc-600 font-mono"
                  />
                  <button
                    type="submit"
                    className="w-7 h-7 flex items-center justify-center text-emerald-400 cursor-pointer"
                    aria-label="Save group"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingGroup(false)}
                    className="w-7 h-7 flex items-center justify-center text-zinc-400 cursor-pointer"
                    aria-label="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            )}

            {isGroupsExpanded && (
              <div className="space-y-0.5 max-h-28 overflow-y-auto">
              {activeProjectGroups.map((grp) => {
                const isActive = grp.id === activeGroupId;
                const isEditing = editingGroupId === grp.id;
                const isConfirmingDelete = confirmDeleteGroupId === grp.id;
                const count = blocks.filter(
                  (b) => b.projectId === activeProjectId && b.groupId === grp.id
                ).length;

                if (isEditing) {
                  return (
                    <div
                      key={grp.id}
                      className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRenameGroup(grp.id);
                          if (e.key === 'Escape') setEditingGroupId(null);
                        }}
                        className="w-full bg-transparent text-xs text-zinc-200 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRenameGroup(grp.id)}
                        className="text-emerald-400 p-0.5 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingGroupId(null)}
                        className="text-zinc-400 p-0.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                }

                if (isConfirmingDelete) {
                  return (
                    <div
                      key={grp.id}
                      className="p-2 bg-red-950/40 border border-red-900/60 rounded text-xs space-y-1.5"
                    >
                      <div className="text-red-300 font-medium truncate">
                        Delete &ldquo;{grp.name}&rdquo;?
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            deleteGroup(grp.id);
                            setConfirmDeleteGroupId(null);
                          }}
                          className="px-2 py-0.5 bg-red-800 hover:bg-red-700 text-red-100 rounded text-xs cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteGroupId(null)}
                          className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={grp.id}
                    onClick={() => setActiveGroup(grp.id)}
                    className={`group flex items-center justify-between px-2 py-1 rounded text-xs cursor-pointer transition border ${
                      isActive
                        ? 'bg-orange-500/12 border-orange-500/45 text-zinc-100 font-medium'
                        : 'border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: grp.color }}
                      />
                      <span className="truncate">{grp.name}</span>
                      <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                        {count}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGroupId(grp.id);
                          setEditGroupName(grp.name);
                        }}
                        className="p-1 hover:text-zinc-200 rounded cursor-pointer"
                        aria-label="Rename group"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteGroupId(grp.id);
                        }}
                        className="p-1 hover:text-red-400 rounded cursor-pointer"
                        aria-label="Delete group"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hierarchy Tree Header */}
      <div className="h-9 px-3 border-b border-zinc-700/65 flex items-center justify-between text-xs bg-zinc-950/35 flex-shrink-0">
        <button
          type="button"
          onClick={() => setIsHierarchyExpanded((prev) => !prev)}
          className="flex items-center gap-1 font-mono tracking-wider text-zinc-300 hover:text-white uppercase text-[11px] font-medium cursor-pointer"
          aria-expanded={isHierarchyExpanded}
        >
          {isHierarchyExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
          )}
          <span>Hierarchy</span>
          <span className="text-[10px] text-zinc-500 tabular-nums">({matchCount})</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setIsHierarchyExpanded(true);
              setIsCreatingFile(true);
              setNewFilePath('');
            }}
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-orange-300 hover:bg-orange-500/15 rounded transition cursor-pointer"
            title="New block or folder path"
            aria-label="New block"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleToggleExpandAll}
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded transition cursor-pointer"
            title={areFoldersCollapsed ? 'Expand all folders' : 'Collapse all folders'}
            aria-label={areFoldersCollapsed ? 'Expand all folders' : 'Collapse all folders'}
          >
            {areFoldersCollapsed ? (
              <ChevronsDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronsUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Tree Filter */}
      {isHierarchyExpanded && (
        <div className="px-2.5 py-1.5 border-b border-zinc-700/65 flex-shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter hierarchy..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFilterQuery('');
              }}
              className="w-full bg-zinc-950/70 border border-zinc-700/80 focus:border-orange-500/75 rounded pl-7 pr-10 py-1 text-base sm:text-xs text-zinc-100 placeholder:text-zinc-500 outline-none transition"
            />
            {filterQuery && (
              <div className="absolute right-1.5 flex items-center gap-1">
                <span className="text-[10px] font-mono text-orange-300 tabular-nums">{matchCount}</span>
                <button
                  type="button"
                  onClick={() => setFilterQuery('')}
                  className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded cursor-pointer"
                  aria-label="Clear filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inline Create File/Path */}
      {isHierarchyExpanded && isCreatingFile && (
        <form onSubmit={handleCreateFile} className="p-2 bg-zinc-900/70 border-b border-zinc-700/80 space-y-1.5 flex-shrink-0">
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
            <span>New Path</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setNewFileKind('code')}
                className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                  newFileKind === 'code' ? 'bg-orange-500/20 text-orange-200 border border-orange-500/40' : 'text-zinc-400'
                }`}
              >
                Code
              </button>
              <button
                type="button"
                onClick={() => setNewFileKind('text')}
                className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                  newFileKind === 'text' ? 'bg-orange-500/20 text-orange-200 border border-orange-500/40' : 'text-zinc-400'
                }`}
              >
                Note
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-700 focus-within:border-orange-500/70 rounded px-2 py-1">
            <input
              type="text"
              autoFocus
              placeholder="e.g. src/utils.ts"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              className="w-full bg-transparent text-base sm:text-xs text-zinc-100 outline-none placeholder:text-zinc-600 font-mono"
            />
            <button type="submit" className="text-emerald-400 p-1 cursor-pointer" aria-label="Create">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsCreatingFile(false)}
              className="text-zinc-400 p-1 cursor-pointer"
              aria-label="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      )}

      {/* Hierarchy Tree */}
      {isHierarchyExpanded ? (
        <div role="tree" aria-label="Group hierarchy" className="flex-1 overflow-y-auto px-1 py-1.5 pb-20 md:pb-4 space-y-0.5">
          {treeData.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500 font-mono">
              {filterQuery ? 'No matching blocks.' : 'No blocks in this group.'}
            </div>
          ) : (
            treeData.map((node) => (
              <FileTreeNode
                key={node.id}
                item={node}
                level={0}
                activeId={selectedBlockId}
                filterQuery={filterQuery}
                expandedFolders={expandedFolders}
                onToggleFolder={handleToggleFolder}
                onSelect={handleSelectTreeBlock}
                onEdit={(id) => openBlockInEditor(id)}
                onRename={(block) => {
                  setRenamingBlock(block);
                  setRenameValue(block.title);
                }}
                onDuplicate={(block) => copyBlockForEdit(block.id)}
                onDelete={(block) => setDeletingBlock(block)}
                onCreateFileInFolder={(folderPath) => {
                  setNewFilePath(`${folderPath}/`);
                  setIsCreatingFile(true);
                }}
              />
            ))
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Inline Rename Prompt */}
      {renamingBlock && (
        <div className="p-2.5 bg-[#161920] border-t border-zinc-800 space-y-1.5 flex-shrink-0">
          <div className="text-[11px] font-mono text-zinc-400 truncate">
            Rename &ldquo;{renamingBlock.title}&rdquo;
          </div>
          <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1">
            <input
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename();
                if (e.key === 'Escape') setRenamingBlock(null);
              }}
              className="w-full bg-transparent text-base sm:text-xs text-zinc-100 outline-none font-mono"
            />
            <button type="button" onClick={handleSaveRename} className="text-emerald-400 p-1 cursor-pointer">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => setRenamingBlock(null)} className="text-zinc-400 p-1 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Inline Delete Prompt */}
      {deletingBlock && (
        <div className="p-2.5 bg-red-950/40 border-t border-red-900/60 text-xs space-y-2 flex-shrink-0">
          <div className="text-red-300 font-medium truncate">Delete {deletingBlock.title}?</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                await deleteBlock(deletingBlock.id);
                setDeletingBlock(null);
              }}
              className="px-3 py-1 bg-red-800 hover:bg-red-700 text-red-100 rounded text-xs font-medium cursor-pointer flex-1"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setDeletingBlock(null)}
              className="px-3 py-1 bg-zinc-800 text-zinc-300 rounded text-xs cursor-pointer flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
