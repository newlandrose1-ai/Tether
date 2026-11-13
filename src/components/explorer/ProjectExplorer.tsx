'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { FileTreeNode, type TreeNodeItem } from './FileTreeNode';
import type { Block, CodeBlockData, FileBlockData } from '../../types/model';
import {
  Search,
  FilePlus,
  FolderPlus,
  FolderOpen,
  Folder,
  X,
  Check,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
} from 'lucide-react';

export function ProjectExplorer() {
  const projects = useWorkspaceStore((s) => s.projects);
  const groups = useWorkspaceStore((s) => s.groups);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeGroupId = useWorkspaceStore((s) => s.activeGroupId);
  const activeEditorBlockId = useWorkspaceStore((s) => s.activeEditorBlockId);
  const isSidebarCollapsed = useWorkspaceStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);

  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const createBlock = useWorkspaceStore((s) => s.createBlock);
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const deleteBlock = useWorkspaceStore((s) => s.deleteBlock);

  // Search/filter state
  const [filterQuery, setFilterQuery] = useState('');

  // Collapsed folders state (folders are expanded by default unless explicitly collapsed)
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<Set<string>>(new Set());

  // Modal / dialog states
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileKind, setNewFileKind] = useState<'code' | 'text'>('code');

  const [renamingBlock, setRenamingBlock] = useState<Block | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [deletingBlock, setDeletingBlock] = useState<Block | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Build hierarchical tree structure from blocks in active project
  const { treeData, allFolderPaths, matchCount } = useMemo(() => {
    if (!activeProjectId) {
      return { treeData: [], allFolderPaths: new Set<string>(), matchCount: 0 };
    }

    const projectBlocks = blocks.filter((b) => b.projectId === activeProjectId);
    const query = filterQuery.trim().toLowerCase();

    const rootItems: TreeNodeItem[] = [];
    const folderMap = new Map<string, TreeNodeItem>();
    const folderPaths = new Set<string>();
    let matches = 0;

    // Helper to get or create folder node
    const getOrCreateFolder = (currPath: string, seg: string, parent: TreeNodeItem | null): TreeNodeItem => {
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

    projectBlocks.forEach((b) => {
      let rawPath = (b.data as CodeBlockData | FileBlockData)?.path || b.title;
      rawPath = rawPath.replace(/^\/+/, '');
      const segments = rawPath.split('/');

      if (segments.length === 1) {
        // Root file
        const fileName = segments[0];
        const isMatch = !query || fileName.toLowerCase().includes(query) || rawPath.toLowerCase().includes(query);
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
        // Nested file
        const fileName = segments[segments.length - 1];
        const isMatch = !query || fileName.toLowerCase().includes(query) || rawPath.toLowerCase().includes(query);

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

    // Sort function: Folders first (A-Z), then Files (A-Z)
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
      matchCount: query ? matches : projectBlocks.length,
    };
  }, [blocks, activeProjectId, filterQuery]);

  // Derived expanded set: all folders open when searching, otherwise all minus collapsed
  const isFiltering = Boolean(filterQuery.trim());
  const expandedFolders = useMemo(() => {
    if (isFiltering) {
      return allFolderPaths;
    }
    const expanded = new Set<string>();
    allFolderPaths.forEach((path) => {
      if (!collapsedFolderPaths.has(path)) {
        expanded.add(path);
      }
    });
    return expanded;
  }, [allFolderPaths, collapsedFolderPaths, isFiltering]);

  const handleToggleFolder = (path: string) => {
    setCollapsedFolderPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path); // expand
      } else {
        next.add(path); // collapse
      }
      return next;
    });
  };

  const areFoldersCollapsed = collapsedFolderPaths.size > 0;
  const handleToggleExpandAll = () => {
    if (collapsedFolderPaths.size > 0) {
      setCollapsedFolderPaths(new Set());
    } else {
      setCollapsedFolderPaths(new Set(allFolderPaths));
    }
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

    const created = await createBlock({
      projectId: activeProjectId,
      groupId: targetGroupId,
      kind: isCode ? 'code' : 'text',
      title: cleanTitle,
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
            currentContent: `// ${cleanTitle}\n// Created in local Tether workspace\n\nexport function main() {\n  console.log("Ready.");\n}\n`,
            revisions: [],
          }
        : { content: '# ' + cleanTitle + '\n' },
    });

    // Make sure parent folder is expanded
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
      await updateBlock(renamingBlock.id, { title: renameValue.trim() });
    }
    setRenamingBlock(null);
  };

  const handleDuplicateBlock = async (block: Block) => {
    if (!activeProjectId) return;
    const dupTitle = `${block.title.replace(/(\.[^.]+)$/, '')}-copy$1`;
    const created = await createBlock({
      projectId: activeProjectId,
      groupId: block.groupId,
      kind: block.kind,
      title: dupTitle,
      data: { ...block.data },
    });
    openBlockInEditor(created.id);
  };

  const handleConfirmDelete = async () => {
    if (deletingBlock) {
      await deleteBlock(deletingBlock.id);
      setDeletingBlock(null);
    }
  };

  const handleCreateInFolder = (folderPath: string) => {
    setNewFilePath(`${folderPath}/`);
    setIsCreatingFile(true);
  };

  const handleSelectBlock = (blockId: string) => {
    openBlockInEditor(blockId);
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      if (!isSidebarCollapsed) {
        toggleSidebar();
      }
    }
  };

  return (
    <aside
      className={`flex flex-col h-full bg-[#101216] border-r border-zinc-800/80 select-none flex-shrink-0 transition-all duration-200 w-full sm:w-64`}
      role="region"
      aria-label="Project Explorer"
    >
      {/* 1. Header Toolbar */}
      <div className="h-12 sm:h-10 px-3 border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-300 bg-[#0E1013]">
        <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[11px] font-mono">
          Files
        </span>

        <div className="flex items-center gap-1">
          {/* New File */}
          <button
            type="button"
            onClick={() => {
              setIsCreatingFile(true);
              setNewFilePath('');
            }}
            className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded transition cursor-pointer"
            title="New File or Path (e.g. dir/file.ts)"
            aria-label="New File"
          >
            <FilePlus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          </button>

          {/* Toggle Expand/Collapse Folders */}
          <button
            type="button"
            onClick={handleToggleExpandAll}
            className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded transition cursor-pointer"
            title={areFoldersCollapsed ? "Expand all folders" : "Collapse all folders"}
            aria-label={areFoldersCollapsed ? "Expand all folders" : "Collapse all folders"}
          >
            {areFoldersCollapsed ? (
              <ChevronsDown className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            ) : (
              <ChevronsUp className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            )}
          </button>

          {/* Mobile Dismiss Sidebar */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="md:hidden w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded transition cursor-pointer ml-1"
            title="Close Explorer"
            aria-label="Close Explorer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Project Selector */}
      <div className="px-3 py-2 border-b border-zinc-800/60 bg-[#0E1013]">
        <select
          value={activeProjectId || ''}
          onChange={(e) => setActiveProject(e.target.value)}
          aria-label="Active Project"
          className="w-full bg-[#12151A] border border-zinc-800 focus:border-zinc-600 rounded px-2.5 py-1.5 text-base sm:text-xs text-zinc-200 outline-none cursor-pointer font-medium transition min-h-[40px] sm:min-h-0"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* 3. Compact Search & Filter Field */}
      <div className="px-3 py-2 border-b border-zinc-800/60">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-zinc-400 absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            placeholder="Search files and folders..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilterQuery('');
            }}
            className="w-full bg-[#12151A] border border-zinc-800/80 focus:border-sky-500/80 focus:bg-[#141820] rounded pl-8 pr-14 py-2 sm:py-1 text-base sm:text-xs text-zinc-100 placeholder:text-zinc-500 outline-none transition min-h-[40px] sm:min-h-0"
          />
          {filterQuery && (
            <div className="absolute right-2 flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-zinc-400">
                {matchCount}
              </span>
              <button
                type="button"
                onClick={() => setFilterQuery('')}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
                title="Clear search (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4. Inline New File / Folder Creator */}
      {isCreatingFile && (
        <form onSubmit={handleCreateFile} className="p-2.5 bg-[#141820] border-b border-zinc-800 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
            <span>New File or Path</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setNewFileKind('code')}
                className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition ${
                  newFileKind === 'code' ? 'bg-sky-950 text-sky-300 border border-sky-800' : 'text-zinc-400 hover:text-zinc-300'
                }`}
              >
                Code
              </button>
              <button
                type="button"
                onClick={() => setNewFileKind('text')}
                className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition ${
                  newFileKind === 'text' ? 'bg-sky-950 text-sky-300 border border-sky-800' : 'text-zinc-400 hover:text-zinc-300'
                }`}
              >
                Note
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-700/80 rounded px-2.5 py-1.5">
            <input
              type="text"
              autoFocus
              placeholder="e.g. components/Button.tsx"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              className="w-full bg-transparent text-base sm:text-xs text-zinc-100 outline-none placeholder:text-zinc-600 font-mono py-0.5"
            />
            <button
              type="submit"
              className="w-8 h-8 flex items-center justify-center text-emerald-400 hover:text-emerald-300 rounded cursor-pointer"
              title="Create file"
              aria-label="Create file"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsCreatingFile(false)}
              className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-300 rounded cursor-pointer"
              title="Cancel"
              aria-label="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {/* 5. Hierarchical File Tree View */}
      <div role="tree" aria-label="Project files" className="flex-1 overflow-y-auto px-1 py-1.5 space-y-0.5">
        {treeData.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-400 font-mono space-y-3">
            <p>{filterQuery ? 'No matching files found.' : 'No files in this project.'}</p>
            {!filterQuery && (
              <button
                type="button"
                onClick={() => setIsCreatingFile(true)}
                className="px-4 py-2 min-h-[44px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs transition cursor-pointer"
              >
                + Create File
              </button>
            )}
          </div>
        ) : (
          treeData.map((node) => (
            <FileTreeNode
              key={node.id}
              item={node}
              level={0}
              activeId={activeEditorBlockId}
              filterQuery={filterQuery}
              expandedFolders={expandedFolders}
              onToggleFolder={handleToggleFolder}
              onSelect={handleSelectBlock}
              onRename={(block) => {
                setRenamingBlock(block);
                setRenameValue(block.title);
              }}
              onDuplicate={handleDuplicateBlock}
              onDelete={(block) => setDeletingBlock(block)}
              onCreateFileInFolder={handleCreateInFolder}
            />
          ))
        )}
      </div>

      {/* 6. Rename Dialog Modal */}
      {renamingBlock && (
        <div className="p-3 bg-[#161920] border-t border-zinc-800 space-y-2">
          <div className="text-[11px] font-mono text-zinc-400">Rename &ldquo;{renamingBlock.title}&rdquo;</div>
          <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5">
            <input
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename();
                if (e.key === 'Escape') setRenamingBlock(null);
              }}
              className="w-full bg-transparent text-base sm:text-xs text-zinc-100 outline-none font-mono py-0.5"
            />
            <button
              type="button"
              onClick={handleSaveRename}
              className="w-8 h-8 flex items-center justify-center text-emerald-400 hover:text-emerald-300 rounded cursor-pointer"
              title="Save name"
              aria-label="Save name"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setRenamingBlock(null)}
              className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-300 rounded cursor-pointer"
              title="Cancel rename"
              aria-label="Cancel rename"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 7. Delete Confirmation Modal */}
      {deletingBlock && (
        <div className="p-3 bg-red-950/40 border-t border-red-900/60 text-xs space-y-2">
          <div className="text-red-300 font-medium">Delete {deletingBlock.title}?</div>
          <div className="text-[11px] text-red-400/80">
            This will permanently remove the block and any connected tethers.
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="px-4 py-2 min-h-[44px] bg-red-800 hover:bg-red-700 text-red-100 rounded text-xs font-semibold cursor-pointer flex-1"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setDeletingBlock(null)}
              className="px-4 py-2 min-h-[44px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs cursor-pointer flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </aside>
  );
}
