import JSZip from 'jszip';
import {
  INGEST_BATCH_SIZE,
  MAX_FILE_COUNT,
  MAX_NESTING_DEPTH,
  MAX_UNCOMPRESSED_BYTES,
} from '../config/ingestConfig';
import { stripUnsafeControlAndBidiChars } from './securityGuards';
import { throwIfAborted, yieldToEventLoop } from './workerProtocol';
import {
  ingestZipBuffer,
  validateZipEntryPath,
  type ZipIngestOptions,
  type ZipIngestOutcome,
} from './zipIngest';

export interface ReadableUploadFile {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface FolderFileInput {
  relativePath: string;
  file: ReadableUploadFile;
}

interface WebkitFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}

interface WebkitFileSystemFileEntry extends WebkitFileSystemEntry {
  file: (success: (file: File) => void, error?: (err: unknown) => void) => void;
}

interface WebkitFileSystemDirectoryReader {
  readEntries: (
    success: (entries: WebkitFileSystemEntry[]) => void,
    error?: (err: unknown) => void
  ) => void;
}

interface WebkitFileSystemDirectoryEntry extends WebkitFileSystemEntry {
  createReader: () => WebkitFileSystemDirectoryReader;
}

function deriveArchiveNameFromPaths(paths: string[]): string {
  const firstSegs = new Set(
    paths.map((p) => p.split('/')[0]).filter((seg) => Boolean(seg && seg.length > 0))
  );
  if (firstSegs.size === 1) {
    const rawRoot = Array.from(firstSegs)[0] ?? 'uploaded-folder';
    const cleanRoot = stripUnsafeControlAndBidiChars(rawRoot, false)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .trim();
    const base = cleanRoot && cleanRoot !== '.' && cleanRoot !== '..' ? cleanRoot : 'uploaded-folder';
    return base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`;
  }
  return 'uploaded-folder.zip';
}

export function fileListToFolderInputs(files: FileList | File[]): FolderFileInput[] {
  const arr = Array.from(files);
  return arr.map((file) => {
    const rel =
      'webkitRelativePath' in file &&
      typeof file.webkitRelativePath === 'string' &&
      file.webkitRelativePath.trim().length > 0
        ? file.webkitRelativePath
        : file.name;
    return {
      relativePath: rel,
      file,
    };
  });
}

async function readAllDirectoryEntries(
  reader: WebkitFileSystemDirectoryReader
): Promise<WebkitFileSystemEntry[]> {
  const all: WebkitFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<WebkitFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    all.push(...batch);
    if (all.length > MAX_FILE_COUNT + 100) {
      break;
    }
  }
  return all;
}

async function readEntryToFile(entry: WebkitFileSystemFileEntry): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function walkFileSystemEntry(
  entry: WebkitFileSystemEntry,
  depth: number,
  collected: FolderFileInput[]
): Promise<void> {
  if (collected.length > MAX_FILE_COUNT) {
    return;
  }

  const normalizedRel = entry.fullPath.replace(/^\/+/, '');
  if (entry.isFile) {
    const file = await readEntryToFile(entry as WebkitFileSystemFileEntry);
    collected.push({
      relativePath: normalizedRel || file.name,
      file,
    });
    return;
  }

  if (entry.isDirectory) {
    if (depth > MAX_NESTING_DEPTH + 1) {
      // Record sentinel deep path so ingest fails closed with MAX_DEPTH_EXCEEDED cleanly
      collected.push({
        relativePath: `${normalizedRel}/__depth_limit__`,
        file: new File([], '__depth_limit__'),
      });
      return;
    }
    const dirEntry = entry as WebkitFileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const children = await readAllDirectoryEntries(reader);
    for (const child of children) {
      await walkFileSystemEntry(child, depth + 1, collected);
      if (collected.length > MAX_FILE_COUNT) {
        break;
      }
    }
  }
}

export type DropExtractResult =
  | { kind: 'single-zip'; file: File }
  | { kind: 'folder-inputs'; inputs: FolderFileInput[] }
  | { kind: 'empty' };

export async function extractDropUpload(dataTransfer: DataTransfer): Promise<DropExtractResult> {
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const entries = items
    .map((item) => {
      const getter = (item as DataTransferItem & {
        webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
      }).webkitGetAsEntry;
      return typeof getter === 'function' ? getter.call(item) : null;
    })
    .filter((entry): entry is WebkitFileSystemEntry => entry !== null);

  if (entries.length > 0) {
    const hasDirectory = entries.some((e) => e.isDirectory);
    if (!hasDirectory && entries.length === 1 && entries[0].isFile) {
      const file = dataTransfer.files?.[0] ?? (await readEntryToFile(entries[0] as WebkitFileSystemFileEntry));
      return { kind: 'single-zip', file };
    }

    const collected: FolderFileInput[] = [];
    for (const entry of entries) {
      await walkFileSystemEntry(entry, 1, collected);
    }
    if (collected.length === 0) {
      return { kind: 'empty' };
    }
    return { kind: 'folder-inputs', inputs: collected };
  }

  const files = dataTransfer.files ? Array.from(dataTransfer.files) : [];
  if (files.length === 0) {
    return { kind: 'empty' };
  }
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
    return { kind: 'single-zip', file: files[0] };
  }
  return {
    kind: 'folder-inputs',
    inputs: fileListToFolderInputs(files),
  };
}

/**
 * Packages an uploaded/dropped project folder cleanly in-browser into a `.zip`
 * after enforcing path, depth, count, and uncompressed-size limits, then runs the
 * standard fail-closed `ingestZipBuffer` pipeline.
 */
export async function ingestFolderInputs(
  folderInputs: FolderFileInput[],
  options: ZipIngestOptions = {}
): Promise<ZipIngestOutcome> {
  const { onProgress, signal } = options;
  throwIfAborted(signal);

  if (!folderInputs || folderInputs.length === 0) {
    return {
      ok: false,
      error: {
        code: 'EMPTY_FILE',
        title: 'Empty folder',
        detail: 'The selected folder contains no files and cannot be ingested.',
      },
    };
  }

  if (folderInputs.length > MAX_FILE_COUNT) {
    return {
      ok: false,
      error: {
        code: 'MAX_FILE_COUNT_EXCEEDED',
        title: 'File count limit exceeded',
        detail: `Folder contains more than ${MAX_FILE_COUNT.toLocaleString()} files.`,
      },
    };
  }

  const validated: Array<{ path: string; file: ReadableUploadFile }> = [];
  let totalSize = 0;

  for (const item of folderInputs) {
    const cleanInput = item.relativePath.replace(/^\.\//, '');
    const pathCheck = validateZipEntryPath(cleanInput);
    if (!pathCheck.valid) {
      return {
        ok: false,
        error: {
          code: 'UNSAFE_PATH',
          title: 'Unsafe file path rejected',
          detail: `Entry "${item.relativePath}" failed path safety checks: ${pathCheck.reason}`,
          offendingPath: item.relativePath,
        },
      };
    }

    if (pathCheck.depth > MAX_NESTING_DEPTH) {
      return {
        ok: false,
        error: {
          code: 'MAX_DEPTH_EXCEEDED',
          title: 'Maximum folder nesting depth exceeded',
          detail: `Entry "${pathCheck.normalized}" has nesting depth ${pathCheck.depth}, exceeding limit ${MAX_NESTING_DEPTH}.`,
          offendingPath: pathCheck.normalized,
        },
      };
    }

    totalSize += item.file.size;
    if (totalSize > MAX_UNCOMPRESSED_BYTES) {
      return {
        ok: false,
        error: {
          code: 'MAX_UNCOMPRESSED_SIZE_EXCEEDED',
          title: 'Folder size limit exceeded',
          detail: `Total folder size exceeded ${(MAX_UNCOMPRESSED_BYTES / (1024 * 1024)).toFixed(0)} MB while reading "${pathCheck.normalized}".`,
          offendingPath: pathCheck.normalized,
        },
      };
    }

    validated.push({ path: pathCheck.normalized, file: item.file });
  }

  // If the uploaded folder contains only a single .zip archive, ingest that .zip directly.
  if (validated.length === 1 && validated[0].path.toLowerCase().endsWith('.zip')) {
    const single = validated[0];
    const baseName = single.path.split('/').pop() ?? single.file.name;
    const buffer = await single.file.arrayBuffer();
    return ingestZipBuffer(baseName, buffer, options);
  }

  const zip = new JSZip();
  for (let i = 0; i < validated.length; i += 1) {
    throwIfAborted(signal);
    const entry = validated[i];
    const bytes = new Uint8Array(await entry.file.arrayBuffer());
    zip.file(entry.path, bytes);
    if ((i + 1) % INGEST_BATCH_SIZE === 0 || i === validated.length - 1) {
      onProgress?.({
        phase: 'packing-folder',
        label: `Packing folder files (${i + 1}/${validated.length})`,
        completed: i + 1,
        total: validated.length,
        percent: Math.round(((i + 1) / validated.length) * 25),
        currentPath: entry.path,
      });
      await yieldToEventLoop();
    }
  }

  throwIfAborted(signal);
  const archiveName = deriveArchiveNameFromPaths(validated.map((v) => v.path));
  const zippedBuffer = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return ingestZipBuffer(archiveName, zippedBuffer, {
    ...options,
    onProgress: onProgress
      ? (p) =>
          onProgress({
            ...p,
            percent: Math.min(100, 25 + Math.round(p.percent * 0.75)),
          })
      : undefined,
  });
}
