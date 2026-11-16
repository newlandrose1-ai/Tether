import { describe, it, expect, beforeEach } from 'bun:test';
import JSZip from 'jszip';
import { useWorkspaceStore } from '../src/store/workspaceStore';
import {
  setForceInMemory,
  inMemoryStore,
  replaceWorkspaceStorage,
} from '../src/lib/storage';
import {
  computeRelativeAssetPath,
  inferMediaRoleAndFolder,
  resolveHtmlPreviewLocalAssets,
} from '../src/lib/imageAssets';
import { buildCategoryApplicationPatch } from '../src/lib/projectCategories';
import { buildProjectZip } from '../src/lib/projectZipExport';
import type { CodeBlockData, FileBlockData, FolderStructureNode } from '../src/types/model';

function flattenPaths(nodes: FolderStructureNode[] | undefined): string[] {
  if (!nodes) return [];
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.path);
    if (n.children) out.push(...flattenPaths(n.children));
  }
  return out;
}

describe('Image Attachment, Smart Media Placement & Preview Sync', () => {
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
      imageModalRequest: null,
      imageFeedback: null,
    });
  });

  it('infers sensible media categories and seed folders from filenames', () => {
    expect(inferMediaRoleAndFolder('favicon.ico')).toEqual({
      categoryId: 'media-favicon',
      folder: 'public',
    });
    expect(inferMediaRoleAndFolder('app-icon.svg')).toEqual({
      categoryId: 'media-icon',
      folder: 'assets/icons',
    });
    expect(inferMediaRoleAndFolder('gallery-01.jpg')).toEqual({
      categoryId: 'media-gallery',
      folder: 'assets/images/gallery',
    });
    expect(inferMediaRoleAndFolder('hero-bg.png')).toEqual({
      categoryId: 'media-bg',
      folder: 'assets/backgrounds',
    });
    expect(inferMediaRoleAndFolder('product.png')).toEqual({
      categoryId: 'media-asset',
      folder: 'assets/images',
    });
  });

  it('adds favicon and batch gallery images, keeps seed folder paths on tether, inserts valid HTML refs, passes audit, and exports to ZIP', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Gallery Site');
    const grp = await store.createGroup(proj.id, 'Main');

    const htmlBlock = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'index.html',
      sourcePath: 'index.html',
      data: {
        path: 'index.html',
        language: 'html',
        currentContent: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Gallery</title>
</head>
<body>
  <h1>Welcome</h1>
</body>
</html>
`,
        revisions: [],
      },
    });

    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`;

    // 1. Add Favicon and attach to index.html
    const favRes = await useWorkspaceStore.getState().addImageAssetsToProject({
      projectId: proj.id,
      groupId: grp.id,
      items: [
        {
          fileName: 'favicon.png',
          mimeType: 'image/png',
          size: pngBytes.byteLength,
          binary: true,
          dataUrl: pngDataUrl,
          mediaCategory: 'media-favicon',
          folderPath: 'public',
        },
      ],
      defaultMediaCategory: 'media-favicon',
      defaultFolderPath: 'public',
      attachToBlockId: htmlBlock.id,
      insertCodeReference: true,
    });

    expect(favRes.createdBlocks).toHaveLength(1);
    expect(favRes.insertedSnippet).toContain('./public/favicon.png');

    // 2. Add Batch Gallery images and attach to index.html
    const galRes = await useWorkspaceStore.getState().addImageAssetsToProject({
      projectId: proj.id,
      groupId: grp.id,
      items: [
        {
          fileName: 'sunset-shot.png',
          mimeType: 'image/png',
          size: pngBytes.byteLength,
          binary: true,
          dataUrl: pngDataUrl,
          mediaCategory: 'media-gallery',
          folderPath: 'assets/images/gallery',
        },
        {
          fileName: 'mountain-shot.svg',
          mimeType: 'image/svg+xml',
          size: 42,
          binary: false,
          content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
          mediaCategory: 'media-gallery',
          folderPath: 'assets/images/gallery',
        },
      ],
      defaultMediaCategory: 'media-gallery',
      defaultFolderPath: 'assets/images/gallery',
      attachToBlockId: htmlBlock.id,
      insertCodeReference: true,
    });

    expect(galRes.createdBlocks).toHaveLength(2);
    expect(galRes.insertedSnippet).toContain('<section class="gallery">');
    expect(galRes.insertedSnippet).toContain('./assets/images/gallery/sunset-shot.png');
    expect(galRes.insertedSnippet).toContain('./assets/images/gallery/mountain-shot.svg');

    // Check seed folderStructure keeps exact media folder paths even when tethered
    const latestState = useWorkspaceStore.getState();
    const updatedProj = latestState.projects.find((p) => p.id === proj.id)!;
    const treePaths = flattenPaths(updatedProj.folderStructure);
    expect(treePaths).toContain('public/favicon.png');
    expect(treePaths).toContain('assets/images/gallery/sunset-shot.png');
    expect(treePaths).toContain('assets/images/gallery/mountain-shot.svg');

    // Check index.html code contains <link rel="icon"> inside <head> and <section class="gallery"> inside <body>
    const updatedHtml = latestState.blocks.find((b) => b.id === htmlBlock.id)!;
    const htmlCode = (updatedHtml.data as CodeBlockData).currentContent;
    expect(htmlCode).toContain('<link rel="icon" type="image/png" href="./public/favicon.png" />');
    expect(htmlCode).toContain('<section class="gallery">');

    // Audit index.html — must have 0 missing-asset-ref errors
    const auditResult = await useWorkspaceStore.getState().auditBlock(htmlBlock.id);
    expect(auditResult.findings.some((f) => f.ruleId === 'missing-asset-ref')).toBe(false);
    expect(auditResult.errorCount).toBe(0);

    // Build real ZIP archive and inspect every file
    const { zip } = buildProjectZip(updatedProj, useWorkspaceStore.getState().blocks, {
      includeUntethered: true,
    });
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const loadedZip = await JSZip.loadAsync(zipBytes);
    expect(loadedZip.file('public/favicon.png')).toBeTruthy();
    expect(loadedZip.file('assets/images/gallery/sunset-shot.png')).toBeTruthy();
    expect(loadedZip.file('assets/images/gallery/mountain-shot.svg')).toBeTruthy();

    const exportedFavBytes = await loadedZip.file('public/favicon.png')!.async('uint8array');
    expect(Array.from(exportedFavBytes)).toEqual(Array.from(pngBytes));

    // HTML live preview resolution substitutes local relative paths with data URLs
    const resolvedPreviewHtml = resolveHtmlPreviewLocalAssets(
      htmlCode,
      'index.html',
      useWorkspaceStore.getState().blocks
    );
    expect(resolvedPreviewHtml).toContain(pngDataUrl);
    expect(resolvedPreviewHtml).toContain('data:image/svg+xml');
  });

  it('moves and renames an image block atomically across sourcePath, folderStructure, and ZIP export', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Relocate Test');
    const grp = await store.createGroup(proj.id, 'Media');

    const htmlBlock = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'index.html',
      sourcePath: 'index.html',
      data: {
        path: 'index.html',
        language: 'html',
        currentContent: '<html><body></body></html>',
        revisions: [],
      },
    });

    const { createdBlocks } = await useWorkspaceStore.getState().addImageAssetsToProject({
      projectId: proj.id,
      groupId: grp.id,
      items: [
        {
          fileName: 'logo.svg',
          mimeType: 'image/svg+xml',
          size: 30,
          binary: false,
          content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          mediaCategory: 'media-asset',
          folderPath: 'assets/images',
        },
      ],
      attachToBlockId: htmlBlock.id,
      insertCodeReference: false,
    });

    const imgId = createdBlocks[0].id;
    const moved = await useWorkspaceStore
      .getState()
      .moveOrRenameAssetBlock(imgId, 'public/favicon.svg', 'media-favicon');

    expect(moved).toBeTruthy();
    expect(moved?.title).toBe('favicon.svg');
    expect(moved?.sourcePath).toBe('public/favicon.svg');
    expect(moved?.projectCategory).toBe('media-favicon');

    const latestState = useWorkspaceStore.getState();
    const updatedProj = latestState.projects.find((p) => p.id === proj.id)!;
    const treePaths = flattenPaths(updatedProj.folderStructure);
    expect(treePaths).toContain('public/favicon.svg');
    expect(treePaths).not.toContain('assets/images/logo.svg');
  });

  it('computes accurate relative paths and attaches existing images to nested CSS files', async () => {
    expect(computeRelativeAssetPath('styles/main.css', 'assets/backgrounds/hero.png')).toBe(
      '../assets/backgrounds/hero.png'
    );

    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Nested Styles');
    const grp = await store.createGroup(proj.id, 'UI');

    const cssBlock = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'main.css',
      sourcePath: 'styles/main.css',
      data: {
        path: 'styles/main.css',
        language: 'css',
        currentContent: 'body { margin: 0; }\n',
        revisions: [],
      },
    });

    const bgRes = await useWorkspaceStore.getState().addImageAssetsToProject({
      projectId: proj.id,
      groupId: grp.id,
      items: [
        {
          fileName: 'hero.svg',
          mimeType: 'image/svg+xml',
          size: 20,
          binary: false,
          content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          mediaCategory: 'media-bg',
          folderPath: 'assets/backgrounds',
        },
      ],
      defaultMediaCategory: 'media-bg',
      defaultFolderPath: 'assets/backgrounds',
    });

    const attachRes = await useWorkspaceStore.getState().attachExistingImagesToBlock({
      targetCodeBlockId: cssBlock.id,
      imageBlockIds: [bgRes.createdBlocks[0].id],
      role: 'media-bg',
      insertCodeReference: true,
    });

    expect(attachRes.attachedCount).toBe(1);
    expect(attachRes.insertedSnippet).toContain('../assets/backgrounds/hero.svg');

    const updatedCss = useWorkspaceStore
      .getState()
      .blocks.find((b) => b.id === cssBlock.id)!;
    expect((updatedCss.data as CodeBlockData).currentContent).toContain(
      "background-image: url('../assets/backgrounds/hero.svg')"
    );
  });

  it('preserves binary image dataUrl and mimeType when assigning media-favicon category', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Category Patch Test');
    const grp = await store.createGroup(proj.id, 'Assets');

    const pngBlock = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'file',
      title: 'custom-badge.png',
      sourcePath: 'custom-badge.png',
      data: {
        path: 'custom-badge.png',
        mimeType: 'image/png',
        size: 12,
        binary: true,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      },
    });

    const patch = buildCategoryApplicationPatch(pngBlock, 'media-favicon');
    expect(patch).toBeTruthy();
    expect(patch?.kind).toBe('file');
    expect(patch?.title).toBe('custom-badge.png');
    expect(patch?.sourcePath).toBe('public/custom-badge.png');
    expect((patch?.data as FileBlockData).binary).toBe(true);
    expect((patch?.data as FileBlockData).dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});
