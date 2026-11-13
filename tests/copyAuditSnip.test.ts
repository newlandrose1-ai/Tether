import { describe, it, expect, beforeEach } from 'bun:test';
import { runCodeAudit } from '../src/lib/codeAudit';
import { useWorkspaceStore } from '../src/store/workspaceStore';
import {
  setForceInMemory,
  inMemoryStore,
  replaceWorkspaceStorage,
} from '../src/lib/storage';
import type { UploadBlockData, FileBlockData, CodeBlockData } from '../src/types/model';

describe('Copy -> Audit -> Highlight -> Snip & Folder Tether Workflow', () => {
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

  it('runCodeAudit detects TypeScript/JavaScript syntax errors with line/column offsets', () => {
    const brokenTs = [
      'export function greet(name: string) {',
      '  const msg = "hello" + ;',
      '  return msg;',
      '}',
    ].join('\n');

    const result = runCodeAudit({
      content: brokenTs,
      language: 'typescript',
      path: 'src/greet.ts',
    });

    expect(result.passed).toBe(false);
    expect(result.errorCount).toBeGreaterThanOrEqual(1);
    expect(result.findings[0].severity).toBe('error');
    expect(result.findings[0].line).toBe(2);
    expect(typeof result.findings[0].column).toBe('number');
    expect(typeof result.findings[0].from).toBe('number');
    expect(typeof result.findings[0].to).toBe('number');
  });

  it('runCodeAudit detects JSON syntax errors, merge conflicts, and secret exposures', () => {
    const brokenJson = '{\n  "name": "tether",\n  "broken": \n}';
    const jsonAudit = runCodeAudit({
      content: brokenJson,
      language: 'json',
      path: 'package.json',
    });
    expect(jsonAudit.passed).toBe(false);
    expect(jsonAudit.errorCount).toBeGreaterThanOrEqual(1);

    const conflictAndSecret = [
      '<<<<<<< HEAD',
      'const key = "-----BEGIN PRIVATE KEY-----";',
      '>>>>>>> feature',
    ].join('\n');
    const secAudit = runCodeAudit({
      content: conflictAndSecret,
      language: 'javascript',
      path: 'src/config.js',
    });
    expect(secAudit.passed).toBe(false);
    expect(secAudit.findings.some((f) => f.ruleId === 'merge-conflict')).toBe(true);
    expect(secAudit.findings.some((f) => f.ruleId === 'secret-exposure')).toBe(true);
  });

  it('runCodeAudit passes clean code cleanly', () => {
    const cleanTs = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
    const result = runCodeAudit({
      content: cleanTs,
      language: 'typescript',
      path: 'src/math.ts',
    });

    expect(result.passed).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(result.findings.length).toBe(0);
  });

  it('defaults to canvas-first view with closed editor modal until activated', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Canvas First');
    const grp = await store.createGroup(proj.id, 'Main');
    const blk = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'app.ts',
      data: {
        path: 'src/app.ts',
        language: 'typescript',
        currentContent: 'export const ok = true;\n',
        revisions: [],
      },
    });

    const stateBefore = useWorkspaceStore.getState();
    expect(stateBefore.viewMode).toBe('canvas');
    expect(stateBefore.isEditorOpen).toBe(false);

    stateBefore.openBlockInEditor(blk.id);
    const stateOpen = useWorkspaceStore.getState();
    expect(stateOpen.isEditorOpen).toBe(true);
    expect(stateOpen.activeEditorBlockId).toBe(blk.id);

    stateOpen.closeEditorModal();
    expect(useWorkspaceStore.getState().isEditorOpen).toBe(false);
    expect(useWorkspaceStore.getState().viewMode).toBe('canvas');
  });

  it('enforces audit gate before snipping old block, transfers tethers, and preserves folder membership', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Audit Snip Project');
    const grp = await store.createGroup(proj.id, 'Archive Group');

    // Create an Upload archive block + folder structure + peer blocks tethered to oldBlock
    const uploadBlock = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'upload',
      title: 'bundle.zip',
      x: 50,
      y: 80,
      data: {
        fileName: 'bundle.zip',
        size: 1024,
        extractedBlockIds: [],
        expandedFolderPaths: ['src/core'],
      },
    });

    const oldBlock = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'file',
      title: 'engine.ts',
      x: 400,
      y: 120,
      data: {
        path: 'src/core/engine.ts',
        parentFolderPath: 'src/core',
        mimeType: 'text/typescript',
        size: 64,
        binary: false,
        content: 'export function runEngine() {\n  return 1;\n}\n',
      },
    });

    await store.updateBlockData(uploadBlock.id, {
      extractedBlockIds: [oldBlock.id],
    });

    const helperBlock = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'logger.ts',
      x: 800,
      y: 120,
      data: {
        path: 'src/core/logger.ts',
        language: 'typescript',
        currentContent: 'export const log = (m: string) => m;\n',
        revisions: [],
      },
    });

    // Tethers connected to oldBlock
    await store.createTether(uploadBlock.id, oldBlock.id, 'extracted from');
    await store.createTether(oldBlock.id, helperBlock.id, 'dependency');

    // 1. Copy oldBlock for editing
    const newBlock = await store.copyBlockForEdit(oldBlock.id);
    expect(newBlock).not.toBeNull();
    if (!newBlock) return;

    let state = useWorkspaceStore.getState();
    expect(state.isEditorOpen).toBe(true);
    expect(state.activeEditorBlockId).toBe(newBlock.id);
    expect(newBlock.copiedFromBlockId).toBe(oldBlock.id);

    // Copied block is registered in archive extractedBlockIds and connected with 'copied from'
    const refreshedUpload = state.blocks.find((b) => b.id === uploadBlock.id);
    expect((refreshedUpload?.data as UploadBlockData).extractedBlockIds).toContain(newBlock.id);
    expect(
      state.tethers.some(
        (t) =>
          t.sourceBlockId === oldBlock.id &&
          t.targetBlockId === newBlock.id &&
          t.label === 'copied from'
      )
    ).toBe(true);

    // 2. Introduce a syntax error and run audit -> audit fails & snipping is blocked
    const brokenAudit = await store.auditBlock(
      newBlock.id,
      'export function runEngine() {\n  return (;\n}\n'
    );
    expect(brokenAudit.passed).toBe(false);
    expect(brokenAudit.errorCount).toBeGreaterThanOrEqual(1);

    const blockedSnip = await store.snipOldBlock(newBlock.id);
    expect(blockedSnip.success).toBe(false);
    expect(useWorkspaceStore.getState().blocks.some((b) => b.id === oldBlock.id)).toBe(true);

    // 3. Fix code and pass audit
    const cleanAudit = await store.auditBlock(
      newBlock.id,
      'export function runEngine(): number {\n  return 42;\n}\n'
    );
    expect(cleanAudit.passed).toBe(true);
    expect(cleanAudit.errorCount).toBe(0);

    // 4. Editing after a passing audit invalidates hash so snipping is blocked again until re-audited
    await store.updateBlockData(newBlock.id, {
      content: 'export function runEngine(): number {\n  return 99;\n}\n',
    });
    const staleSnip = await store.snipOldBlock(newBlock.id);
    expect(staleSnip.success).toBe(false);

    // 5. Re-audit current code -> passes -> Snip Old Block succeeds!
    const reAudit = await store.auditBlock(newBlock.id);
    expect(reAudit.passed).toBe(true);

    const snipRes = await store.snipOldBlock(newBlock.id);
    expect(snipRes.success).toBe(true);
    expect(snipRes.transferredTetherCount).toBeGreaterThanOrEqual(2);

    state = useWorkspaceStore.getState();

    // Old block and 'copied from' tether are removed
    expect(state.blocks.some((b) => b.id === oldBlock.id)).toBe(false);
    expect(state.tethers.some((t) => t.label === 'copied from')).toBe(false);

    // New block inherited oldBlock's folder path, position, extractedBlockIds, and tethers
    const survivingNew = state.blocks.find((b) => b.id === newBlock.id);
    expect(survivingNew).toBeDefined();
    expect(survivingNew?.copiedFromBlockId).toBeUndefined();
    expect(survivingNew?.x).toBe(oldBlock.x);
    expect(survivingNew?.y).toBe(oldBlock.y);
    expect((survivingNew?.data as FileBlockData).parentFolderPath).toBe('src/core');

    const finalUpload = state.blocks.find((b) => b.id === uploadBlock.id);
    const extractedIds = (finalUpload?.data as UploadBlockData).extractedBlockIds;
    expect(extractedIds).toContain(newBlock.id);
    expect(extractedIds).not.toContain(oldBlock.id);

    // Dependency tether transferred to newBlock -> helperBlock
    expect(
      state.tethers.some(
        (t) =>
          t.sourceBlockId === newBlock.id &&
          t.targetBlockId === helperBlock.id &&
          t.label === 'dependency'
      )
    ).toBe(true);
    // Extracted tether transferred from uploadBlock -> newBlock
    expect(
      state.tethers.some(
        (t) =>
          t.sourceBlockId === uploadBlock.id &&
          t.targetBlockId === newBlock.id &&
          t.label === 'extracted from'
      )
    ).toBe(true);
  });
});
