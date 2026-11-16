import JSZip from 'jszip';
import type {
  Block,
  CodeBlockData,
  FileBlockData,
  FolderStructureNode,
  Project,
  TextBlockData,
} from '../types/model';
import { utf8ByteLength } from './tetherFolderSync';

export interface ProjectZipFileEntry {
  blockId: string;
  path: string;
  name: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  byteSize: number;
  isTethered: boolean;
  kind: Block['kind'];
}

export interface ProjectZipManifest {
  projectName: string;
  archiveFileName: string;
  files: ProjectZipFileEntry[];
  folders: string[];
  tetheredFileCount: number;
  untetheredFileCount: number;
  skippedBlocks: Array<{ blockId: string; title: string; reason: string }>;
  totalBytes: number;
}

export interface ProjectZipExportOptions {
  /** Include non-tethered blocks in addition to the synced folderStructure (default: true) */
  includeUntethered?: boolean;
  /** Optional group filter */
  groupId?: string | null;
}

const STANDARD_EXTENSIONLESS_FILES = new Set([
  'license',
  'readme',
  'makefile',
  'dockerfile',
  'procfile',
  'notice',
  'authors',
  'changelog',
  'copying',
]);

function normalizeZipPath(rawPath: string): string {
  const parts = rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..');
  return parts.join('/');
}

function registerAncestorFolders(filePath: string, folderSet: Set<string>): void {
  const parts = filePath.split('/');
  let curr = '';
  for (let i = 0; i < parts.length - 1; i++) {
    curr = curr ? `${curr}/${parts[i]}` : parts[i];
    folderSet.add(curr);
  }
}

function ensureUniquePath(candidate: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(candidate)) {
    usedPaths.add(candidate);
    return candidate;
  }

  const slashIdx = candidate.lastIndexOf('/');
  const dir = slashIdx >= 0 ? candidate.slice(0, slashIdx + 1) : '';
  const base = slashIdx >= 0 ? candidate.slice(slashIdx + 1) : candidate;
  const dotIdx = base.lastIndexOf('.');
  const stem = dotIdx > 0 ? base.slice(0, dotIdx) : base;
  const ext = dotIdx > 0 ? base.slice(dotIdx) : '';

  let counter = 2;
  let next = `${dir}${stem}-${counter}${ext}`;
  while (usedPaths.has(next)) {
    counter++;
    next = `${dir}${stem}-${counter}${ext}`;
  }
  usedPaths.add(next);
  return next;
}

function resolveBlockDefaultPath(block: Block): string {
  const dataPath = (block.data as { path?: string } | undefined)?.path;
  const explicit = normalizeZipPath(block.sourcePath || dataPath || '');
  if (explicit) return explicit;

  const cleanTitle = normalizeZipPath(block.title) || 'untitled';
  if (block.kind === 'text') {
    const leaf = cleanTitle.split('/').pop() || cleanTitle;
    const lower = leaf.toLowerCase();
    const hasExtension = leaf.includes('.') && !leaf.startsWith('.');
    const isDotfile = leaf.startsWith('.');
    if (
      !hasExtension &&
      !isDotfile &&
      !STANDARD_EXTENSIONLESS_FILES.has(lower)
    ) {
      return `${cleanTitle}.md`;
    }
  }
  return cleanTitle;
}

function estimateBase64Bytes(base64: string): number {
  const clean = base64.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

function extractBlockPayload(block: Block):
  | { ok: true; content: string; encoding: 'utf-8' | 'base64'; byteSize: number }
  | { ok: false; reason: string } {
  if (block.kind === 'code') {
    const content = (block.data as CodeBlockData)?.currentContent ?? '';
    return {
      ok: true,
      content,
      encoding: 'utf-8',
      byteSize: utf8ByteLength(content),
    };
  }

  if (block.kind === 'text') {
    const content = (block.data as TextBlockData)?.content ?? '';
    return {
      ok: true,
      content,
      encoding: 'utf-8',
      byteSize: utf8ByteLength(content),
    };
  }

  if (block.kind === 'file') {
    const data = block.data as FileBlockData;
    if (data?.binary) {
      if (data.dataUrl && data.dataUrl.includes(',')) {
        const base64 = data.dataUrl.slice(data.dataUrl.indexOf(',') + 1);
        return {
          ok: true,
          content: base64,
          encoding: 'base64',
          byteSize: data.size || estimateBase64Bytes(base64),
        };
      }
      return {
        ok: false,
        reason: 'Binary asset has no in-memory payload to pack',
      };
    }
    const content = data?.content ?? '';
    return {
      ok: true,
      content,
      encoding: 'utf-8',
      byteSize: utf8ByteLength(content),
    };
  }

  return { ok: false, reason: 'Archive container block skipped' };
}

export function slugifyProjectName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tether-project'
  );
}

/**
 * Collects the deterministic, single-source-of-truth file & folder manifest for a project ZIP
 * from `project.folderStructure` (live tethered hierarchy) plus any non-tethered project blocks.
 */
export function collectProjectZipManifest(
  project: Project,
  blocks: Block[],
  options?: ProjectZipExportOptions
): ProjectZipManifest {
  const includeUntethered = options?.includeUntethered ?? true;
  const groupIdFilter = options?.groupId;

  const scopedBlocks = blocks.filter(
    (b) =>
      b.projectId === project.id &&
      (!groupIdFilter || b.groupId === groupIdFilter)
  );
  const blockById = new Map(scopedBlocks.map((b) => [b.id, b]));

  const usedPaths = new Set<string>();
  const folderSet = new Set<string>();
  const addedBlockIds = new Set<string>();
  const files: ProjectZipFileEntry[] = [];
  const skippedBlocks: Array<{ blockId: string; title: string; reason: string }> = [];

  let tetheredFileCount = 0;
  let untetheredFileCount = 0;

  // 1. Walk the live synced folderStructure first so tethered hierarchy & paths are authoritative
  const walkFolderStructure = (nodes: FolderStructureNode[] | undefined) => {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.isFolder) {
        const cleanFolder = normalizeZipPath(node.path);
        if (cleanFolder) {
          folderSet.add(cleanFolder);
        }
        walkFolderStructure(node.children);
        continue;
      }

      if (!node.blockId) continue;
      const block = blockById.get(node.blockId);
      if (!block) continue;

      if (block.kind === 'upload') {
        addedBlockIds.add(block.id);
        continue;
      }

      const payload = extractBlockPayload(block);
      if (!payload.ok) {
        addedBlockIds.add(block.id);
        skippedBlocks.push({
          blockId: block.id,
          title: block.title,
          reason: payload.reason,
        });
        continue;
      }

      const preferredPath =
        normalizeZipPath(node.path) || resolveBlockDefaultPath(block);
      const uniquePath = ensureUniquePath(preferredPath, usedPaths);
      registerAncestorFolders(uniquePath, folderSet);

      const name = uniquePath.split('/').pop() || block.title;
      files.push({
        blockId: block.id,
        path: uniquePath,
        name,
        content: payload.content,
        encoding: payload.encoding,
        byteSize: payload.byteSize,
        isTethered: true,
        kind: block.kind,
      });
      addedBlockIds.add(block.id);
      tetheredFileCount++;
    }
  };

  walkFolderStructure(project.folderStructure);

  // 2. Include any remaining tethered blocks (if folderStructure wasn't populated yet)
  //    followed by non-tethered blocks when includeUntethered is enabled.
  const remainingBlocks = scopedBlocks
    .filter((b) => b.kind !== 'upload' && !addedBlockIds.has(b.id))
    .sort((a, b) => resolveBlockDefaultPath(a).localeCompare(resolveBlockDefaultPath(b)));

  for (const block of remainingBlocks) {
    const isTethered = Boolean(block.isInFolderStructure);
    if (!isTethered && !includeUntethered) continue;

    const payload = extractBlockPayload(block);
    if (!payload.ok) {
      skippedBlocks.push({
        blockId: block.id,
        title: block.title,
        reason: payload.reason,
      });
      continue;
    }

    const preferredPath = resolveBlockDefaultPath(block);
    const uniquePath = ensureUniquePath(preferredPath, usedPaths);
    registerAncestorFolders(uniquePath, folderSet);

    const name = uniquePath.split('/').pop() || block.title;
    files.push({
      blockId: block.id,
      path: uniquePath,
      name,
      content: payload.content,
      encoding: payload.encoding,
      byteSize: payload.byteSize,
      isTethered,
      kind: block.kind,
    });
    addedBlockIds.add(block.id);
    if (isTethered) tetheredFileCount++;
    else untetheredFileCount++;
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const folders = Array.from(folderSet).sort((a, b) => a.localeCompare(b));
  const totalBytes = files.reduce((sum, f) => sum + f.byteSize, 0);
  const slug = slugifyProjectName(project.name);

  return {
    projectName: project.name,
    archiveFileName: `${slug}.zip`,
    files,
    folders,
    tetheredFileCount,
    untetheredFileCount,
    skippedBlocks,
    totalBytes,
  };
}

/**
 * Builds a real JSZip instance containing every folder and file from the project manifest.
 */
export function buildProjectZip(
  project: Project,
  blocks: Block[],
  options?: ProjectZipExportOptions
): { zip: JSZip; manifest: ProjectZipManifest } {
  const manifest = collectProjectZipManifest(project, blocks, options);
  const zip = new JSZip();

  for (const folderPath of manifest.folders) {
    zip.folder(folderPath);
  }

  for (const file of manifest.files) {
    if (file.encoding === 'base64') {
      zip.file(file.path, file.content, { base64: true });
    } else {
      zip.file(file.path, file.content);
    }
  }

  return { zip, manifest };
}

/**
 * Generates and immediately triggers browser download of the real `.zip` archive.
 */
export async function exportProjectToZip(
  project: Project,
  blocks: Block[],
  options?: ProjectZipExportOptions
): Promise<ProjectZipManifest> {
  const { zip, manifest } = buildProjectZip(project, blocks, options);
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = manifest.archiveFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return manifest;
}
