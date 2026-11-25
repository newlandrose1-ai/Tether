import JSZip from 'jszip';
import {
  BINARY_EXTENSIONS,
  BUILD_OUTPUT_DIRS,
  DEFAULT_NESTED_ARCHIVE_POLICY,
  IGNORED_DEPENDENCY_AND_VCS_DIRS,
  INGEST_BATCH_SIZE,
  MAX_COMPRESSION_RATIO,
  MAX_FILE_COUNT,
  MAX_HUGE_FILE_BYTES,
  MAX_NESTING_DEPTH,
  MAX_TEXT_FILE_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ZIPPED_BYTES,
  NESTED_ARCHIVE_EXTENSIONS,
  type NestedArchivePolicy,
  UNIX_FILE_TYPE_MASK,
  UNIX_SYMLINK_MODE,
} from '../config/ingestConfig';
import type {
  AnalysisStatus,
  FileTreeNode,
  IngestFailure,
  IngestResult,
  ManifestEntry,
  SecretFinding,
  SkippedEntry,
  TextFileEntry,
} from '../types/pipeline';
import { scanTextForSecrets } from './secretScanner';
import {
  type ProgressCallback,
  throwIfAborted,
  yieldToEventLoop,
} from './workerProtocol';

export type ZipIngestOutcome =
  | { ok: true; result: IngestResult }
  | { ok: false; error: IngestFailure };

export interface ZipIngestOptions {
  nestedArchivePolicy?: NestedArchivePolicy;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export function validateZipEntryPath(rawPath: string): { valid: true; normalized: string; depth: number } | { valid: false; reason: string } {
  if (!rawPath || rawPath.trim().length === 0) {
    return { valid: false, reason: 'Entry path is empty.' };
  }
  if (rawPath.includes('\0')) {
    return { valid: false, reason: 'Entry path contains a null byte.' };
  }
  if (rawPath.startsWith('/')) {
    return { valid: false, reason: 'Entry path starts with a leading "/".' };
  }
  if (rawPath.includes('\\')) {
    return { valid: false, reason: 'Entry path contains a backslash "\\".' };
  }
  if (/^[a-zA-Z]:/.test(rawPath)) {
    return { valid: false, reason: 'Entry path contains a Windows drive letter.' };
  }
  if (rawPath.includes('..')) {
    return { valid: false, reason: 'Entry path contains parent traversal "..".' };
  }

  const trimmed = rawPath.replace(/\/+$/, '');
  if (!trimmed) {
    return { valid: false, reason: 'Entry path resolves to an empty root path.' };
  }
  if (trimmed.includes('//')) {
    return { valid: false, reason: 'Entry path contains empty "//" path segments.' };
  }

  const segments = trimmed.split('/');
  return {
    valid: true,
    normalized: trimmed,
    depth: segments.length,
  };
}

export function isSymlinkUnixPermissions(unixPermissions: number | string | null | undefined): boolean {
  let mode: number | null = null;
  if (typeof unixPermissions === 'number') {
    mode = unixPermissions;
  } else if (typeof unixPermissions === 'string' && unixPermissions.trim().length > 0) {
    const parsed = Number.parseInt(unixPermissions.trim(), 8);
    if (!Number.isNaN(parsed)) mode = parsed;
  }
  if (mode === null) return false;
  const low16 = mode & 0xffff;
  const high16 = (mode >>> 16) & 0xffff;
  return (
    (low16 & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_MODE ||
    (high16 & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_MODE
  );
}

function getLowerExtension(filePath: string): string {
  const baseName = filePath.split('/').pop()?.toLowerCase() ?? '';
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx <= 0) return '';
  return baseName.slice(dotIdx);
}

function hasArchiveMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength >= 4) {
    // ZIP PK\x03\x04 or PK\x05\x06
    if (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
    ) {
      return true;
    }
    // RAR: Rar!
    if (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) {
      return true;
    }
  }
  if (bytes.byteLength >= 6) {
    // 7z: 37 7A BC AF 27 1C
    if (
      bytes[0] === 0x37 &&
      bytes[1] === 0x7a &&
      bytes[2] === 0xbc &&
      bytes[3] === 0xaf &&
      bytes[4] === 0x27 &&
      bytes[5] === 0x1c
    ) {
      return true;
    }
  }
  if (bytes.byteLength >= 2) {
    // GZIP: 1F 8B
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      return true;
    }
  }
  return false;
}

function isLikelyBinaryBytes(bytes: Uint8Array): boolean {
  const sampleLen = Math.min(bytes.byteLength, 8192);
  if (sampleLen === 0) return false;
  let suspiciousControls = 0;
  for (let i = 0; i < sampleLen; i += 1) {
    const byte = bytes[i];
    if (byte === 0) {
      return true;
    }
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
      suspiciousControls += 1;
    }
  }
  return suspiciousControls / sampleLen > 0.12;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new Error('WEB_CRYPTO_UNAVAILABLE');
  }
  let digestInput: ArrayBuffer;
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    digestInput = bytes.buffer;
  } else {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    digestInput = copy.buffer;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function classifyPathDirectoryReason(path: string): { status: 'ignored-dir' | 'build-output'; reason: string } | null {
  const segments = path.split('/');
  const parentDirs = segments.slice(0, -1);
  for (const dir of parentDirs) {
    if (IGNORED_DEPENDENCY_AND_VCS_DIRS.has(dir)) {
      return {
        status: 'ignored-dir',
        reason: `Inside ignored directory "${dir}/" (retained in manifest and output zip).`,
      };
    }
  }
  for (const dir of parentDirs) {
    if (BUILD_OUTPUT_DIRS.has(dir)) {
      return {
        status: 'build-output',
        reason: `Inside build output directory "${dir}/" (retained in manifest and output zip).`,
      };
    }
  }
  return null;
}

function decodeTextOnceAndCap(
  bytes: Uint8Array,
  maxStoredBytes: number,
  sharedDecoder: TextDecoder
): { fullText: string; cappedText: string; truncated: boolean } {
  if (bytes.byteLength <= maxStoredBytes) {
    const text = sharedDecoder.decode(bytes);
    return { fullText: text, cappedText: text, truncated: false };
  }
  const fullText = sharedDecoder.decode(bytes);
  // Decode only up to maxStoredBytes cleanly once so UTF-8 boundaries stay valid
  const cappedText = sharedDecoder.decode(bytes.subarray(0, maxStoredBytes));
  return {
    fullText,
    cappedText,
    truncated: true,
  };
}

interface MutableTreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size: number;
  sha256?: string;
  analysisStatus?: AnalysisStatus;
  redactBeforeAi?: boolean;
  childrenMap?: Map<string, MutableTreeNode>;
}

function buildFileTree(
  manifest: ManifestEntry[],
  directoryPaths: string[],
  flaggedPathSet: Set<string>
): FileTreeNode[] {
  const rootMap = new Map<string, MutableTreeNode>();

  const ensureDir = (dirPath: string): MutableTreeNode => {
    const parts = dirPath.split('/');
    let currentMap = rootMap;
    let currentNode: MutableTreeNode | undefined;
    let runningPath = '';

    for (const part of parts) {
      runningPath = runningPath ? `${runningPath}/${part}` : part;
      let existing = currentMap.get(part);
      if (!existing) {
        existing = {
          name: part,
          path: runningPath,
          kind: 'directory',
          size: 0,
          childrenMap: new Map(),
        };
        currentMap.set(part, existing);
      } else if (!existing.childrenMap) {
        existing.childrenMap = new Map();
      }
      currentNode = existing;
      currentMap = existing.childrenMap!;
    }
    return currentNode!;
  };

  for (const dirPath of directoryPaths) {
    if (dirPath) ensureDir(dirPath);
  }

  for (const entry of manifest) {
    const parts = entry.path.split('/');
    const fileName = parts[parts.length - 1];
    let targetMap = rootMap;
    if (parts.length > 1) {
      const parentDir = ensureDir(parts.slice(0, -1).join('/'));
      targetMap = parentDir.childrenMap!;
    }

    targetMap.set(fileName, {
      name: fileName,
      path: entry.path,
      kind: 'file',
      size: entry.size,
      sha256: entry.sha256,
      analysisStatus: entry.analysisStatus,
      redactBeforeAi: flaggedPathSet.has(entry.path),
    });
  }

  const finalize = (map: Map<string, MutableTreeNode>): { nodes: FileTreeNode[]; totalBytes: number; hasRedacted: boolean } => {
    const sorted = Array.from(map.values()).sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    let totalBytes = 0;
    let hasRedacted = false;
    const nodes: FileTreeNode[] = [];

    for (const item of sorted) {
      if (item.kind === 'directory') {
        const childResult = finalize(item.childrenMap ?? new Map());
        totalBytes += childResult.totalBytes;
        if (childResult.hasRedacted) hasRedacted = true;
        nodes.push({
          name: item.name,
          path: item.path,
          kind: 'directory',
          size: childResult.totalBytes,
          redactBeforeAi: childResult.hasRedacted,
          children: childResult.nodes,
        });
      } else {
        totalBytes += item.size;
        if (item.redactBeforeAi) hasRedacted = true;
        nodes.push({
          name: item.name,
          path: item.path,
          kind: 'file',
          size: item.size,
          sha256: item.sha256,
          analysisStatus: item.analysisStatus,
          redactBeforeAi: Boolean(item.redactBeforeAi),
        });
      }
    }

    return { nodes, totalBytes, hasRedacted };
  };

  return finalize(rootMap).nodes;
}

export async function ingestZipBuffer(
  archiveName: string,
  rawBuffer: ArrayBuffer,
  options: ZipIngestOptions = {}
): Promise<ZipIngestOutcome> {
  const nestedArchivePolicy = options.nestedArchivePolicy ?? DEFAULT_NESTED_ARCHIVE_POLICY;

  if (!archiveName.toLowerCase().endsWith('.zip')) {
    return {
      ok: false,
      error: {
        code: 'INVALID_EXTENSION',
        title: 'Unsupported file type',
        detail: `Expected a .zip archive, received "${archiveName}".`,
      },
    };
  }

  if (rawBuffer.byteLength === 0) {
    return {
      ok: false,
      error: {
        code: 'EMPTY_FILE',
        title: 'Empty archive',
        detail: 'The uploaded .zip file is 0 bytes and cannot be ingested.',
      },
    };
  }

  if (rawBuffer.byteLength > MAX_ZIPPED_BYTES) {
    return {
      ok: false,
      error: {
        code: 'MAX_ZIPPED_SIZE_EXCEEDED',
        title: 'Zipped archive exceeds size limit',
        detail: `Archive is ${(rawBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB, exceeding the ${(MAX_ZIPPED_BYTES / (1024 * 1024)).toFixed(0)} MB zipped limit.`,
      },
    };
  }

  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    return {
      ok: false,
      error: {
        code: 'WEB_CRYPTO_UNAVAILABLE',
        title: 'Web Crypto API unavailable',
        detail: 'SHA-256 hashing requires crypto.subtle in a secure browser context.',
      },
    };
  }

  const zippedBytes = rawBuffer.byteLength;
  const onProgress = options.onProgress;
  const signal = options.signal;

  throwIfAborted(signal);
  onProgress?.({
    phase: 'opening',
    label: 'Opening .zip directory',
    completed: 0,
    total: 100,
    percent: 4,
  });

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(rawBuffer);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'MALFORMED_ZIP',
        title: 'Malformed or unreadable .zip archive',
        detail: err instanceof Error ? err.message : 'Unable to parse central directory of the .zip archive.',
      },
    };
  }

  throwIfAborted(signal);

  const allEntries = Object.values(zip.files);
  const directoryPaths: string[] = [];
  const fileEntries: Array<{ normalizedPath: string; depth: number; entry: JSZip.JSZipObject }> = [];
  let maxDepth = 0;

  // Phase 1: Validate every entry path, symlink bits, depth, and file count before decompressing.
  for (const entry of allEntries) {
    if (isSymlinkUnixPermissions(entry.unixPermissions)) {
      return {
        ok: false,
        error: {
          code: 'SYMLINK_REJECTED',
          title: 'Symbolic link entry rejected',
          detail: `Entry "${entry.name}" has Unix symlink mode bits (0xA000), which are forbidden.`,
          offendingPath: entry.name,
        },
      };
    }

    const pathCheck = validateZipEntryPath(entry.name);
    if (!pathCheck.valid) {
      return {
        ok: false,
        error: {
          code: 'UNSAFE_PATH',
          title: 'Unsafe archive entry path rejected',
          detail: `Entry "${entry.name}" failed path safety checks: ${pathCheck.reason}`,
          offendingPath: entry.name,
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

    if (pathCheck.depth > maxDepth) {
      maxDepth = pathCheck.depth;
    }

    if (entry.dir) {
      directoryPaths.push(pathCheck.normalized);
    } else {
      fileEntries.push({
        normalizedPath: pathCheck.normalized,
        depth: pathCheck.depth,
        entry,
      });
      if (fileEntries.length > MAX_FILE_COUNT) {
        return {
          ok: false,
          error: {
            code: 'MAX_FILE_COUNT_EXCEEDED',
            title: 'File count limit exceeded',
            detail: `Archive contains more than ${MAX_FILE_COUNT.toLocaleString()} files.`,
            offendingPath: pathCheck.normalized,
          },
        };
      }
    }
  }

  if (fileEntries.length === 0) {
    return {
      ok: false,
      error: {
        code: 'EMPTY_FILE',
        title: 'Empty archive',
        detail: 'The uploaded .zip archive contains no files and cannot be upgraded.',
      },
    };
  }

  fileEntries.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));

  // Phase 2: Decompress in batches with strict byte & ratio limits, SHA-256 hashing, and secret scan.
  let uncompressedBytes = 0;
  const rawEntriesByPath: Record<string, Uint8Array> = {};
  const manifest: ManifestEntry[] = [];
  const textFiles: Record<string, TextFileEntry> = {};
  const skipped: SkippedEntry[] = [];
  const secretFindings: SecretFinding[] = [];
  const flaggedPathSet = new Set<string>();
  const sharedDecoder = new TextDecoder('utf-8', { fatal: false });
  const totalFiles = fileEntries.length;

  const zeroCollectedOnAbort = () => {
    for (const buf of Object.values(rawEntriesByPath)) {
      try {
        buf.fill(0);
      } catch {
        // Ignore detached buffers
      }
    }
  };

  for (let i = 0; i < totalFiles; i += 1) {
    if (signal?.aborted) {
      zeroCollectedOnAbort();
      throwIfAborted(signal);
    }

    const item = fileEntries[i];
    let bytes: Uint8Array;
    try {
      bytes = await item.entry.async('uint8array');
    } catch (err) {
      zeroCollectedOnAbort();
      return {
        ok: false,
        error: {
          code: 'DECOMPRESS_FAILED',
          title: 'Entry decompression failed',
          detail: `Could not decompress "${item.normalizedPath}": ${err instanceof Error ? err.message : 'corrupt stream'}.`,
          offendingPath: item.normalizedPath,
        },
      };
    }

    uncompressedBytes += bytes.byteLength;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      zeroCollectedOnAbort();
      return {
        ok: false,
        error: {
          code: 'MAX_UNCOMPRESSED_SIZE_EXCEEDED',
          title: 'Uncompressed size limit exceeded',
          detail: `Total uncompressed content exceeded ${(MAX_UNCOMPRESSED_BYTES / (1024 * 1024)).toFixed(0)} MB while reading "${item.normalizedPath}".`,
          offendingPath: item.normalizedPath,
        },
      };
    }

    const internalData = (item.entry as unknown as {
      _data?: { compressedSize?: number; uncompressedSize?: number };
    })._data;
    const compressedSize =
      typeof internalData?.compressedSize === 'number' && internalData.compressedSize >= 0
        ? internalData.compressedSize
        : 0;

    if (bytes.byteLength > 0) {
      const entryRatio =
        compressedSize > 0 ? bytes.byteLength / compressedSize : Number.POSITIVE_INFINITY;
      if (compressedSize === 0 && bytes.byteLength >= MAX_COMPRESSION_RATIO) {
        zeroCollectedOnAbort();
        return {
          ok: false,
          error: {
            code: 'COMPRESSION_RATIO_EXCEEDED',
            title: 'Suspicious compression ratio detected',
            detail: `Entry "${item.normalizedPath}" expanded to ${bytes.byteLength.toLocaleString()} bytes from 0 compressed bytes (ratio limit < ${MAX_COMPRESSION_RATIO}:1).`,
            offendingPath: item.normalizedPath,
          },
        };
      }
      if (compressedSize > 0 && entryRatio >= MAX_COMPRESSION_RATIO) {
        zeroCollectedOnAbort();
        return {
          ok: false,
          error: {
            code: 'COMPRESSION_RATIO_EXCEEDED',
            title: 'Compression ratio limit exceeded',
            detail: `Entry "${item.normalizedPath}" has a ${entryRatio.toFixed(1)}:1 compression ratio, which reaches or exceeds the ${MAX_COMPRESSION_RATIO}:1 limit.`,
            offendingPath: item.normalizedPath,
          },
        };
      }
    }

    const totalRatio = uncompressedBytes / zippedBytes;
    if (totalRatio >= MAX_COMPRESSION_RATIO) {
      zeroCollectedOnAbort();
      return {
        ok: false,
        error: {
          code: 'COMPRESSION_RATIO_EXCEEDED',
          title: 'Archive compression ratio limit exceeded',
          detail: `Cumulative archive compression ratio reached ${totalRatio.toFixed(1)}:1, which reaches or exceeds the ${MAX_COMPRESSION_RATIO}:1 limit.`,
          offendingPath: item.normalizedPath,
        },
      };
    }

    const ext = getLowerExtension(item.normalizedPath);
    const isNestedArchive = NESTED_ARCHIVE_EXTENSIONS.has(ext) || hasArchiveMagicBytes(bytes);

    if (isNestedArchive && nestedArchivePolicy === 'reject') {
      zeroCollectedOnAbort();
      return {
        ok: false,
        error: {
          code: 'NESTED_ARCHIVE_REJECTED',
          title: 'Nested archive rejected',
          detail: `Entry "${item.normalizedPath}" is a nested archive and strict archive rejection is enabled.`,
          offendingPath: item.normalizedPath,
        },
      };
    }

    // `item.entry.async('uint8array')` already allocates a dedicated Uint8Array; no extra slice copy needed.
    const digestHex = await sha256Hex(bytes);
    rawEntriesByPath[item.normalizedPath] = bytes;

    const dirSkip = classifyPathDirectoryReason(item.normalizedPath);
    const isHugeFile = bytes.byteLength > MAX_HUGE_FILE_BYTES;
    const isBinary =
      !isNestedArchive && !isHugeFile && (BINARY_EXTENSIONS.has(ext) || isLikelyBinaryBytes(bytes));
    const isIgnoredForAnalysis = Boolean(isNestedArchive || dirSkip || isHugeFile || isBinary);

    let analysisStatus: AnalysisStatus = 'analyzable';
    if (isNestedArchive) {
      analysisStatus = 'nested-archive';
      skipped.push({
        path: item.normalizedPath,
        category: 'nested-archive',
        reason: 'Nested archive flagged as skipped for analysis (retained byte-identical in manifest and output zip).',
        size: bytes.byteLength,
        retainedInZipAndManifest: true,
      });
    } else if (dirSkip) {
      analysisStatus = dirSkip.status;
      skipped.push({
        path: item.normalizedPath,
        category: dirSkip.status,
        reason: dirSkip.reason,
        size: bytes.byteLength,
        retainedInZipAndManifest: true,
      });
    } else if (isHugeFile) {
      analysisStatus = 'huge-file';
      skipped.push({
        path: item.normalizedPath,
        category: 'huge-file',
        reason: `Huge file (${(bytes.byteLength / (1024 * 1024)).toFixed(2)} MB > ${(MAX_HUGE_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB limit) skipped from text reading and secret scanning; preserved byte-identical in output zip.`,
        size: bytes.byteLength,
        retainedInZipAndManifest: true,
      });
    } else if (isBinary) {
      analysisStatus = 'binary';
      skipped.push({
        path: item.normalizedPath,
        category: 'binary',
        reason: 'Binary file excluded from text analysis (retained byte-identical in manifest and output zip).',
        size: bytes.byteLength,
        retainedInZipAndManifest: true,
      });
    } else {
      const { fullText, cappedText, truncated } = decodeTextOnceAndCap(
        bytes,
        MAX_TEXT_FILE_BYTES,
        sharedDecoder
      );
      const fileFindings = scanTextForSecrets(item.normalizedPath, fullText);

      if (truncated) {
        analysisStatus = 'text-capped';
        skipped.push({
          path: item.normalizedPath,
          category: 'text-cap',
          reason: `Text file (${bytes.byteLength.toLocaleString()} bytes) exceeded the ${(MAX_TEXT_FILE_BYTES / 1024).toFixed(0)} KB analysis cap and was truncated in textFiles.`,
          size: bytes.byteLength,
          retainedInZipAndManifest: true,
        });
      }

      if (fileFindings.length > 0) {
        flaggedPathSet.add(item.normalizedPath);
        secretFindings.push(...fileFindings);
      }

      textFiles[item.normalizedPath] = {
        path: item.normalizedPath,
        content: cappedText,
        originalBytes: bytes.byteLength,
        truncated,
        lineCount: cappedText.length === 0 ? 0 : cappedText.split(/\r?\n/).length,
        redactBeforeAi: fileFindings.length > 0,
        secretFindingCount: fileFindings.length,
      };
    }

    manifest.push({
      path: item.normalizedPath,
      size: bytes.byteLength,
      compressedSize,
      sha256: digestHex,
      isBinary: isBinary || isHugeFile,
      isIgnoredForAnalysis,
      isNestedArchive,
      analysisStatus,
      unixPermissions: typeof item.entry.unixPermissions === 'number' ? item.entry.unixPermissions : null,
      lastModified: item.entry.date ? item.entry.date.toISOString() : null,
    });

    if ((i + 1) % INGEST_BATCH_SIZE === 0 || i === totalFiles - 1) {
      const completed = i + 1;
      const percent = Math.min(92, Math.max(8, Math.round(8 + (completed / totalFiles) * 84)));
      onProgress?.({
        phase: 'reading-and-scanning',
        label: `Hashing and scanning files (${completed}/${totalFiles})`,
        completed,
        total: totalFiles,
        percent,
        currentPath: item.normalizedPath,
      });
      await yieldToEventLoop();
    }
  }

  throwIfAborted(signal);
  onProgress?.({
    phase: 'building-tree',
    label: 'Building file tree & SHA-256 manifest',
    completed: totalFiles,
    total: totalFiles,
    percent: 96,
  });

  const flaggedPaths = Array.from(flaggedPathSet).sort();
  const fileTree = buildFileTree(manifest, directoryPaths, flaggedPathSet);
  const compressionRatio = Number((uncompressedBytes / zippedBytes).toFixed(2));

  onProgress?.({
    phase: 'complete',
    label: 'Archive ready',
    completed: totalFiles,
    total: totalFiles,
    percent: 100,
  });

  return {
    ok: true,
    result: {
      archiveName,
      zippedBytes,
      uncompressedBytes,
      fileCount: manifest.length,
      directoryCount: directoryPaths.length,
      compressionRatio,
      maxDepth,
      nestedArchivePolicy,
      originalBufferCopy: new ArrayBuffer(0),
      rawEntriesByPath,
      fileTree,
      manifest,
      textFiles,
      skipped,
      secretFindings,
      flaggedPaths,
      ingestedAt: new Date().toISOString(),
    },
  };
}

export async function ingestZipFile(
  file: File,
  options: ZipIngestOptions = {}
): Promise<ZipIngestOutcome> {
  if (!file) {
    return {
      ok: false,
      error: {
        code: 'EMPTY_FILE',
        title: 'No file selected',
        detail: 'Please select a .zip archive to begin.',
      },
    };
  }
  const buffer = await file.arrayBuffer();
  return ingestZipBuffer(file.name, buffer, options);
}
