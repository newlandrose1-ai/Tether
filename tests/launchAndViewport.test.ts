import { beforeEach, describe, expect, test } from 'bun:test';
import { useWorkspaceStore } from '../src/store/workspaceStore';
import {
  canUseBrowserFullscreen,
  enterBrowserFullscreen,
  exitBrowserFullscreen,
  isBrowserFullscreen,
} from '../src/lib/viewportFullscreen';

describe('Launch Menu, Fullscreen Controls & Graceful Exit', () => {
  beforeEach(() => {
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
      isEditorOpen: false,
      openBlockIds: [],
      activeEditorBlockId: null,
      hasLaunchedWorkspace: false,
      lastExitedAt: null,
      isExitConfirmOpen: false,
      auditModalRequest: null,
      imageModalRequest: null,
    });
  });

  test('starts on the Launch Menu before entering workspace and enters with optional project switch', async () => {
    const store = useWorkspaceStore.getState();
    expect(store.hasLaunchedWorkspace).toBe(false);

    const p1 = await store.createProject('Alpha');
    await store.createGroup(p1.id, 'Main');
    const p2 = await store.createProject('Beta');
    const g2 = await store.createGroup(p2.id, 'Core');

    useWorkspaceStore.getState().enterWorkspace(p2.id);
    const updated = useWorkspaceStore.getState();
    expect(updated.hasLaunchedWorkspace).toBe(true);
    expect(updated.activeProjectId).toBe(p2.id);
    expect(updated.activeGroupId).toBe(g2.id);
    expect(updated.lastExitedAt).toBeNull();
  });

  test('graceful exit closes transient overlays, clears exit dialog, and returns to launch menu', async () => {
    const store = useWorkspaceStore.getState();
    const p1 = await store.createProject('Gamma');
    const g1 = await store.createGroup(p1.id, 'Root');
    const blk = await store.createBlock({
      projectId: p1.id,
      groupId: g1.id,
      kind: 'code',
      title: 'index.js',
    });

    store.enterWorkspace();
    store.openBlockInEditor(blk.id);
    store.setFocusedBlockId(blk.id);
    store.setConnectingSourceBlockId(blk.id);
    store.openAuditModal({ targetType: 'block', blockId: blk.id });
    store.openExitConfirm();

    expect(useWorkspaceStore.getState().isExitConfirmOpen).toBe(true);

    useWorkspaceStore.getState().exitWorkspaceGracefully();
    const afterExit = useWorkspaceStore.getState();

    expect(afterExit.hasLaunchedWorkspace).toBe(false);
    expect(afterExit.isExitConfirmOpen).toBe(false);
    expect(afterExit.isEditorOpen).toBe(false);
    expect(afterExit.focusedBlockId).toBeNull();
    expect(afterExit.connectingSourceBlockId).toBeNull();
    expect(afterExit.auditModalRequest).toBeNull();
    expect(afterExit.lastExitedAt).not.toBeNull();
    // Workspace project & blocks remain intact after graceful exit
    expect(afterExit.projects.length).toBe(1);
    expect(afterExit.blocks.length).toBe(1);
  });

  test('fullscreen helpers handle enter, exit, and blocked host frames safely', async () => {
    let activeEl: Element | null = null;
    const mockRoot = {
      requestFullscreen: async () => {
        activeEl = mockRoot as unknown as Element;
      },
    } as unknown as HTMLElement;

    const mockDoc = {
      fullscreenEnabled: true,
      get fullscreenElement() {
        return activeEl;
      },
      documentElement: mockRoot,
      exitFullscreen: async () => {
        activeEl = null;
      },
    } as unknown as Document;

    expect(canUseBrowserFullscreen(mockDoc)).toBe(true);
    expect(isBrowserFullscreen(mockDoc)).toBe(false);

    const enterRes = await enterBrowserFullscreen(mockDoc);
    expect(enterRes.entered).toBe(true);
    expect(isBrowserFullscreen(mockDoc)).toBe(true);

    const exited = await exitBrowserFullscreen(mockDoc);
    expect(exited).toBe(true);
    expect(isBrowserFullscreen(mockDoc)).toBe(false);

    const blockedDoc = {
      fullscreenEnabled: false,
      fullscreenElement: null,
      documentElement: {
        requestFullscreen: async () => {
          throw new Error('Disallowed by permissions policy');
        },
      },
    } as unknown as Document;

    const blockedRes = await enterBrowserFullscreen(blockedDoc);
    expect(blockedRes.entered).toBe(false);
    expect(blockedRes.fallbackReason).toBeTruthy();
  });
});
