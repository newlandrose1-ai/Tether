import type {
  Block,
  BlockData,
  CodeBlockData,
  FileBlockData,
  FolderStructureNode,
  Project,
  Tether,
  UploadBlockData,
} from '../types/model';

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/**
 * Fast UTF-8 byte length calculation without allocating a Blob on every render.
 */
export function utf8ByteLength(text: string): number {
  if (!text) return 0;
  if (encoder) {
    return encoder.encode(text).byteLength;
  }
  return text.length;
}

/**
 * Counts lines in O(n) without splitting the whole file into an array of strings.
 */
export function countLinesFast(content: string): number {
  if (!content) return 1;
  let count = 1;
  let idx = -1;
  while ((idx = content.indexOf('\n', idx + 1)) !== -1) {
    count++;
  }
  return count;
}

/**
 * Extracts at most `maxLines` from the start of a string plus total line count
 * without splitting large files into giant string arrays.
 */
export function extractLinePreview(
  content: string,
  maxLines = 10
): { previewLines: string[]; totalLines: number; hiddenLines: number } {
  if (!content) {
    return { previewLines: [''], totalLines: 1, hiddenLines: 0 };
  }

  const previewLines: string[] = [];
  let start = 0;
  let totalLines = 1;
  let idx = -1;

  while ((idx = content.indexOf('\n', start)) !== -1) {
    if (previewLines.length < maxLines) {
      previewLines.push(content.slice(start, idx));
    }
    totalLines++;
    start = idx + 1;
  }

  if (previewLines.length < maxLines) {
    previewLines.push(content.slice(start));
  }

  return {
    previewLines,
    totalLines,
    hiddenLines: Math.max(0, totalLines - maxLines),
  };
}

/**
 * Determines whether a block renders as a lightweight compact Preview Tab.
 * Tethered child blocks default to compact preview-tab mode unless explicitly expanded.
 */
export function isBlockPreviewTabCollapsed(
  block: Pick<Block, 'collapsed'>,
  isTetheredChild: boolean
): boolean {
  if (block.collapsed !== undefined) {
    return Boolean(block.collapsed);
  }
  return Boolean(isTetheredChild);
}

function normalizePath(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();
}

function getLeafName(pathOrTitle: string, fallbackTitle: string): string {
  const clean = normalizePath(pathOrTitle);
  if (!clean) return fallbackTitle.trim() || 'untitled';
  const parts = clean.split('/');
  return parts[parts.length - 1] || fallbackTitle.trim() || 'untitled';
}

function getFolderContainerStem(titleOrSegment: string): string {
  const clean = titleOrSegment.trim();
  if (!clean) return 'folder';
  const dotIdx = clean.lastIndexOf('.');
  if (dotIdx > 0) {
    return clean.slice(0, dotIdx);
  }
  return clean;
}

function getContainerFolderPath(parentResolvedPath: string, parentTitle: string): string {
  const clean = normalizePath(parentResolvedPath || parentTitle);
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0) return getFolderContainerStem(parentTitle);
  const last = parts[parts.length - 1];
  const stem = getFolderContainerStem(last);
  if (parts.length === 1) return stem;
  return `${parts.slice(0, -1).join('/')}/${stem}`;
}

function getBlockCurrentPath(block: Block): string {
  const dataPath = (block.data as { path?: string } | undefined)?.path;
  return normalizePath(block.sourcePath || dataPath || block.title) || block.title;
}

function buildFolderTreeNodes(
  blocksInTree: Block[],
  parentTetherByBlockId: Map<string, Tether>
): FolderStructureNode[] {
  const rootItems: FolderStructureNode[] = [];
  const folderMap = new Map<string, FolderStructureNode>();

  const getOrCreateFolder = (
    currPath: string,
    seg: string,
    parent: FolderStructureNode | null
  ): FolderStructureNode => {
    let existing = folderMap.get(currPath);
    if (!existing) {
      existing = {
        id: `folder-${currPath}`,
        name: seg,
        path: currPath,
        isFolder: true,
        children: [],
      };
      folderMap.set(currPath, existing);
      if (parent) {
        parent.children.push(existing);
      } else {
        rootItems.push(existing);
      }
    }
    return existing;
  };

  for (const b of blocksInTree) {
    const rawPath = getBlockCurrentPath(b);
    const segments = rawPath.split('/').filter(Boolean);
    const tether = parentTetherByBlockId.get(b.id);

    if (segments.length <= 1) {
      rootItems.push({
        id: b.id,
        name: segments[0] || b.title,
        path: rawPath,
        isFolder: false,
        blockId: b.id,
        parentBlockId: b.tetherParentId,
        groupId: b.groupId,
        tetherLabel: tether?.label,
        children: [],
      });
    } else {
      const fileName = segments[segments.length - 1];
      let currPath = '';
      let parentFolder: FolderStructureNode | null = null;
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        currPath = currPath ? `${currPath}/${seg}` : seg;
        parentFolder = getOrCreateFolder(currPath, seg, parentFolder);
      }

      const fileNode: FolderStructureNode = {
        id: b.id,
        name: fileName,
        path: rawPath,
        isFolder: false,
        blockId: b.id,
        parentBlockId: b.tetherParentId,
        groupId: b.groupId,
        tetherLabel: tether?.label,
        children: [],
      };

      if (parentFolder) {
        parentFolder.children.push(fileNode);
      } else {
        rootItems.push(fileNode);
      }
    }
  }

  const sortNodes = (nodes: FolderStructureNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    for (const node of nodes) {
      if (node.isFolder && node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(rootItems);
  return rootItems;
}

function areFolderTreesEqual(
  a: FolderStructureNode[] | undefined,
  b: FolderStructureNode[]
): boolean {
  if (!a) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Atomically reconciles tether relationships and the project's folder structure
 * as a single source of truth.
 *
 * - Newly tethered blocks are added into `project.folderStructure` and nested under their parent.
 * - Multi-level tether chains (`A -> B -> C`) resolve recursively while preventing cycles.
 * - Un-tethered blocks (no active tethers) are removed from `project.folderStructure`,
 *   pruned from `UploadBlockData.extractedBlockIds`, stripped of stale `tetherParentId` /
 *   `parentFolderPath`, and restored to their clean `originalSourcePath`.
 * - Dangling tethers or references to deleted blocks are removed cleanly.
 */
export function reconcileProjectFolderState(
  projects: Project[],
  blocks: Block[],
  tethers: Tether[],
  projectId: string
): {
  projects: Project[];
  blocks: Block[];
  tethers: Tether[];
  changedProjectIds: string[];
  changedBlockIds: string[];
  removedTetherIds: string[];
} {
  const projectBlocks = blocks.filter((b) => b.projectId === projectId);
  const blockById = new Map(projectBlocks.map((b) => [b.id, b]));

  // Remove any dangling tethers pointing to missing blocks or cross-project/cross-group blocks
  const removedTetherIds: string[] = [];
  const validProjectTethers: Tether[] = [];
  const nextAllTethers: Tether[] = [];

  for (const t of tethers) {
    if (t.projectId !== projectId) {
      nextAllTethers.push(t);
      continue;
    }
    const src = blockById.get(t.sourceBlockId);
    const tgt = blockById.get(t.targetBlockId);
    if (
      !src ||
      !tgt ||
      src.id === tgt.id ||
      src.groupId !== tgt.groupId
    ) {
      removedTetherIds.push(t.id);
      continue;
    }
    validProjectTethers.push(t);
    nextAllTethers.push(t);
  }

  // Sort tethers deterministically for stable parent selection across rapid operations
  const sortedTethers = [...validProjectTethers].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  });

  // Track active participation in the tether graph
  const inTreeBlockIds = new Set<string>();
  const incomingNestingTethersByTarget = new Map<string, Tether[]>();
  const copiedFromSourceByTarget = new Map<string, Tether>();
  const uploadChildrenByUploadId = new Map<string, Set<string>>();

  for (const t of sortedTethers) {
    inTreeBlockIds.add(t.sourceBlockId);
    inTreeBlockIds.add(t.targetBlockId);

    const normalizedLabel = (t.label || '').trim().toLowerCase();
    if (normalizedLabel === 'copied from') {
      copiedFromSourceByTarget.set(t.targetBlockId, t);
    } else {
      const list = incomingNestingTethersByTarget.get(t.targetBlockId) || [];
      list.push(t);
      incomingNestingTethersByTarget.set(t.targetBlockId, list);
    }

    const srcBlock = blockById.get(t.sourceBlockId);
    if (srcBlock?.kind === 'upload') {
      if (!uploadChildrenByUploadId.has(srcBlock.id)) {
        uploadChildrenByUploadId.set(srcBlock.id, new Set<string>());
      }
      uploadChildrenByUploadId.get(srcBlock.id)!.add(t.targetBlockId);
    }
  }

  // If a copied draft was copied from an upload-extracted block, keep its upload membership
  // while the 'copied from' tether is active
  for (const [copyId, copyTether] of copiedFromSourceByTarget.entries()) {
    for (const [uploadId, childSet] of uploadChildrenByUploadId.entries()) {
      if (childSet.has(copyTether.sourceBlockId)) {
        childSet.add(copyId);
      }
    }
  }

  // Choose canonical parent tether for each block
  const chosenParentTetherByBlockId = new Map<string, Tether>();
  for (const b of projectBlocks) {
    if (!inTreeBlockIds.has(b.id)) continue;
    const incoming = incomingNestingTethersByTarget.get(b.id);
    if (incoming && incoming.length > 0) {
      // Prefer existing tetherParentId if still connected to prevent jitter on multi-parent chains
      const kept = b.tetherParentId
        ? incoming.find((t) => t.sourceBlockId === b.tetherParentId)
        : undefined;
      chosenParentTetherByBlockId.set(b.id, kept || incoming[0]);
    }
  }

  // Ensure every block has a clean originalSourcePath captured before chain nesting
  const originalPathById = new Map<string, string>();
  for (const b of projectBlocks) {
    const rawCurrent = getBlockCurrentPath(b);
    const orig = normalizePath(b.originalSourcePath || '') || rawCurrent;
    originalPathById.set(b.id, orig);
  }

  // Recursively resolve folder paths across multi-level chains with cycle protection
  const resolvedPathById = new Map<string, string>();
  const resolvedParentFolderById = new Map<string, string | undefined>();
  const resolving = new Set<string>();

  const resolveBlockPath = (blockId: string): string => {
    const cached = resolvedPathById.get(blockId);
    if (cached !== undefined) return cached;

    const block = blockById.get(blockId);
    if (!block) return '';

    const origPath = originalPathById.get(blockId) || block.title;
    const leaf = getLeafName(origPath, block.title);

    if (!inTreeBlockIds.has(blockId) || resolving.has(blockId)) {
      resolvedPathById.set(blockId, origPath);
      resolvedParentFolderById.set(blockId, undefined);
      return origPath;
    }

    resolving.add(blockId);

    const parentTether = chosenParentTetherByBlockId.get(blockId);
    const copyTether = !parentTether ? copiedFromSourceByTarget.get(blockId) : undefined;

    let finalPath = origPath;
    let finalParentFolder: string | undefined = undefined;

    if (parentTether) {
      const parentBlock = blockById.get(parentTether.sourceBlockId);
      if (parentBlock) {
        const parentResolved = resolveBlockPath(parentBlock.id);
        if (parentBlock.kind === 'upload') {
          const existingParentFolder = normalizePath(
            (block.data as FileBlockData | undefined)?.parentFolderPath || ''
          );
          if (existingParentFolder) {
            finalParentFolder = existingParentFolder;
            finalPath = `${existingParentFolder}/${leaf}`;
          } else {
            const origFolder = origPath.includes('/')
              ? origPath.split('/').slice(0, -1).join('/')
              : '';
            const archiveFolder = origFolder || getFolderContainerStem(parentBlock.title);
            finalParentFolder = archiveFolder;
            finalPath = `${archiveFolder}/${leaf}`;
          }
        } else {
          const normalizedTetherLabel = (parentTether.label || '').trim().toLowerCase();
          const isExplicitMediaPlacement = Boolean(
            block.projectCategory?.startsWith('media-') || normalizedTetherLabel === 'asset'
          );
          if (isExplicitMediaPlacement) {
            finalPath = origPath;
          } else {
            const parentContainer = getContainerFolderPath(parentResolved, parentBlock.title);
            const isExplicitFolderCategory = Boolean(
              block.projectCategory?.startsWith('folder-') && origPath.includes('/')
            );
            if (isExplicitFolderCategory) {
              const categoryFolder = origPath.split('/').slice(0, -1).join('/');
              finalPath = categoryFolder
                ? `${parentContainer}/${categoryFolder}/${leaf}`
                : `${parentContainer}/${leaf}`;
            } else {
              finalPath = `${parentContainer}/${leaf}`;
            }
          }
          finalParentFolder = undefined;
        }
      }
    } else if (copyTether) {
      const sourceBlock = blockById.get(copyTether.sourceBlockId);
      if (sourceBlock) {
        const sourceResolved = resolveBlockPath(sourceBlock.id);
        const sourceDir = sourceResolved.includes('/')
          ? sourceResolved.split('/').slice(0, -1).join('/')
          : '';
        finalPath = sourceDir ? `${sourceDir}/${leaf}` : leaf;
        const sourceFolderProp = (sourceBlock.data as FileBlockData | undefined)?.parentFolderPath;
        finalParentFolder = sourceFolderProp || (sourceDir || undefined);
      }
    } else {
      // Chain root block in the tree keeps its original path
      finalPath = origPath;
      finalParentFolder = undefined;
    }

    resolving.delete(blockId);
    resolvedPathById.set(blockId, finalPath);
    resolvedParentFolderById.set(blockId, finalParentFolder);
    return finalPath;
  };

  for (const b of projectBlocks) {
    resolveBlockPath(b.id);
  }

  // Apply updated paths, parent links, upload extractedBlockIds, and tree flags atomically
  const changedBlockIds: string[] = [];
  const updatedProjectBlocks: Block[] = [];

  const nextBlocks = blocks.map((b) => {
    if (b.projectId !== projectId) return b;

    const inTree = inTreeBlockIds.has(b.id);
    const parentTether = inTree ? chosenParentTetherByBlockId.get(b.id) : undefined;
    const nextParentId = parentTether ? parentTether.sourceBlockId : undefined;
    const nextOriginalSourcePath = originalPathById.get(b.id) || b.title;
    const nextSourcePath = resolvedPathById.get(b.id) || nextOriginalSourcePath;
    const nextParentFolder = inTree ? resolvedParentFolderById.get(b.id) : undefined;
    const nextCopiedFrom =
      b.copiedFromBlockId && blockById.has(b.copiedFromBlockId)
        ? b.copiedFromBlockId
        : undefined;

    let nextData: BlockData = b.data;
    let dataChanged = false;

    if (b.kind === 'upload') {
      const uData = b.data as UploadBlockData;
      const syncedExtracted = Array.from(uploadChildrenByUploadId.get(b.id) ?? []);
      const prevExtracted = uData.extractedBlockIds || [];
      if (
        prevExtracted.length !== syncedExtracted.length ||
        prevExtracted.some((id, idx) => id !== syncedExtracted[idx])
      ) {
        nextData = {
          ...uData,
          extractedBlockIds: syncedExtracted,
        };
        dataChanged = true;
      }
    } else if (b.kind === 'file') {
      const fData = b.data as FileBlockData;
      if (fData.path !== nextSourcePath || fData.parentFolderPath !== nextParentFolder) {
        nextData = {
          ...fData,
          path: nextSourcePath,
          parentFolderPath: nextParentFolder,
        };
        dataChanged = true;
      }
    } else if (b.kind === 'code') {
      const cData = b.data as CodeBlockData;
      if (cData.path !== nextSourcePath) {
        nextData = {
          ...cData,
          path: nextSourcePath,
        };
        dataChanged = true;
      }
    }

    const blockChanged =
      dataChanged ||
      b.sourcePath !== nextSourcePath ||
      b.originalSourcePath !== nextOriginalSourcePath ||
      b.tetherParentId !== nextParentId ||
      Boolean(b.isInFolderStructure) !== inTree ||
      b.copiedFromBlockId !== nextCopiedFrom;

    if (!blockChanged) {
      updatedProjectBlocks.push(b);
      return b;
    }

    const updatedBlock: Block = {
      ...b,
      sourcePath: nextSourcePath,
      originalSourcePath: nextOriginalSourcePath,
      tetherParentId: nextParentId,
      isInFolderStructure: inTree,
      copiedFromBlockId: nextCopiedFrom,
      data: nextData,
    };
    changedBlockIds.push(b.id);
    updatedProjectBlocks.push(updatedBlock);
    return updatedBlock;
  });

  // Build synced folder structure tree containing ONLY tethered blocks
  const blocksInTree = updatedProjectBlocks.filter((b) => Boolean(b.isInFolderStructure));
  const nextFolderStructure = buildFolderTreeNodes(blocksInTree, chosenParentTetherByBlockId);

  const changedProjectIds: string[] = [];
  const nextProjects = projects.map((p) => {
    if (p.id !== projectId) return p;
    if (areFolderTreesEqual(p.folderStructure, nextFolderStructure)) {
      return p;
    }
    changedProjectIds.push(p.id);
    return {
      ...p,
      folderStructure: nextFolderStructure,
    };
  });

  return {
    projects: nextProjects,
    blocks: nextBlocks,
    tethers: nextAllTethers,
    changedProjectIds,
    changedBlockIds,
    removedTetherIds,
  };
}

/**
 * Reconciles all projects in a workspace snapshot.
 */
export function reconcileAllProjectsFolderState(
  projects: Project[],
  blocks: Block[],
  tethers: Tether[]
): {
  projects: Project[];
  blocks: Block[];
  tethers: Tether[];
  changedProjectIds: string[];
  changedBlockIds: string[];
  removedTetherIds: string[];
} {
  let currProjects = projects;
  let currBlocks = blocks;
  let currTethers = tethers;
  const changedProjectSet = new Set<string>();
  const changedBlockSet = new Set<string>();
  const removedTetherSet = new Set<string>();

  for (const p of projects) {
    const res = reconcileProjectFolderState(currProjects, currBlocks, currTethers, p.id);
    currProjects = res.projects;
    currBlocks = res.blocks;
    currTethers = res.tethers;
    res.changedProjectIds.forEach((id) => changedProjectSet.add(id));
    res.changedBlockIds.forEach((id) => changedBlockSet.add(id));
    res.removedTetherIds.forEach((id) => removedTetherSet.add(id));
  }

  return {
    projects: currProjects,
    blocks: currBlocks,
    tethers: currTethers,
    changedProjectIds: Array.from(changedProjectSet),
    changedBlockIds: Array.from(changedBlockSet),
    removedTetherIds: Array.from(removedTetherSet),
  };
}
