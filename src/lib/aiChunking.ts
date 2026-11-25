import type { DeterministicAnalysis, IngestResult, TextFileEntry } from '../types/pipeline';
import { redactTextForAi } from './secretScanner';
import {
  escapeFileTagBreakout,
  stripUnsafeControlAndBidiChars,
} from './securityGuards';

export type FileImportanceTier = 'manifest' | 'entry' | 'config' | 'readme' | 'source';

export interface RankedFileItem {
  path: string;
  importance: FileImportanceTier;
  priority: number;
  sha256: string;
  entry: TextFileEntry;
}

export interface ChunkedFileBlock {
  path: string;
  importance: FileImportanceTier;
  chunkIndex: number;
  totalChunks: number;
  sha256: string;
  block: string;
}

export interface ChunkedInputResult {
  fileBlocks: ChunkedFileBlock[];
  includedPaths: string[];
  strippedSecretFilesCount: number;
  chunkedFileCount: number;
  skippedLowPriorityCount: number;
  contentHashKey: string;
}

const MANIFEST_BASENAMES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'cargo.toml',
  'manifest.json',
  'manifest.webmanifest',
  'project.godot',
  'composer.json',
  'pom.xml',
]);

const DEFAULT_CHUNK_CHARS = 650;
const MAX_CHUNKS_PER_FILE = 3;
const DEFAULT_MAX_BLOCK_BUDGET_CHARS = 5_200;

function getBaseNameLower(filePath: string): string {
  const parts = filePath.split('/');
  return (parts[parts.length - 1] ?? filePath).toLowerCase();
}

function fnv1aHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function computeContentHashKey(
  parts: Array<string>
): string {
  return fnv1aHex(parts.join('|'));
}

/**
 * Ranks non-redacted analyzable text files by importance:
 * 1. Manifests (package.json, pyproject.toml, etc.)
 * 2. Entry points (index.html, server.ts, src/main.*, etc.)
 * 3. Config files (tsconfig, vite.config, Dockerfile, etc.)
 * 4. README files
 * 5. Other source files
 *
 * Lockfiles and secret-flagged files (`redactBeforeAi`) are always excluded.
 */
export function rankFilesByImportance(
  ingest: IngestResult,
  analysis: DeterministicAnalysis
): { ranked: RankedFileItem[]; strippedSecretFilesCount: number } {
  const shaByPath = new Map<string, string>(
    ingest.manifest.map((m) => [m.path, m.sha256])
  );
  const entrySet = new Set(analysis.entryPoints);
  const configSet = new Set(analysis.configFiles);
  const readmeSet = new Set(analysis.hygiene.readmePaths);
  const manifestSet = new Set(analysis.manifestFiles);

  let strippedSecretFilesCount = 0;
  const ranked: RankedFileItem[] = [];

  for (const entry of Object.values(ingest.textFiles)) {
    const base = getBaseNameLower(entry.path);
    if (
      /\.lock$/i.test(base) ||
      base === 'package-lock.json' ||
      base === 'pnpm-lock.yaml' ||
      base === 'yarn.lock' ||
      base === 'bun.lockb'
    ) {
      continue;
    }

    if (entry.redactBeforeAi) {
      strippedSecretFilesCount += 1;
      continue;
    }

    let importance: FileImportanceTier = 'source';
    let priority = 20;

    if (manifestSet.has(entry.path) || MANIFEST_BASENAMES.has(base)) {
      importance = 'manifest';
      priority = 100;
    } else if (entrySet.has(entry.path)) {
      importance = 'entry';
      priority = 80;
    } else if (configSet.has(entry.path)) {
      importance = 'config';
      priority = 60;
    } else if (readmeSet.has(entry.path)) {
      importance = 'readme';
      priority = 40;
    }

    const sha256 = shaByPath.get(entry.path) ?? fnv1aHex(`${entry.path}:${entry.content}`);
    ranked.push({
      path: entry.path,
      importance,
      priority,
      sha256,
      entry,
    });
  }

  ranked.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.path.length - b.path.length ||
      a.path.localeCompare(b.path)
  );

  return { ranked, strippedSecretFilesCount };
}

/**
 * Chunks ranked files by importance inside a fixed character budget so we never send the entire zip.
 * Produces a deterministic `contentHashKey` built from included SHA-256 file hashes + discriminator.
 */
export function chunkRankedFilesForBudget(
  ingest: IngestResult,
  analysis: DeterministicAnalysis,
  options: {
    promptVersion: string;
    extraKeyParts?: string[];
    maxBlockBudgetChars?: number;
    chunkSizeChars?: number;
    maxChunksPerFile?: number;
    maxFiles?: number;
  }
): ChunkedInputResult {
  const maxBudget = options.maxBlockBudgetChars ?? DEFAULT_MAX_BLOCK_BUDGET_CHARS;
  const chunkSize = options.chunkSizeChars ?? DEFAULT_CHUNK_CHARS;
  const maxChunksPerFile = options.maxChunksPerFile ?? MAX_CHUNKS_PER_FILE;
  const maxFiles = options.maxFiles ?? 8;

  const { ranked, strippedSecretFilesCount } = rankFilesByImportance(ingest, analysis);
  const fileBlocks: ChunkedFileBlock[] = [];
  const includedPathsSet = new Set<string>();
  const hashInputs: string[] = [
    options.promptVersion,
    ...(options.extraKeyParts ?? []),
  ];

  let usedChars = 0;
  let chunkedFileCount = 0;
  let skippedLowPriorityCount = 0;

  for (const item of ranked) {
    if (includedPathsSet.size >= maxFiles || usedChars >= maxBudget) {
      skippedLowPriorityCount += 1;
      continue;
    }

    const safePath = stripUnsafeControlAndBidiChars(item.path, false).replace(/["'<>]/g, '_');
    const scanPath = /\.(?:md|txt)$/i.test(safePath) ? `${safePath}.ts` : safePath;
    const { redactedContent } = redactTextForAi(scanPath, item.entry.content);
    const cleanedBody = escapeFileTagBreakout(redactedContent);

    if (!cleanedBody.trim()) continue;

    const totalPossibleChunks = Math.max(1, Math.ceil(cleanedBody.length / chunkSize));
    const chunksToEmit = Math.min(totalPossibleChunks, maxChunksPerFile);
    if (totalPossibleChunks > 1) {
      chunkedFileCount += 1;
    }

    let fileEmitted = false;
    for (let idx = 0; idx < chunksToEmit; idx += 1) {
      const start = idx * chunkSize;
      const slice = cleanedBody.slice(start, start + chunkSize);
      const chunkMeta =
        totalPossibleChunks > 1 ? ` chunk="${idx + 1}/${totalPossibleChunks}"` : '';
      const truncatedSuffix =
        idx === chunksToEmit - 1 && totalPossibleChunks > chunksToEmit
          ? '\n...[remaining chunks omitted to respect payload budget]'
          : '';
      const block = `<file path="${safePath}" importance="${item.importance}"${chunkMeta}>\n${slice}${truncatedSuffix}\n</file>`;

      if (usedChars + block.length > maxBudget && fileBlocks.length > 0) {
        if (!fileEmitted) {
          skippedLowPriorityCount += 1;
        }
        break;
      }

      fileBlocks.push({
        path: item.path,
        importance: item.importance,
        chunkIndex: idx + 1,
        totalChunks: totalPossibleChunks,
        sha256: item.sha256,
        block,
      });
      usedChars += block.length;
      fileEmitted = true;
    }

    if (fileEmitted) {
      includedPathsSet.add(item.path);
      hashInputs.push(`${item.path}:${item.sha256}`);
    }
  }

  // Include overall manifest sha256 fingerprint count so any file addition/modification busts cache cleanly
  hashInputs.push(`manifest:${ingest.manifest.map((m) => `${m.path}=${m.sha256}`).join(',')}`);

  return {
    fileBlocks,
    includedPaths: Array.from(includedPathsSet),
    strippedSecretFilesCount,
    chunkedFileCount,
    skippedLowPriorityCount,
    contentHashKey: computeContentHashKey(hashInputs),
  };
}
