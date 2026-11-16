import { describe, it, expect, beforeEach } from 'bun:test';
import JSZip from 'jszip';
import { useWorkspaceStore } from '../src/store/workspaceStore';
import {
  setForceInMemory,
  inMemoryStore,
  replaceWorkspaceStorage,
} from '../src/lib/storage';
import {
  buildProjectZip,
  collectProjectZipManifest,
} from '../src/lib/projectZipExport';
import { exportProjectToWebZip } from '../src/lib/webHtmlExport';
import type { CodeBlockData } from '../src/types/model';

describe('Real .zip Project Export & Generic Project Categories', () => {
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

  it('builds a real downloadable JSZip archive matching nested tethered chains, untethered files, and binary assets', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Pixel Dungeon Demo');
    const grp = await store.createGroup(proj.id, 'Core');

    // Upload shell (should NOT appear as an empty file in the exported zip)
    await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'upload',
      title: 'seed-archive.zip',
      data: { fileName: 'seed-archive.zip', size: 1200, extractedBlockIds: [] },
    });

    // Nested tethered chain: engine -> combat -> damage
    const engine = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'engine.ts',
      data: {
        path: 'src/engine.ts',
        language: 'typescript',
        currentContent: 'export const tick = () => 1;\n',
        revisions: [],
      },
    });

    const combat = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'combat.ts',
      data: {
        path: 'combat.ts',
        language: 'typescript',
        currentContent: 'export const hit = (a: number) => a * 2;\n',
        revisions: [],
      },
    });

    const damage = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'damage.ts',
      data: {
        path: 'damage.ts',
        language: 'typescript',
        currentContent: 'export const crit = 1.5;\n',
        revisions: [],
      },
    });

    await useWorkspaceStore.getState().createTether(engine.id, combat.id, 'imports');
    await useWorkspaceStore.getState().createTether(combat.id, damage.id, 'calls');

    // Untethered README.md
    await useWorkspaceStore.getState().createBlockFromCategory(proj.id, grp.id, 'readme-md');

    // Binary PNG block (4 arbitrary bytes encoded cleanly as base64 dataUrl)
    const rawBytes = new Uint8Array([137, 80, 78, 71]);
    const base64Bytes = Buffer.from(rawBytes).toString('base64');
    await useWorkspaceStore.getState().createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'file',
      title: 'sprite.png',
      sourcePath: 'assets/sprite.png',
      data: {
        path: 'assets/sprite.png',
        mimeType: 'image/png',
        size: rawBytes.byteLength,
        binary: true,
        dataUrl: `data:image/png;base64,${base64Bytes}`,
      },
    });

    const state = useWorkspaceStore.getState();
    const liveProj = state.projects.find((p) => p.id === proj.id)!;
    const { zip, manifest } = buildProjectZip(liveProj, state.blocks, {
      includeUntethered: true,
    });

    expect(manifest.archiveFileName).toBe('pixel-dungeon-demo.zip');
    expect(manifest.tetheredFileCount).toBe(3);
    expect(manifest.untetheredFileCount).toBe(2);
    expect(manifest.files.some((f) => f.name === 'seed-archive.zip')).toBe(false);

    // Round-trip through real JSZip compression & parsing
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const loaded = await JSZip.loadAsync(zipBytes);

    expect(loaded.file('seed-archive.zip')).toBeNull();
    expect(await loaded.file('src/engine.ts')?.async('string')).toBe(
      'export const tick = () => 1;\n'
    );
    expect(await loaded.file('src/engine/combat.ts')?.async('string')).toBe(
      'export const hit = (a: number) => a * 2;\n'
    );
    expect(await loaded.file('src/engine/combat/damage.ts')?.async('string')).toBe(
      'export const crit = 1.5;\n'
    );
    expect(await loaded.file('README.md')?.async('string')).toContain('# Project Name');

    const extractedBinary = await loaded.file('assets/sprite.png')?.async('uint8array');
    expect(Array.from(extractedBinary || [])).toEqual([137, 80, 78, 71]);
  });

  it('keeps the exported .zip in sync after live tether and un-tether operations', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Live Sync Zip');
    const grp = await store.createGroup(proj.id, 'Main');

    const a = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'a.js',
      data: { path: 'a.js', language: 'javascript', currentContent: 'const a = 1;\n', revisions: [] },
    });
    const b = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'b.js',
      data: { path: 'b.js', language: 'javascript', currentContent: 'const b = 2;\n', revisions: [] },
    });

    // Tether a -> b
    const tether = await useWorkspaceStore.getState().createTether(a.id, b.id);
    let state = useWorkspaceStore.getState();
    let liveProj = state.projects.find((p) => p.id === proj.id)!;

    let tetheredManifest = collectProjectZipManifest(liveProj, state.blocks, {
      includeUntethered: false,
    });
    expect(tetheredManifest.files.map((f) => f.path)).toEqual(['a.js', 'a/b.js']);

    // Un-tether a -> b
    await useWorkspaceStore.getState().deleteTether(tether.id);
    state = useWorkspaceStore.getState();
    liveProj = state.projects.find((p) => p.id === proj.id)!;

    // Seed-only mode removes untethered block completely
    tetheredManifest = collectProjectZipManifest(liveProj, state.blocks, {
      includeUntethered: false,
    });
    expect(tetheredManifest.files.length).toBe(0);

    // Default mode (includeUntethered: true) moves b.js back to root path
    const fullManifest = collectProjectZipManifest(liveProj, state.blocks, {
      includeUntethered: true,
    });
    expect(fullManifest.files.map((f) => f.path)).toEqual(['a.js', 'b.js']);
    expect(fullManifest.tetheredFileCount).toBe(0);
    expect(fullManifest.untetheredFileCount).toBe(2);
  });

  it('converts empty and non-empty blocks to standard project file & folder categories and exports them into proper folders', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Game Starter');
    const grp = await store.createGroup(proj.id, 'Root');

    // 1. Empty Note 1 -> package.json
    const note = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'text',
      title: 'Note 1',
      data: { content: '' },
    });
    await useWorkspaceStore.getState().applyBlockProjectCategory(note.id, 'package-json');

    let updatedNote = useWorkspaceStore.getState().blocks.find((b) => b.id === note.id)!;
    expect(updatedNote.title).toBe('package.json');
    expect(updatedNote.sourcePath).toBe('package.json');
    expect(updatedNote.kind).toBe('code');
    expect((updatedNote.data as CodeBlockData).language).toBe('json');
    expect(() => JSON.parse((updatedNote.data as CodeBlockData).currentContent)).not.toThrow();

    // 2. Non-empty custom block -> folder-src (must keep custom filename & content, relocate to src/)
    const custom = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'my-script.js',
      data: {
        path: 'my-script.js',
        language: 'javascript',
        currentContent: 'console.log(123);\n',
        revisions: [],
      },
    });
    await useWorkspaceStore.getState().applyBlockProjectCategory(custom.id, 'folder-src');

    let updatedCustom = useWorkspaceStore.getState().blocks.find((b) => b.id === custom.id)!;
    expect(updatedCustom.title).toBe('my-script.js');
    expect(updatedCustom.sourcePath).toBe('src/my-script.js');
    expect((updatedCustom.data as CodeBlockData).currentContent).toBe('console.log(123);\n');

    // Tethering under a parent preserves the folder-category prefix inside parent's folder
    await useWorkspaceStore.getState().createTether(updatedNote.id, updatedCustom.id, 'entry');
    updatedCustom = useWorkspaceStore.getState().blocks.find((b) => b.id === custom.id)!;
    expect(updatedCustom.sourcePath).toBe('package/src/my-script.js');

    // 3. Create standard project files & folders via createBlockFromCategory
    const extraCategories = [
      'readme-txt',
      'license',
      'license-md',
      'cargo-toml',
      'requirements-txt',
      'gitignore',
      'index-html',
      'main-py',
      'main-js',
      'folder-assets',
      'folder-config',
      'folder-build',
      'folder-dist',
    ];
    for (const catId of extraCategories) {
      await useWorkspaceStore.getState().createBlockFromCategory(proj.id, grp.id, catId);
    }

    const state = useWorkspaceStore.getState();
    const liveProj = state.projects.find((p) => p.id === proj.id)!;
    const { zip } = buildProjectZip(liveProj, state.blocks, { includeUntethered: true });
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));

    const fileKeys = Object.keys(loaded.files).filter((k) => !loaded.files[k].dir);
    expect(fileKeys).toContain('package.json');
    expect(fileKeys).toContain('package/src/my-script.js');
    expect(fileKeys).toContain('README.txt');
    expect(fileKeys).toContain('LICENSE');
    expect(fileKeys).toContain('LICENSE.md');
    expect(fileKeys).toContain('Cargo.toml');
    expect(fileKeys).toContain('requirements.txt');
    expect(fileKeys).toContain('.gitignore');
    expect(fileKeys).toContain('index.html');
    expect(fileKeys).toContain('main.py');
    expect(fileKeys).toContain('main.js');
    expect(fileKeys).toContain('assets/manifest.json');
    expect(fileKeys).toContain('config/settings.json');
    expect(fileKeys).toContain('build/.gitkeep');
    expect(fileKeys).toContain('dist/.gitkeep');

    // Also verify dotfile & extensionless preservation in webHtmlExport bundle check
    expect(typeof exportProjectToWebZip).toBe('function');
  });
});
