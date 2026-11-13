import { create } from 'zustand';
import {
  type Project,
  type TetherGroup,
  type Block,
  type Tether,
  type BlockKind,
  type BlockStatus,
  type BlockData,
  type BlockSandbox,
  type ProjectSnapshot,
  type PromotionRecord,
  type UploadBlockData,
  type CodeBlockData,
  type FileBlockData,
  type TextBlockData,
  type GitHubRepoLink,
  ConcurrencyConflictError,
} from '../types/model';
import { createId } from '../lib/id';
import { auditPromoteService } from '../lib/auditPromoteService';
import { runCodeAudit, type CodeAuditResult } from '../lib/codeAudit';
import { computeContentHash } from '../lib/hash';
import {
  loadWorkspaceFromStorage,
  persistProject,
  removeProjectFromStorage,
  persistGroup,
  removeGroupFromStorage,
  persistBlock,
  removeBlockFromStorage,
  persistTether,
  removeTetherFromStorage,
  replaceWorkspaceStorage,
} from '../lib/storage';

export interface CreateBlockInput {
  projectId: string;
  groupId: string;
  kind: BlockKind;
  title: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  status?: BlockStatus;
  data?: Partial<BlockData>;
}

export interface WorkspaceState {
  projects: Project[];
  groups: TetherGroup[];
  blocks: Block[];
  tethers: Tether[];
  activeProjectId: string | null;
  activeGroupId: string | null;
  selectedBlockId: string | null;
  connectingSourceBlockId: string | null;
  searchQuery: string;
  isInitialized: boolean;
  focusedBlockId: string | null;
  focusViewportRequest: { blockId: string; token: number } | null;
  collapsedCanvasFolders: string[];
  viewMode: 'workspace' | 'canvas';
  isEditorOpen: boolean;
  openBlockIds: string[];
  activeEditorBlockId: string | null;
  isSidebarCollapsed: boolean;
  isHeaderCollapsed: boolean;
  isInspectorCollapsed: boolean;
  isBlockInspectorCollapsed: boolean;
  sandboxes: BlockSandbox[];
  activeSandboxBlockIds: string[];

  // Actions
  initStorage: () => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  renameProject: (id: string, name: string) => Promise<void>;
  updateProjectGitHubLink: (projectId: string, link: GitHubRepoLink | undefined) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createGroup: (projectId: string, name: string, color?: string) => Promise<TetherGroup>;
  renameGroup: (id: string, name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  createBlock: (input: CreateBlockInput) => Promise<Block>;
  updateBlock: (id: string, patch: Partial<Omit<Block, 'id' | 'data'>>) => Promise<void>;
  batchUpdateBlocks: (
    updates: Array<{ id: string; patch: Partial<Omit<Block, 'id' | 'data'>> }>
  ) => Promise<void>;
  updateBlockData: (id: string, patch: Record<string, unknown>) => Promise<void>;
  deleteBlock: (id: string) => Promise<void>;
  createTether: (
    sourceBlockId: string,
    targetBlockId: string,
    label?: string
  ) => Promise<Tether | null>;
  deleteTether: (id: string) => Promise<void>;
  setActiveProject: (projectId: string | null) => void;
  setActiveGroup: (groupId: string | null) => void;
  selectBlock: (blockId: string | null) => void;
  toggleCanvasFolder: (folderPath: string) => void;
  requestFocusViewport: (blockId: string | null) => void;
  setFocusedBlockId: (blockId: string | null) => void;
  setConnectingSourceBlockId: (blockId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setViewMode: (mode: 'workspace' | 'canvas') => void;
  openBlockInEditor: (blockId: string) => void;
  closeEditorModal: () => void;
  closeBlockTab: (blockId: string) => void;
  closeOtherTabs: (blockId: string) => void;
  setActiveEditorBlockId: (blockId: string | null) => void;
  toggleSidebar: () => void;
  toggleHeader: () => void;
  toggleInspector: () => void;
  toggleBlockInspector: () => void;
  setBlockInspectorCollapsed: (collapsed: boolean) => void;
  saveCodeDraft: (blockId: string, newContent: string) => Promise<void>;
  createCodeSnapshot: (blockId: string, label: string) => Promise<void>;
  rollbackCodeRevision: (blockId: string, revisionId: string) => Promise<void>;
  copyBlockForEdit: (sourceBlockId: string, options?: { openEditor?: boolean }) => Promise<Block | null>;
  auditBlock: (blockId: string, contentOverride?: string) => Promise<CodeAuditResult>;
  snipOldBlock: (newBlockId: string) => Promise<{ success: boolean; error?: string; transferredTetherCount: number }>;
  createSandbox: (sourceBlockId: string) => Promise<BlockSandbox>;
  updateSandbox: (
    sandboxId: string,
    expectedVersion: number,
    newWorkingContent: string
  ) => Promise<BlockSandbox>;
  promoteSandbox: (
    sandboxId: string,
    actor: string,
    reason: string
  ) => Promise<PromotionRecord>;
  createProjectSnapshot: (
    metadata?: Record<string, unknown>
  ) => Promise<ProjectSnapshot>;
  openBlockSandbox: (blockId: string) => Promise<BlockSandbox>;
  exitBlockSandbox: (blockId: string) => void;
  saveSandboxWorkingContent: (
    blockId: string,
    newContent: string
  ) => Promise<{ success: boolean; conflict?: boolean; error?: string; updatedSandbox?: BlockSandbox }>;
  archiveBlockSandbox: (blockId: string) => Promise<BlockSandbox | null>;
  reopenBlockSandbox: (blockId: string, sandboxId: string) => Promise<BlockSandbox>;
  refreshSandboxes: () => Promise<void>;
  importWorkspace: (data: {
    projects: Project[];
    groups: TetherGroup[];
    blocks: Block[];
    tethers: Tether[];
  }) => Promise<void>;
}

const DEFAULT_GROUP_COLORS = [
  '#38bdf8', // sky
  '#818cf8', // indigo
  '#34d399', // emerald
  '#f472b6', // pink
  '#fbbf24', // amber
  '#a78bfa', // violet
];

function getDefaultBlockData(kind: BlockKind, customData?: Partial<BlockData>): BlockData {
  switch (kind) {
    case 'text':
      return {
        content: '',
        ...customData,
      };
    case 'upload':
      return {
        fileName: '',
        size: 0,
        extractedBlockIds: [],
        ...customData,
      };
    case 'file':
      return {
        path: '',
        mimeType: 'text/plain',
        size: 0,
        content: '',
        binary: false,
        ...customData,
      };
    case 'code':
      return {
        path: 'main.js',
        language: 'javascript',
        currentContent: '',
        revisions: [],
        ...customData,
      };
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  groups: [],
  blocks: [],
  tethers: [],
  activeProjectId: null,
  activeGroupId: null,
  selectedBlockId: null,
  connectingSourceBlockId: null,
  searchQuery: '',
  isInitialized: false,
  focusedBlockId: null,
  focusViewportRequest: null,
  collapsedCanvasFolders: [],
  viewMode: 'canvas',
  isEditorOpen: false,
  openBlockIds: [],
  activeEditorBlockId: null,
  isSidebarCollapsed: false,
  isHeaderCollapsed: false,
  isInspectorCollapsed: true,
  isBlockInspectorCollapsed: false,
  sandboxes: [],
  activeSandboxBlockIds: [],

  initStorage: async () => {
    if (get().isInitialized) return;
    try {
      let { projects, groups, blocks, tethers } = await loadWorkspaceFromStorage();

      // Seed initial data on first launch only
      if (projects.length === 0) {
        const now = Date.now();

        // 1. "Research A" -> "Core docs" group
        const p1Id = createId();
        const p1: Project = { id: p1Id, name: 'Research A', createdAt: now, updatedAt: now };
        const g1Id = createId();
        const g1: TetherGroup = {
          id: g1Id,
          projectId: p1Id,
          name: 'Core docs',
          color: DEFAULT_GROUP_COLORS[0],
          createdAt: now,
        };

        const b1Id = createId();
        const b1: Block = {
          id: b1Id,
          projectId: p1Id,
          groupId: g1Id,
          kind: 'text',
          title: 'brief.md',
          x: 100,
          y: 80,
          status: 'ready',
          data: {
            content:
              '# Project Brief\nInvestigation into local-first logic tethers and offline block architecture.',
          },
          createdAt: now,
          updatedAt: now,
        };

        const b2Id = createId();
        const b2: Block = {
          id: b2Id,
          projectId: p1Id,
          groupId: g1Id,
          kind: 'text',
          title: 'notes.txt',
          x: 100,
          y: 320,
          status: 'ready',
          data: {
            content:
              'Key finding: explicit directional tethers prevent dependency ambiguity.',
          },
          createdAt: now,
          updatedAt: now,
        };

        const b3Id = createId();
        const b3: Block = {
          id: b3Id,
          projectId: p1Id,
          groupId: g1Id,
          kind: 'text',
          title: 'references.md',
          x: 480,
          y: 200,
          status: 'ready',
          data: {
            content:
              '# References\n1. Local-first software principles\n2. Block-based canvas ergonomics',
          },
          createdAt: now,
          updatedAt: now,
        };

        // references.md is tethered to both other blocks with label "supports"
        const t1: Tether = {
          id: createId(),
          projectId: p1Id,
          groupId: g1Id,
          sourceBlockId: b3Id,
          targetBlockId: b1Id,
          label: 'supports',
          createdAt: now,
        };

        const t2: Tether = {
          id: createId(),
          projectId: p1Id,
          groupId: g1Id,
          sourceBlockId: b3Id,
          targetBlockId: b2Id,
          label: 'supports',
          createdAt: now,
        };

        // 2. "Prototype B" -> "Specs" group and "Zip import" group
        const p2Id = createId();
        const p2: Project = { id: p2Id, name: 'Prototype B', createdAt: now + 1, updatedAt: now + 1 };

        const g2Id = createId();
        const g2: TetherGroup = {
          id: g2Id,
          projectId: p2Id,
          name: 'Specs',
          color: DEFAULT_GROUP_COLORS[1],
          createdAt: now + 1,
        };

        const g3Id = createId();
        const g3: TetherGroup = {
          id: g3Id,
          projectId: p2Id,
          name: 'Zip import',
          color: DEFAULT_GROUP_COLORS[2],
          createdAt: now + 2,
        };

        const b4Id = createId();
        const b4: Block = {
          id: b4Id,
          projectId: p2Id,
          groupId: g2Id,
          kind: 'text',
          title: 'requirements.md',
          x: 100,
          y: 120,
          status: 'ready',
          data: {
            content:
              '# Requirements\n- Pure browser extraction\n- Bounded code revision history\n- Zero cloud dependencies',
          },
          createdAt: now + 1,
          updatedAt: now + 1,
        };

        const b5Id = createId();
        const b5: Block = {
          id: b5Id,
          projectId: p2Id,
          groupId: g2Id,
          kind: 'text',
          title: 'api-notes.md',
          x: 480,
          y: 120,
          status: 'ready',
          data: {
            content:
              '# API Notes\nInternal interfaces must be fully typed and persist directly to IndexedDB.',
          },
          createdAt: now + 1,
          updatedAt: now + 1,
        };

        // requirements.md -> api-notes.md with label "depends on"
        const t3: Tether = {
          id: createId(),
          projectId: p2Id,
          groupId: g2Id,
          sourceBlockId: b4Id,
          targetBlockId: b5Id,
          label: 'depends on',
          createdAt: now + 1,
        };

        // Upload block titled bundle.zip in Zip import group
        const b6Id = createId();
        const b6: Block = {
          id: b6Id,
          projectId: p2Id,
          groupId: g3Id,
          kind: 'upload',
          title: 'bundle.zip',
          x: 140,
          y: 120,
          status: 'idle',
          data: { fileName: '', size: 0, extractedBlockIds: [] },
          createdAt: now + 2,
          updatedAt: now + 2,
        };

        projects = [p1, p2];
        groups = [g1, g2, g3];
        blocks = [b1, b2, b3, b4, b5, b6];
        tethers = [t1, t2, t3];

        await replaceWorkspaceStorage({ projects, groups, blocks, tethers });
      }

      // Restore active project and group from localStorage if available
      const savedProjId = typeof window !== 'undefined' ? localStorage.getItem('tether:activeProjectId') : null;
      const savedGroupId = typeof window !== 'undefined' ? localStorage.getItem('tether:activeGroupId') : null;

      const activeProject =
        projects.find((p) => p.id === savedProjId) || projects[0] || null;
      const projectGroups = activeProject
        ? groups.filter((g) => g.projectId === activeProject.id)
        : [];
      const activeGroup =
        projectGroups.find((g) => g.id === savedGroupId) || projectGroups[0] || null;

      const projectSandboxes = activeProject
        ? await auditPromoteService.getAllSandboxesForProject(activeProject.id)
        : [];

      set({
        projects,
        groups,
        blocks,
        tethers,
        sandboxes: projectSandboxes,
        isInitialized: true,
        activeProjectId: activeProject ? activeProject.id : null,
        activeGroupId: activeGroup ? activeGroup.id : null,
      });
    } catch {
      set({ isInitialized: true });
    }
  },

  createProject: async (name: string) => {
    const now = Date.now();
    const newProject: Project = {
      id: createId(),
      name: name.trim() || 'Untitled Project',
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      projects: [...state.projects, newProject],
      activeProjectId: newProject.id,
    }));

    if (typeof window !== 'undefined') {
      localStorage.setItem('tether:activeProjectId', newProject.id);
    }

    await persistProject(newProject);
    return newProject;
  },

  renameProject: async (id: string, name: string) => {
    const state = get();
    const target = state.projects.find((p) => p.id === id);
    if (!target) return;

    const updated: Project = {
      ...target,
      name: name.trim() || 'Untitled Project',
      updatedAt: Date.now(),
    };

    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? updated : p)),
    }));

    await persistProject(updated);
  },

  deleteProject: async (id: string) => {
    set((state) => {
      const remainingProjects = state.projects.filter((p) => p.id !== id);
      const nextActiveProject =
        state.activeProjectId === id
          ? remainingProjects.length > 0
            ? remainingProjects[0].id
            : null
          : state.activeProjectId;

      return {
        projects: remainingProjects,
        groups: state.groups.filter((g) => g.projectId !== id),
        blocks: state.blocks.filter((b) => b.projectId !== id),
        tethers: state.tethers.filter((t) => t.projectId !== id),
        activeProjectId: nextActiveProject,
        activeGroupId:
          state.groups.find((g) => g.projectId === nextActiveProject)?.id || null,
        selectedBlockId:
          state.selectedBlockId &&
          state.blocks.some((b) => b.id === state.selectedBlockId && b.projectId === id)
            ? null
            : state.selectedBlockId,
      };
    });

    await removeProjectFromStorage(id);
  },

  updateProjectGitHubLink: async (projectId: string, link: GitHubRepoLink | undefined) => {
    const target = get().projects.find((p) => p.id === projectId);
    if (!target) return;

    const updated: Project = {
      ...target,
      githubLink: link,
      updatedAt: Date.now(),
    };

    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? updated : p)),
    }));

    await persistProject(updated);
  },

  createGroup: async (projectId: string, name: string, color?: string) => {
    const existingInProject = get().groups.filter((g) => g.projectId === projectId);
    const assignedColor =
      color ||
      DEFAULT_GROUP_COLORS[existingInProject.length % DEFAULT_GROUP_COLORS.length];

    const newGroup: TetherGroup = {
      id: createId(),
      projectId,
      name: name.trim() || 'Default Group',
      color: assignedColor,
      createdAt: Date.now(),
    };

    set((state) => ({
      groups: [...state.groups, newGroup],
      activeGroupId: newGroup.id,
    }));

    if (typeof window !== 'undefined') {
      localStorage.setItem('tether:activeGroupId', newGroup.id);
    }

    await persistGroup(newGroup);
    return newGroup;
  },

  renameGroup: async (id: string, name: string) => {
    const state = get();
    const target = state.groups.find((g) => g.id === id);
    if (!target) return;

    const updated: TetherGroup = {
      ...target,
      name: name.trim() || 'Untitled Group',
    };

    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? updated : g)),
    }));

    await persistGroup(updated);
  },

  deleteGroup: async (id: string) => {
    set((state) => {
      const remainingGroups = state.groups.filter((g) => g.id !== id);
      return {
        groups: remainingGroups,
        blocks: state.blocks.filter((b) => b.groupId !== id),
        tethers: state.tethers.filter((t) => t.groupId !== id),
        activeGroupId:
          state.activeGroupId === id
            ? remainingGroups.find((g) => g.projectId === state.activeProjectId)?.id || null
            : state.activeGroupId,
        selectedBlockId:
          state.selectedBlockId &&
          state.blocks.some((b) => b.id === state.selectedBlockId && b.groupId === id)
            ? null
            : state.selectedBlockId,
      };
    });

    await removeGroupFromStorage(id);
  },

  createBlock: async (input: CreateBlockInput) => {
    const now = Date.now();
    const newBlock: Block = {
      id: createId(),
      projectId: input.projectId,
      groupId: input.groupId,
      kind: input.kind,
      title: input.title.trim() || 'Untitled Block',
      x: input.x ?? 100,
      y: input.y ?? 100,
      width: input.width,
      height: input.height,
      status: input.status ?? 'ready',
      data: getDefaultBlockData(input.kind, input.data as Partial<BlockData>),
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      blocks: [...state.blocks, newBlock],
    }));

    await persistBlock(newBlock);
    return newBlock;
  },

  updateBlock: async (id: string, patch: Partial<Omit<Block, 'id' | 'data'>>) => {
    const state = get();
    const targetBlock = state.blocks.find((b) => b.id === id);
    if (!targetBlock) return;

    const updated: Block = {
      ...targetBlock,
      ...patch,
      updatedAt: Date.now(),
    };

    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? updated : b)),
    }));

    await persistBlock(updated);
  },

  batchUpdateBlocks: async (updates) => {
    if (updates.length === 0) return;
    const patchMap = new Map(updates.map((u) => [u.id, u.patch]));
    const now = Date.now();
    const updatedList: Block[] = [];

    set((s) => ({
      blocks: s.blocks.map((b) => {
        const patch = patchMap.get(b.id);
        if (!patch) return b;
        const next: Block = { ...b, ...patch, updatedAt: now };
        updatedList.push(next);
        return next;
      }),
    }));

    if (updatedList.length > 0) {
      await Promise.all(updatedList.map((b) => persistBlock(b)));
    }
  },

  updateBlockData: async (id: string, patch: Record<string, unknown>) => {
    const state = get();
    const targetBlock = state.blocks.find((b) => b.id === id);
    if (!targetBlock) return;

    const updated: Block = {
      ...targetBlock,
      data: {
        ...targetBlock.data,
        ...patch,
      } as BlockData,
      updatedAt: Date.now(),
    };

    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? updated : b)),
    }));

    await persistBlock(updated);
  },

  deleteBlock: async (id: string) => {
    const state = get();
    const targetBlock = state.blocks.find((b) => b.id === id);
    if (!targetBlock) return;

    // Rule: Deleting a block deletes every tether connected to it
    const connectedTethers = state.tethers.filter(
      (t) => t.sourceBlockId === id || t.targetBlockId === id
    );
    const connectedTetherIds = connectedTethers.map((t) => t.id);

    set((s) => {
      const nextOpen = s.openBlockIds.filter((tabId) => tabId !== id);
      const nextActive = s.activeEditorBlockId === id
        ? (nextOpen.length > 0 ? nextOpen[nextOpen.length - 1] : null)
        : s.activeEditorBlockId;

      return {
        blocks: s.blocks.filter((b) => b.id !== id),
        tethers: s.tethers.filter((t) => t.sourceBlockId !== id && t.targetBlockId !== id),
        selectedBlockId: s.selectedBlockId === id ? null : s.selectedBlockId,
        focusedBlockId: s.focusedBlockId === id ? null : s.focusedBlockId,
        openBlockIds: nextOpen,
        activeEditorBlockId: nextActive,
      };
    });

    await removeBlockFromStorage(id, connectedTetherIds);
  },

  createTether: async (
    sourceBlockId: string,
    targetBlockId: string,
    label?: string
  ): Promise<Tether | null> => {
    // Rule: Prevent self-tethers
    if (sourceBlockId === targetBlockId) {
      return null;
    }

    const state = get();
    const sourceBlock = state.blocks.find((b) => b.id === sourceBlockId);
    const targetBlock = state.blocks.find((b) => b.id === targetBlockId);

    if (!sourceBlock || !targetBlock) {
      return null;
    }

    // Rule: A tether may connect only two blocks in the same project and same tether group
    if (sourceBlock.projectId !== targetBlock.projectId) {
      return null;
    }
    if (sourceBlock.groupId !== targetBlock.groupId) {
      return null;
    }

    // Rule: Prevent duplicate bidirectional tethers
    const duplicateExists = state.tethers.some(
      (t) =>
        t.projectId === sourceBlock.projectId &&
        t.groupId === sourceBlock.groupId &&
        ((t.sourceBlockId === sourceBlockId && t.targetBlockId === targetBlockId) ||
          (t.sourceBlockId === targetBlockId && t.targetBlockId === sourceBlockId))
    );

    if (duplicateExists) {
      return null;
    }

    const newTether: Tether = {
      id: createId(),
      projectId: sourceBlock.projectId,
      groupId: sourceBlock.groupId,
      sourceBlockId,
      targetBlockId,
      label: label?.trim() || undefined,
      createdAt: Date.now(),
    };

    set((s) => ({
      tethers: [...s.tethers, newTether],
    }));

    await persistTether(newTether);
    return newTether;
  },

  deleteTether: async (id: string) => {
    set((state) => ({
      tethers: state.tethers.filter((t) => t.id !== id),
    }));
    await removeTetherFromStorage(id);
  },

  setActiveProject: (projectId: string | null) => {
    set((state) => {
      const projectGroups = state.groups.filter((g) => g.projectId === projectId);
      const nextGroupId = projectGroups.length > 0 ? projectGroups[0].id : null;
      if (typeof window !== 'undefined') {
        if (projectId) localStorage.setItem('tether:activeProjectId', projectId);
        else localStorage.removeItem('tether:activeProjectId');
        if (nextGroupId) localStorage.setItem('tether:activeGroupId', nextGroupId);
        else localStorage.removeItem('tether:activeGroupId');
      }
      return {
        activeProjectId: projectId,
        activeGroupId: nextGroupId,
        selectedBlockId: null,
        focusedBlockId: null,
        connectingSourceBlockId: null,
        activeSandboxBlockIds: [],
      };
    });

    if (projectId) {
      auditPromoteService.getAllSandboxesForProject(projectId)
        .then((sandboxes) => set({ sandboxes }))
        .catch(() => {});
    } else {
      set({ sandboxes: [] });
    }
  },

  setActiveGroup: (groupId: string | null) => {
    if (typeof window !== 'undefined') {
      if (groupId) localStorage.setItem('tether:activeGroupId', groupId);
      else localStorage.removeItem('tether:activeGroupId');
    }
    set({
      activeGroupId: groupId,
      selectedBlockId: null,
      focusedBlockId: null,
      connectingSourceBlockId: null,
    });
  },

  selectBlock: (blockId: string | null) => {
    set({
      selectedBlockId: blockId,
    });
  },

  toggleCanvasFolder: (folderPath: string) => {
    set((state) => {
      const exists = state.collapsedCanvasFolders.includes(folderPath);
      return {
        collapsedCanvasFolders: exists
          ? state.collapsedCanvasFolders.filter((p) => p !== folderPath)
          : [...state.collapsedCanvasFolders, folderPath],
      };
    });
  },

  requestFocusViewport: (blockId: string | null) => {
    if (!blockId) {
      set({ focusViewportRequest: null });
      return;
    }

    const state = get();
    const target = state.blocks.find((b) => b.id === blockId);
    if (!target) {
      set({ focusViewportRequest: null });
      return;
    }

    // Ensure collapsed upload or project folders containing this block are expanded
    const parentUpload = state.blocks.find(
      (b) =>
        b.kind === 'upload' &&
        b.projectId === target.projectId &&
        b.groupId === target.groupId &&
        (b.data as UploadBlockData)?.extractedBlockIds?.includes(target.id)
    );

    if (parentUpload) {
      const uploadData = parentUpload.data as UploadBlockData;
      const folderPath = (target.data as FileBlockData)?.parentFolderPath;
      const expanded = new Set(uploadData?.expandedFolderPaths ?? []);
      let changed = Boolean(uploadData?.structureCollapsed);
      if (folderPath) {
        const segs = folderPath.split('/');
        let curr = '';
        for (const seg of segs) {
          curr = curr ? `${curr}/${seg}` : seg;
          if (!expanded.has(curr)) {
            expanded.add(curr);
            changed = true;
          }
        }
      }
      if (changed) {
        void get().updateBlockData(parentUpload.id, {
          structureCollapsed: false,
          expandedFolderPaths: Array.from(expanded),
        });
      }
      set({ focusViewportRequest: { blockId, token: Date.now() } });
      return;
    }

    const rawPath = (
      target.sourcePath ||
      (target.data as { path?: string })?.path ||
      target.title
    ).replace(/^\/+/, '');
    const parts = rawPath.split('/');
    let nextCollapsed = state.collapsedCanvasFolders;
    if (parts.length > 1 && nextCollapsed.length > 0) {
      const ancestors = new Set<string>();
      let curr = '';
      for (let i = 0; i < parts.length - 1; i++) {
        curr = curr ? `${curr}/${parts[i]}` : parts[i];
        ancestors.add(curr);
      }
      nextCollapsed = nextCollapsed.filter((p) => !ancestors.has(p));
    }

    set({
      collapsedCanvasFolders: nextCollapsed,
      focusViewportRequest: { blockId, token: Date.now() },
    });
  },

  setFocusedBlockId: (blockId: string | null) => {
    set((state) => ({
      focusedBlockId: blockId,
      selectedBlockId: blockId ?? state.selectedBlockId,
    }));
  },

  setConnectingSourceBlockId: (blockId: string | null) => {
    set({
      connectingSourceBlockId: blockId,
    });
  },

  setSearchQuery: (query: string) => {
    set({
      searchQuery: query,
    });
  },

  setViewMode: (mode: 'workspace' | 'canvas') => {
    set({ viewMode: mode });
  },

  openBlockInEditor: (blockId: string) => {
    set((state) => {
      const alreadyOpen = state.openBlockIds.includes(blockId);
      const nextOpen = alreadyOpen ? state.openBlockIds : [...state.openBlockIds, blockId];
      return {
        openBlockIds: nextOpen,
        activeEditorBlockId: blockId,
        selectedBlockId: blockId,
        isEditorOpen: true,
      };
    });
  },

  closeEditorModal: () => {
    set({ isEditorOpen: false });
  },

  closeBlockTab: (blockId: string) => {
    set((state) => {
      const nextOpen = state.openBlockIds.filter((id) => id !== blockId);
      let nextActive = state.activeEditorBlockId;

      if (state.activeEditorBlockId === blockId) {
        if (nextOpen.length > 0) {
          const closedIdx = state.openBlockIds.indexOf(blockId);
          const newIdx = Math.min(closedIdx, nextOpen.length - 1);
          nextActive = nextOpen[newIdx >= 0 ? newIdx : 0];
        } else {
          nextActive = null;
        }
      }

      return {
        openBlockIds: nextOpen,
        activeEditorBlockId: nextActive,
        selectedBlockId: nextActive ?? state.selectedBlockId,
        isEditorOpen: nextOpen.length > 0 ? state.isEditorOpen : false,
      };
    });
  },

  closeOtherTabs: (blockId: string) => {
    set({
      openBlockIds: [blockId],
      activeEditorBlockId: blockId,
      selectedBlockId: blockId,
    });
  },

  setActiveEditorBlockId: (blockId: string | null) => {
    set({
      activeEditorBlockId: blockId,
      selectedBlockId: blockId,
    });
  },

  toggleSidebar: () => {
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed }));
  },

  toggleHeader: () => {
    set((state) => ({ isHeaderCollapsed: !state.isHeaderCollapsed }));
  },

  toggleInspector: () => {
    set((state) => ({ isInspectorCollapsed: !state.isInspectorCollapsed }));
  },

  toggleBlockInspector: () => {
    set((state) => ({ isBlockInspectorCollapsed: !state.isBlockInspectorCollapsed }));
  },

  setBlockInspectorCollapsed: (collapsed: boolean) => {
    set({ isBlockInspectorCollapsed: collapsed });
  },

  saveCodeDraft: async (blockId: string, newContent: string) => {
    const block = get().blocks.find((b) => b.id === blockId);
    if (!block || block.kind !== 'code') return;
    const codeData = block.data as { currentContent: string; revisions: { id: string; createdAt: number; content: string; label?: string }[] };

    const beforeEditRevision = {
      id: createId(),
      createdAt: Date.now(),
      content: codeData.currentContent,
      label: 'before edit',
    };

    const updatedRevisions = [...(codeData.revisions || []), beforeEditRevision].slice(-50);

    await get().updateBlockData(blockId, {
      currentContent: newContent,
      revisions: updatedRevisions,
    });
  },

  createCodeSnapshot: async (blockId: string, label: string) => {
    const block = get().blocks.find((b) => b.id === blockId);
    if (!block || block.kind !== 'code') return;
    const codeData = block.data as { currentContent: string; revisions: { id: string; createdAt: number; content: string; label?: string }[] };

    const snapshotRevision = {
      id: createId(),
      createdAt: Date.now(),
      content: codeData.currentContent,
      label: label.trim() || 'snapshot',
    };

    const updatedRevisions = [...(codeData.revisions || []), snapshotRevision].slice(-50);

    await get().updateBlockData(blockId, {
      revisions: updatedRevisions,
    });
  },

  rollbackCodeRevision: async (blockId: string, revisionId: string) => {
    const block = get().blocks.find((b) => b.id === blockId);
    if (!block || block.kind !== 'code') return;
    const codeData = block.data as { currentContent: string; revisions: { id: string; createdAt: number; content: string; label?: string }[] };
    const targetRev = codeData.revisions.find((r) => r.id === revisionId);
    if (!targetRev) return;

    const beforeRollbackRevision = {
      id: createId(),
      createdAt: Date.now(),
      content: codeData.currentContent,
      label: 'before rollback',
    };

    const updatedRevisions = [...codeData.revisions, beforeRollbackRevision].slice(-50);

    await get().updateBlockData(blockId, {
      currentContent: targetRev.content,
      revisions: updatedRevisions,
    });
  },

  copyBlockForEdit: async (sourceBlockId: string, options?: { openEditor?: boolean }) => {
    const state = get();
    const source = state.blocks.find((b) => b.id === sourceBlockId);
    if (!source || source.kind === 'upload') return null;

    const dupTitle = source.title.includes('.')
      ? source.title.replace(/(\.[^.]+)$/, '-copy$1')
      : `${source.title}-copy`;

    const rawPath =
      source.sourcePath ||
      (source.data as { path?: string })?.path ||
      source.title;
    const cleanRawPath = rawPath.replace(/^\/+/, '');
    const pathParts = cleanRawPath.split('/');
    const dupPath =
      pathParts.length > 1
        ? `${pathParts.slice(0, -1).join('/')}/${dupTitle}`
        : dupTitle;

    const clonedData = { ...(source.data as unknown as Record<string, unknown>) };
    if ('path' in clonedData || source.kind === 'code' || source.kind === 'file') {
      clonedData.path = dupPath;
    }

    // If copying a non-code file into a code-editable copy, keep its kind (code/text/file are all editable in editor)
    const newBlock = await get().createBlock({
      projectId: source.projectId,
      groupId: source.groupId,
      kind: source.kind,
      title: dupTitle,
      x: Math.round(source.x + 360),
      y: Math.round(source.y + 24),
      width: source.width,
      height: source.height,
      status: 'ready',
      data: clonedData as Partial<CodeBlockData | FileBlockData | TextBlockData>,
    });

    await get().updateBlock(newBlock.id, {
      sourcePath: dupPath,
      copiedFromBlockId: source.id,
      lastAuditStatus: 'unverified',
      lastAuditFindings: [],
      lastAuditHash: undefined,
    });

    // If source block belongs to an Upload block's extractedBlockIds, register copy in the same archive folder
    const parentUpload = get().blocks.find(
      (b) =>
        b.kind === 'upload' &&
        b.projectId === source.projectId &&
        b.groupId === source.groupId &&
        (b.data as UploadBlockData)?.extractedBlockIds?.includes(source.id)
    );
    if (parentUpload) {
      const uploadData = parentUpload.data as UploadBlockData;
      const nextExtracted = Array.from(new Set([...(uploadData.extractedBlockIds || []), newBlock.id]));
      await get().updateBlockData(parentUpload.id, {
        extractedBlockIds: nextExtracted,
      });
    }

    // Create a visible lineage tether from old block -> copied block
    await get().createTether(source.id, newBlock.id, 'copied from');

    const latestBlock = get().blocks.find((b) => b.id === newBlock.id) || newBlock;
    if (options?.openEditor !== false) {
      get().openBlockInEditor(newBlock.id);
    } else {
      get().selectBlock(newBlock.id);
    }

    return latestBlock;
  },

  auditBlock: async (blockId: string, contentOverride?: string) => {
    const block = get().blocks.find((b) => b.id === blockId);
    if (!block) {
      throw new Error(`Block '${blockId}' not found.`);
    }

    let content = contentOverride;
    if (content === undefined) {
      if (block.kind === 'code') {
        content = (block.data as CodeBlockData)?.currentContent || '';
      } else if (block.kind === 'text') {
        content = (block.data as TextBlockData)?.content || '';
      } else if (block.kind === 'file') {
        content = (block.data as FileBlockData)?.content || '';
      } else {
        content = '';
      }
    } else {
      // Persist latest draft content before marking hash as audited
      if (block.kind === 'code') {
        await get().updateBlockData(block.id, { currentContent: content });
      } else if (block.kind === 'text' || block.kind === 'file') {
        await get().updateBlockData(block.id, { content });
      }
    }

    const path =
      block.sourcePath ||
      (block.data as { path?: string })?.path ||
      block.title;
    const ext = block.title.split('.').pop()?.toLowerCase();
    const language =
      block.kind === 'code'
        ? (block.data as CodeBlockData)?.language || ext || 'javascript'
        : ext || (block.kind === 'text' ? 'markdown' : 'javascript');

    const result = runCodeAudit({ content, language, path });

    let auditRunId: string | undefined;
    try {
      const latestBlock = get().blocks.find((b) => b.id === blockId) || block;
      const baseRev = await auditPromoteService.createRevision({
        projectId: latestBlock.projectId,
        blockId: latestBlock.id,
        content,
        origin: 'candidate',
        label: 'audit check',
      });
      const run = await auditPromoteService.createAuditRun({
        projectId: latestBlock.projectId,
        baselineRevisionId: latestBlock.activeRevisionId || baseRev.id,
        candidateRevisionId: baseRev.id,
        checkConfig: { language, path },
      });
      const completed = await auditPromoteService.recordAuditFindings(
        latestBlock.projectId,
        run.id,
        result.findings,
        { errorCount: result.errorCount, warningCount: result.warningCount }
      );
      auditRunId = completed.id;
    } catch {
      // Non-fatal if storage/revision audit log fails in isolated state
    }

    await get().updateBlock(block.id, {
      lastAuditStatus: result.passed ? 'passed' : 'failed',
      lastAuditHash: result.contentHash,
      lastAuditFindings: result.findings,
      lastAuditRunId: auditRunId,
      status: result.passed ? 'ready' : 'error',
    });

    return result;
  },

  snipOldBlock: async (newBlockId: string) => {
    const state = get();
    const newBlock = state.blocks.find((b) => b.id === newBlockId);
    if (!newBlock || !newBlock.copiedFromBlockId) {
      return {
        success: false,
        error: 'This block is not linked to an older copied block.',
        transferredTetherCount: 0,
      };
    }

    const oldBlock = state.blocks.find((b) => b.id === newBlock.copiedFromBlockId);
    if (!oldBlock) {
      await get().updateBlock(newBlock.id, { copiedFromBlockId: undefined });
      return {
        success: false,
        error: 'Original block no longer exists.',
        transferredTetherCount: 0,
      };
    }

    const currentContent =
      newBlock.kind === 'code'
        ? (newBlock.data as CodeBlockData)?.currentContent || ''
        : newBlock.kind === 'text'
        ? (newBlock.data as TextBlockData)?.content || ''
        : (newBlock.data as FileBlockData)?.content || '';

    const currentHash = computeContentHash(currentContent);
    if (
      newBlock.lastAuditStatus !== 'passed' ||
      newBlock.lastAuditHash !== currentHash
    ) {
      return {
        success: false,
        error: 'Run and pass the code audit with 0 errors before snipping the old block.',
        transferredTetherCount: 0,
      };
    }

    // Collect all tethers connected to oldBlock (excluding the temporary 'copied from' edge between oldBlock & newBlock)
    const oldTethers = state.tethers.filter(
      (t) =>
        (t.sourceBlockId === oldBlock.id || t.targetBlockId === oldBlock.id) &&
        !(
          (t.sourceBlockId === oldBlock.id && t.targetBlockId === newBlock.id) ||
          (t.sourceBlockId === newBlock.id && t.targetBlockId === oldBlock.id)
        )
    );

    let transferredTetherCount = 0;
    for (const t of oldTethers) {
      if (t.targetBlockId === oldBlock.id && t.sourceBlockId !== newBlock.id) {
        const created = await get().createTether(t.sourceBlockId, newBlock.id, t.label);
        if (created) transferredTetherCount++;
      } else if (t.sourceBlockId === oldBlock.id && t.targetBlockId !== newBlock.id) {
        const created = await get().createTether(newBlock.id, t.targetBlockId, t.label);
        if (created) transferredTetherCount++;
      }
    }

    // Preserve oldBlock's folder path and upload archive membership so newBlock collapses with the folder
    const oldParentFolder = (oldBlock.data as FileBlockData)?.parentFolderPath;
    const oldRawPath =
      oldBlock.sourcePath ||
      (oldBlock.data as { path?: string })?.path ||
      oldBlock.title;
    const oldFolderPrefix = oldRawPath.includes('/')
      ? oldRawPath.split('/').slice(0, -1).join('/')
      : '';
    const newCleanName = newBlock.title;
    const preservedPath = oldFolderPrefix
      ? `${oldFolderPrefix}/${newCleanName}`
      : (newBlock.data as { path?: string })?.path || newCleanName;

    if (oldParentFolder) {
      await get().updateBlockData(newBlock.id, {
        parentFolderPath: oldParentFolder,
        path: preservedPath,
      });
    } else if (oldFolderPrefix) {
      await get().updateBlockData(newBlock.id, {
        path: preservedPath,
      });
    }

    // Ensure upload block's extractedBlockIds includes newBlock and removes oldBlock
    const parentUpload = get().blocks.find(
      (b) =>
        b.kind === 'upload' &&
        b.projectId === oldBlock.projectId &&
        b.groupId === oldBlock.groupId &&
        (b.data as UploadBlockData)?.extractedBlockIds?.includes(oldBlock.id)
    );
    if (parentUpload) {
      const uploadData = parentUpload.data as UploadBlockData;
      const nextExtracted = Array.from(
        new Set(
          (uploadData.extractedBlockIds || [])
            .filter((id) => id !== oldBlock.id)
            .concat(newBlock.id)
        )
      );
      await get().updateBlockData(parentUpload.id, {
        extractedBlockIds: nextExtracted,
      });

      // Ensure tether exists from parentUpload -> newBlock
      const hasArchiveTether = get().tethers.some(
        (t) =>
          (t.sourceBlockId === parentUpload.id && t.targetBlockId === newBlock.id) ||
          (t.sourceBlockId === newBlock.id && t.targetBlockId === parentUpload.id)
      );
      if (!hasArchiveTether) {
        const created = await get().createTether(parentUpload.id, newBlock.id, 'extracted from');
        if (created) transferredTetherCount++;
      }
    }

    // Move newBlock into oldBlock's canvas slot & clear copiedFromBlockId
    await get().updateBlock(newBlock.id, {
      x: oldBlock.x,
      y: oldBlock.y,
      sourcePath: preservedPath,
      copiedFromBlockId: undefined,
      status: 'ready',
    });

    // Snip (delete) oldBlock and its old tethers
    await get().deleteBlock(oldBlock.id);

    get().selectBlock(newBlock.id);

    return {
      success: true,
      transferredTetherCount,
    };
  },

  createSandbox: async (sourceBlockId: string) => {
    const { activeProjectId } = get();
    if (!activeProjectId) {
      throw new Error('No active project selected.');
    }
    return auditPromoteService.createSandbox({
      projectId: activeProjectId,
      sourceBlockId,
    });
  },

  updateSandbox: async (sandboxId: string, expectedVersion: number, newWorkingContent: string) => {
    const { activeProjectId } = get();
    if (!activeProjectId) {
      throw new Error('No active project selected.');
    }
    return auditPromoteService.updateSandboxWorkingContent({
      projectId: activeProjectId,
      sandboxId,
      expectedVersion,
      newWorkingContent,
    });
  },

  promoteSandbox: async (sandboxId: string, actor: string, reason: string) => {
    const { activeProjectId } = get();
    if (!activeProjectId) {
      throw new Error('No active project selected.');
    }
    const { promotionRecord, updatedBlock } = await auditPromoteService.promoteSandbox({
      projectId: activeProjectId,
      sandboxId,
      actor,
      reason,
    });

    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === updatedBlock.id ? updatedBlock : b)),
    }));

    return promotionRecord;
  },

  createProjectSnapshot: async (metadata?: Record<string, unknown>) => {
    const { activeProjectId } = get();
    if (!activeProjectId) {
      throw new Error('No active project selected.');
    }
    return auditPromoteService.createProjectSnapshot({
      projectId: activeProjectId,
      metadata,
    });
  },

  openBlockSandbox: async (blockId: string) => {
    const { blocks, activeProjectId, openBlockIds, activeSandboxBlockIds } = get();
    const block = blocks.find((b) => b.id === blockId);
    if (!block) {
      throw new Error(`Block '${blockId}' not found.`);
    }
    const check = auditPromoteService.isBlockSupportedForSandboxing(block);
    if (!check.supported) {
      throw new Error(check.reason || 'This block cannot be sandboxed.');
    }

    const projectId = block.projectId || activeProjectId;
    if (!projectId) {
      throw new Error('No active project found.');
    }

    const sandbox = await auditPromoteService.getOrOpenActiveSandbox(projectId, blockId);
    const updatedSandboxes = await auditPromoteService.getAllSandboxesForProject(projectId);

    const nextOpen = openBlockIds.includes(blockId) ? openBlockIds : [...openBlockIds, blockId];
    const nextSandboxBlockIds = Array.from(new Set([...activeSandboxBlockIds, blockId]));

    set({
      sandboxes: updatedSandboxes,
      openBlockIds: nextOpen,
      activeEditorBlockId: blockId,
      selectedBlockId: blockId,
      activeSandboxBlockIds: nextSandboxBlockIds,
    });

    return sandbox;
  },

  exitBlockSandbox: (blockId: string) => {
    set((s) => ({
      activeSandboxBlockIds: s.activeSandboxBlockIds.filter((id) => id !== blockId),
    }));
  },

  saveSandboxWorkingContent: async (blockId: string, newContent: string) => {
    const { activeProjectId, sandboxes } = get();
    if (!activeProjectId) {
      return { success: false, error: 'No active project selected.' };
    }

    let sandbox = sandboxes.find(
      (s) => s.projectId === activeProjectId && s.sourceBlockId === blockId && s.status === 'active'
    );

    if (!sandbox) {
      try {
        sandbox = await auditPromoteService.getOrOpenActiveSandbox(activeProjectId, blockId);
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    try {
      const updated = await auditPromoteService.updateSandboxWorkingContent({
        projectId: activeProjectId,
        sandboxId: sandbox.id,
        expectedVersion: sandbox.version,
        newWorkingContent: newContent,
      });

      const updatedSandboxes = await auditPromoteService.getAllSandboxesForProject(activeProjectId);
      set({ sandboxes: updatedSandboxes });
      return { success: true, updatedSandbox: updated };
    } catch (err) {
      if (err instanceof ConcurrencyConflictError) {
        return { success: false, conflict: true, error: err.message };
      }
      return { success: false, error: (err as Error).message };
    }
  },

  archiveBlockSandbox: async (blockId: string) => {
    const { activeProjectId, sandboxes } = get();
    if (!activeProjectId) return null;

    const sandbox = sandboxes.find(
      (s) => s.projectId === activeProjectId && s.sourceBlockId === blockId && s.status === 'active'
    );
    if (!sandbox) return null;

    const updated = await auditPromoteService.archiveSandbox(activeProjectId, sandbox.id);
    const updatedSandboxes = await auditPromoteService.getAllSandboxesForProject(activeProjectId);

    set((s) => ({
      sandboxes: updatedSandboxes,
      activeSandboxBlockIds: s.activeSandboxBlockIds.filter((id) => id !== blockId),
    }));

    return updated;
  },

  reopenBlockSandbox: async (blockId: string, sandboxId: string) => {
    const { activeProjectId, openBlockIds, activeSandboxBlockIds } = get();
    if (!activeProjectId) {
      throw new Error('No active project selected.');
    }

    const updated = await auditPromoteService.reopenSandbox(activeProjectId, sandboxId);
    const updatedSandboxes = await auditPromoteService.getAllSandboxesForProject(activeProjectId);

    const nextOpen = openBlockIds.includes(blockId) ? openBlockIds : [...openBlockIds, blockId];
    const nextSandboxBlockIds = Array.from(new Set([...activeSandboxBlockIds, blockId]));

    set({
      sandboxes: updatedSandboxes,
      openBlockIds: nextOpen,
      activeEditorBlockId: blockId,
      selectedBlockId: blockId,
      activeSandboxBlockIds: nextSandboxBlockIds,
    });

    return updated;
  },

  refreshSandboxes: async () => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    const sbs = await auditPromoteService.getAllSandboxesForProject(activeProjectId);
    set({ sandboxes: sbs });
  },

  importWorkspace: async (data) => {
    await replaceWorkspaceStorage(data);

    const firstProject = data.projects[0] || null;
    const firstGroup = firstProject
      ? data.groups.find((g) => g.projectId === firstProject.id) || null
      : null;

    if (typeof window !== 'undefined') {
      if (firstProject) localStorage.setItem('tether:activeProjectId', firstProject.id);
      else localStorage.removeItem('tether:activeProjectId');
      if (firstGroup) localStorage.setItem('tether:activeGroupId', firstGroup.id);
      else localStorage.removeItem('tether:activeGroupId');
    }

    set({
      projects: data.projects,
      groups: data.groups,
      blocks: data.blocks,
      tethers: data.tethers,
      activeProjectId: firstProject ? firstProject.id : null,
      activeGroupId: firstGroup ? firstGroup.id : null,
      selectedBlockId: null,
      focusedBlockId: null,
      connectingSourceBlockId: null,
      searchQuery: '',
    });
  },
}));
