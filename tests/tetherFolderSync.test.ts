import { describe, it, expect, beforeEach } from 'bun:test';
import { useWorkspaceStore } from '../src/store/workspaceStore';
import {
  setForceInMemory,
  inMemoryStore,
  replaceWorkspaceStorage,
} from '../src/lib/storage';
import {
  isBlockPreviewTabCollapsed,
  extractLinePreview,
  countLinesFast,
  utf8ByteLength,
} from '../src/lib/tetherFolderSync';
import type {
  CodeBlockData,
  FileBlockData,
  FolderStructureNode,
  UploadBlockData,
} from '../src/types/model';

function flattenTreeFileIds(nodes: FolderStructureNode[] | undefined): string[] {
  if (!nodes) return [];
  const ids: string[] = [];
  for (const n of nodes) {
    if (n.isFolder) {
      ids.push(...flattenTreeFileIds(n.children));
    } else if (n.blockId) {
      ids.push(n.blockId);
    }
  }
  return ids;
}

function findNodeByBlockId(
  nodes: FolderStructureNode[] | undefined,
  blockId: string
): FolderStructureNode | undefined {
  if (!nodes) return undefined;
  for (const n of nodes) {
    if (!n.isFolder && n.blockId === blockId) return n;
    if (n.isFolder) {
      const found = findNodeByBlockId(n.children, blockId);
      if (found) return found;
    }
  }
  return undefined;
}

describe('Atomic Tether <-> Folder Structure Synchronization & Preview Helpers', () => {
  beforeEach(async () => {
    setForceInMemory(true);
    inMemoryStore.clear();
    await replaceWorkspaceStorage({
      projects: [],
      groups: [],
      blocks: [],
      tethers: [],
    });
    useWorkspaceStore.setState({
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
      viewMode: 'canvas',
      isEditorOpen: false,
      openBlockIds: [],
      activeEditorBlockId: null,
      sandboxes: [],
      activeSandboxBlockIds: [],
    });
  });

  it('adds tethered block into project.folderStructure and nests it under its parent', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Sync Project');
    const grp = await store.createGroup(proj.id, 'Main');

    const blockA = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'engine.ts',
      data: {
        path: 'src/engine.ts',
        language: 'typescript',
        currentContent: 'export const engine = true;\n',
        revisions: [],
      },
    });

    const blockB = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'helper.ts',
      data: {
        path: 'helper.ts',
        language: 'typescript',
        currentContent: 'export const help = 1;\n',
        revisions: [],
      },
    });

    // Initially untethered: neither appears in folderStructure
    let state = useWorkspaceStore.getState();
    let project = state.projects.find((p) => p.id === proj.id);
    expect(flattenTreeFileIds(project?.folderStructure)).toEqual([]);
    expect(state.blocks.find((b) => b.id === blockA.id)?.isInFolderStructure).toBe(false);
    expect(state.blocks.find((b) => b.id === blockB.id)?.isInFolderStructure).toBe(false);

    // Tether A -> B
    const tether = await store.createTether(blockA.id, blockB.id, 'dependency');
    expect(tether).not.toBeNull();

    state = useWorkspaceStore.getState();
    project = state.projects.find((p) => p.id === proj.id);
    const updatedA = state.blocks.find((b) => b.id === blockA.id);
    const updatedB = state.blocks.find((b) => b.id === blockB.id);

    expect(updatedA?.isInFolderStructure).toBe(true);
    expect(updatedA?.sourcePath).toBe('src/engine.ts');
    expect(updatedA?.originalSourcePath).toBe('src/engine.ts');

    expect(updatedB?.isInFolderStructure).toBe(true);
    expect(updatedB?.tetherParentId).toBe(blockA.id);
    expect(updatedB?.originalSourcePath).toBe('helper.ts');
    expect(updatedB?.sourcePath).toBe('src/engine/helper.ts');
    expect((updatedB?.data as CodeBlockData).path).toBe('src/engine/helper.ts');

    const treeIds = flattenTreeFileIds(project?.folderStructure);
    expect(treeIds).toContain(blockA.id);
    expect(treeIds).toContain(blockB.id);

    const nodeB = findNodeByBlockId(project?.folderStructure, blockB.id);
    expect(nodeB?.parentBlockId).toBe(blockA.id);
    expect(nodeB?.path).toBe('src/engine/helper.ts');
  });

  it('resolves multi-level chains (A -> B -> C) and sibling branches (B -> D)', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Chain Project');
    const grp = await store.createGroup(proj.id, 'Main');

    const a = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'root.ts',
      data: { path: 'app/root.ts', language: 'typescript', currentContent: '', revisions: [] },
    });
    const b = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'module.ts',
      data: { path: 'module.ts', language: 'typescript', currentContent: '', revisions: [] },
    });
    const c = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'leaf.ts',
      data: { path: 'leaf.ts', language: 'typescript', currentContent: '', revisions: [] },
    });
    const d = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'sibling.ts',
      data: { path: 'sibling.ts', language: 'typescript', currentContent: '', revisions: [] },
    });

    await store.createTether(a.id, b.id, 'dependency');
    await store.createTether(b.id, c.id, 'dependency');
    await store.createTether(b.id, d.id, 'reference');

    const state = useWorkspaceStore.getState();
    const project = state.projects.find((p) => p.id === proj.id);

    const stateB = state.blocks.find((blk) => blk.id === b.id);
    const stateC = state.blocks.find((blk) => blk.id === c.id);
    const stateD = state.blocks.find((blk) => blk.id === d.id);

    expect(stateB?.sourcePath).toBe('app/root/module.ts');
    expect(stateC?.sourcePath).toBe('app/root/module/leaf.ts');
    expect(stateD?.sourcePath).toBe('app/root/module/sibling.ts');
    expect(stateC?.tetherParentId).toBe(b.id);
    expect(stateD?.tetherParentId).toBe(b.id);

    const treeIds = flattenTreeFileIds(project?.folderStructure);
    expect(treeIds.sort()).toEqual([a.id, b.id, c.id, d.id].sort());
  });

  it('cleans up folder structure, tetherParentId, extractedBlockIds, and originalSourcePath on un-tether', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Untether Cleanup');
    const grp = await store.createGroup(proj.id, 'Main');

    const upload = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'upload',
      title: 'bundle.zip',
      data: { fileName: 'bundle.zip', size: 512, extractedBlockIds: [] },
    });

    const child = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'file',
      title: 'index.ts',
      data: {
        path: 'src/index.ts',
        parentFolderPath: 'src',
        mimeType: 'text/typescript',
        size: 20,
        binary: false,
        content: 'export const x = 1;',
      },
    });

    const tether = await store.createTether(upload.id, child.id, 'extracted from');
    expect(tether).not.toBeNull();

    let state = useWorkspaceStore.getState();
    expect((state.blocks.find((b) => b.id === upload.id)?.data as UploadBlockData).extractedBlockIds).toEqual([
      child.id,
    ]);
    expect(state.blocks.find((b) => b.id === child.id)?.isInFolderStructure).toBe(true);

    // Un-tether
    await store.deleteTether(tether!.id);

    state = useWorkspaceStore.getState();
    const project = state.projects.find((p) => p.id === proj.id);
    const cleanedUpload = state.blocks.find((b) => b.id === upload.id);
    const cleanedChild = state.blocks.find((b) => b.id === child.id);

    expect(flattenTreeFileIds(project?.folderStructure)).toEqual([]);
    expect((cleanedUpload?.data as UploadBlockData).extractedBlockIds).toEqual([]);
    expect(cleanedUpload?.isInFolderStructure).toBe(false);

    expect(cleanedChild?.isInFolderStructure).toBe(false);
    expect(cleanedChild?.tetherParentId).toBeUndefined();
    expect((cleanedChild?.data as FileBlockData).parentFolderPath).toBeUndefined();
    expect(cleanedChild?.sourcePath).toBe('src/index.ts');
    expect((cleanedChild?.data as FileBlockData).path).toBe('src/index.ts');
  });

  it('removes A and promotes B to chain root when intermediate link A -> B is deleted while B -> C stays', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Promote Root');
    const grp = await store.createGroup(proj.id, 'Main');

    const a = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'a.ts',
      data: { path: 'a.ts', language: 'typescript', currentContent: '', revisions: [] },
    });
    const b = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'b.ts',
      data: { path: 'b.ts', language: 'typescript', currentContent: '', revisions: [] },
    });
    const c = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'c.ts',
      data: { path: 'c.ts', language: 'typescript', currentContent: '', revisions: [] },
    });

    const tAB = await store.createTether(a.id, b.id, 'dependency');
    await store.createTether(b.id, c.id, 'dependency');

    // Delete A -> B
    await store.deleteTether(tAB!.id);

    const state = useWorkspaceStore.getState();
    const project = state.projects.find((p) => p.id === proj.id);
    const stateA = state.blocks.find((blk) => blk.id === a.id);
    const stateB = state.blocks.find((blk) => blk.id === b.id);
    const stateC = state.blocks.find((blk) => blk.id === c.id);

    expect(stateA?.isInFolderStructure).toBe(false);
    expect(stateB?.isInFolderStructure).toBe(true);
    expect(stateB?.tetherParentId).toBeUndefined();
    expect(stateB?.sourcePath).toBe('b.ts');

    expect(stateC?.isInFolderStructure).toBe(true);
    expect(stateC?.tetherParentId).toBe(b.id);
    expect(stateC?.sourcePath).toBe('b/c.ts');

    const treeIds = flattenTreeFileIds(project?.folderStructure);
    expect(treeIds).not.toContain(a.id);
    expect(treeIds.sort()).toEqual([b.id, c.id].sort());
  });

  it('maintains atomic consistency under rapid successive tether and un-tether operations', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Rapid Sync');
    const grp = await store.createGroup(proj.id, 'Main');

    const blocks = await Promise.all(
      ['one.ts', 'two.ts', 'three.ts', 'four.ts'].map((title) =>
        store.createBlock({
          projectId: proj.id,
          groupId: grp.id,
          kind: 'code',
          title,
          data: { path: title, language: 'typescript', currentContent: '', revisions: [] },
        })
      )
    );

    const [t1, t2, t3] = await Promise.all([
      store.createTether(blocks[0].id, blocks[1].id, 'dependency'),
      store.createTether(blocks[1].id, blocks[2].id, 'dependency'),
      store.createTether(blocks[0].id, blocks[3].id, 'dependency'),
    ]);

    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    expect(t3).not.toBeNull();

    // Rapid un-tether + re-tether burst
    await Promise.all([
      store.deleteTether(t3!.id),
      store.deleteTether(t1!.id),
      store.createTether(blocks[2].id, blocks[3].id, 'dependency'),
    ]);

    const state = useWorkspaceStore.getState();
    const project = state.projects.find((p) => p.id === proj.id);
    const treeIds = flattenTreeFileIds(project?.folderStructure);

    // Remaining active tethers: blocks[1] -> blocks[2] and blocks[2] -> blocks[3]
    // So blocks[0] must be completely removed from the folder structure; 1, 2, 3 remain.
    expect(state.blocks.find((b) => b.id === blocks[0].id)?.isInFolderStructure).toBe(false);
    expect(treeIds).not.toContain(blocks[0].id);
    expect(treeIds.sort()).toEqual([blocks[1].id, blocks[2].id, blocks[3].id].sort());
    expect(state.blocks.find((b) => b.id === blocks[3].id)?.sourcePath).toBe('two/three/four.ts');
  });

  it('computes preview-tab collapse defaults and lightweight line/byte metrics accurately', () => {
    // Tethered child defaults to compact preview tab unless explicitly expanded
    expect(isBlockPreviewTabCollapsed({ collapsed: undefined }, true)).toBe(true);
    expect(isBlockPreviewTabCollapsed({ collapsed: false }, true)).toBe(false);
    expect(isBlockPreviewTabCollapsed({ collapsed: true }, false)).toBe(true);
    expect(isBlockPreviewTabCollapsed({ collapsed: undefined }, false)).toBe(false);

    const sample = Array.from({ length: 15 }, (_, i) => `line-${i + 1}`).join('\n');
    const preview = extractLinePreview(sample, 10);
    expect(preview.previewLines.length).toBe(10);
    expect(preview.previewLines[0]).toBe('line-1');
    expect(preview.previewLines[9]).toBe('line-10');
    expect(preview.totalLines).toBe(15);
    expect(preview.hiddenLines).toBe(5);
    expect(countLinesFast(sample)).toBe(15);

    expect(utf8ByteLength('hello 🚀')).toBe(new Blob(['hello 🚀']).size);
  });
});
