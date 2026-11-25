import { describe, expect, it } from 'bun:test';
import JSZip from 'jszip';
import {
  MAX_COMPRESSION_RATIO,
  MAX_FILE_COUNT,
  MAX_NESTING_DEPTH,
  MAX_TEXT_FILE_BYTES,
  MAX_ZIPPED_BYTES,
} from '../src/config/ingestConfig';
import { ingestFolderInputs } from '../src/lib/folderIngest';
import {
  ingestZipBuffer,
  isSymlinkUnixPermissions,
  sha256Hex,
  validateZipEntryPath,
} from '../src/lib/zipIngest';
import { usePipelineStore } from '../src/store/pipelineStore';

async function buildZipArrayBuffer(
  builder: (zip: JSZip) => void,
  compression: 'STORE' | 'DEFLATE' = 'DEFLATE',
  platform: 'DOS' | 'UNIX' = 'DOS'
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  builder(zip);
  return zip.generateAsync({
    type: 'arraybuffer',
    compression,
    platform,
    compressionOptions: compression === 'DEFLATE' ? { level: 9 } : undefined,
  });
}

describe('Zip Upgrader Upload & Ingest Safety Engine', () => {
  it('rejects malformed or non-zip inputs and fails closed', async () => {
    const badExt = await ingestZipBuffer('project.tar', new Uint8Array([1, 2, 3]).buffer);
    expect(badExt.ok).toBe(false);
    if (!badExt.ok) expect(badExt.error.code).toBe('INVALID_EXTENSION');

    const empty = await ingestZipBuffer('empty.zip', new ArrayBuffer(0));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('EMPTY_FILE');

    const corrupt = await ingestZipBuffer(
      'corrupt.zip',
      new TextEncoder().encode('not-a-valid-zip-archive').buffer
    );
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error.code).toBe('MALFORMED_ZIP');
  });

  it('rejects unsafe paths: "..", leading "/", drive letters, backslashes, and null bytes', async () => {
    const unsafePaths = [
      '../etc/passwd',
      'src/../../secret.txt',
      '/abs/path/index.ts',
      'C:\\Users\\admin\\file.ts',
      'D:relative.txt',
      'src\\windows\\file.ts',
      'src/bad\0file.ts',
    ];

    for (const p of unsafePaths) {
      const check = validateZipEntryPath(p);
      expect(check.valid).toBe(false);

      const buf = await buildZipArrayBuffer((zip) => {
        zip.file(p, 'hello');
      });
      const res = await ingestZipBuffer('unsafe.zip', buf);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('UNSAFE_PATH');
      }
    }
  });

  it('rejects symlink entries with unix mode bits 0xA000', async () => {
    expect(isSymlinkUnixPermissions(0o120777)).toBe(true);
    expect(isSymlinkUnixPermissions(0xa1ff0000)).toBe(true);
    expect(isSymlinkUnixPermissions(0o100644)).toBe(false);

    const buf = await buildZipArrayBuffer(
      (zip) => {
        zip.file('src/link.ts', '/etc/passwd', { unixPermissions: 0o120777 });
      },
      'DEFLATE',
      'UNIX'
    );

    const res = await ingestZipBuffer('symlink.zip', buf);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('SYMLINK_REJECTED');
      expect(res.error.offendingPath).toBe('src/link.ts');
    }
  });

  it('enforces zipped size, compression ratio (< 100:1), depth (20), and file count limits', async () => {
    // 1. Zipped size > 50 MB
    const oversized = new ArrayBuffer(MAX_ZIPPED_BYTES + 1);
    const sizeRes = await ingestZipBuffer('huge.zip', oversized);
    expect(sizeRes.ok).toBe(false);
    if (!sizeRes.ok) expect(sizeRes.error.code).toBe('MAX_ZIPPED_SIZE_EXCEEDED');

    // 2. Depth > 20
    const deepPath = `${Array.from({ length: MAX_NESTING_DEPTH + 1 }, (_, i) => `d${i}`).join('/')}/file.txt`;
    const deepBuf = await buildZipArrayBuffer((zip) => {
      zip.file(deepPath, 'deep');
    });
    const deepRes = await ingestZipBuffer('deep.zip', deepBuf);
    expect(deepRes.ok).toBe(false);
    if (!deepRes.ok) expect(deepRes.error.code).toBe('MAX_DEPTH_EXCEEDED');

    // 3. Compression ratio >= 100:1 (zip bomb guard)
    const zeroPayload = new Uint8Array(250 * 1024); // 250 KB of zeros compresses > 200:1
    const bombBuf = await buildZipArrayBuffer((zip) => {
      zip.file('bomb.txt', zeroPayload);
    }, 'DEFLATE');
    const bombRes = await ingestZipBuffer('bomb.zip', bombBuf);
    expect(bombRes.ok).toBe(false);
    if (!bombRes.ok) expect(bombRes.error.code).toBe('COMPRESSION_RATIO_EXCEEDED');
    expect(MAX_COMPRESSION_RATIO).toBe(100);

    // 4. File count > 5,000
    const manyBuf = await buildZipArrayBuffer((zip) => {
      for (let i = 0; i <= MAX_FILE_COUNT; i += 1) {
        zip.file(`f/file_${i}.txt`, 'x');
      }
    }, 'STORE');
    const countRes = await ingestZipBuffer('many.zip', manyBuf);
    expect(countRes.ok).toBe(false);
    if (!countRes.ok) expect(countRes.error.code).toBe('MAX_FILE_COUNT_EXCEEDED');
  });

  it('handles nested archives per policy (skip vs reject) while preserving SHA-256 manifest', async () => {
    const innerBuf = await buildZipArrayBuffer((zip) => {
      zip.file('inner.txt', 'hello');
    });

    const outerBuf = await buildZipArrayBuffer((zip) => {
      zip.file('README.md', '# Sample project\n');
      zip.file('fixtures/nested.zip', new Uint8Array(innerBuf));
    });

    const skippedRes = await ingestZipBuffer('outer.zip', outerBuf, {
      nestedArchivePolicy: 'skip',
    });
    expect(skippedRes.ok).toBe(true);
    if (skippedRes.ok) {
      expect(skippedRes.result.skipped.some((s) => s.path === 'fixtures/nested.zip' && s.category === 'nested-archive')).toBe(true);
      expect(skippedRes.result.manifest.some((m) => m.path === 'fixtures/nested.zip')).toBe(true);
      expect(skippedRes.result.rawEntriesByPath['fixtures/nested.zip']).toBeDefined();
    }

    const rejectedRes = await ingestZipBuffer('outer.zip', outerBuf, {
      nestedArchivePolicy: 'reject',
    });
    expect(rejectedRes.ok).toBe(false);
    if (!rejectedRes.ok) {
      expect(rejectedRes.error.code).toBe('NESTED_ARCHIVE_REJECTED');
    }
  });

  it('keeps node_modules, .git, build outputs, and binaries in SHA-256 manifest & raw copy while skipping analysis, and caps large text files', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    // Pseudo-random non-compressible ascii filler larger than MAX_TEXT_FILE_BYTES
    const bigLines: string[] = [];
    for (let i = 0; i < 24000; i += 1) {
      bigLines.push(`line_${i}_${((i * 2654435761) >>> 0).toString(36)}_payload`);
    }
    const bigText = bigLines.join('\n');
    expect(new TextEncoder().encode(bigText).byteLength).toBeGreaterThan(MAX_TEXT_FILE_BYTES);

    const zipBuf = await buildZipArrayBuffer((zip) => {
      zip.file('src/index.ts', 'export const hello = "world";\n');
      zip.file('node_modules/pkg/index.js', 'module.exports = 1;');
      zip.file('.git/HEAD', 'ref: refs/heads/main\n');
      zip.file('dist/bundle.js', 'console.log(1);');
      zip.file('assets/logo.png', pngBytes);
      zip.file('docs/large.txt', bigText);
    });

    const originalClone = zipBuf.slice(0);
    const res = await ingestZipBuffer('app.zip', zipBuf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Original buffer untouched
    expect(new Uint8Array(zipBuf)).toEqual(new Uint8Array(originalClone));

    const manifestPaths = res.result.manifest.map((m) => m.path);
    expect(manifestPaths).toContain('src/index.ts');
    expect(manifestPaths).toContain('node_modules/pkg/index.js');
    expect(manifestPaths).toContain('.git/HEAD');
    expect(manifestPaths).toContain('dist/bundle.js');
    expect(manifestPaths).toContain('assets/logo.png');
    expect(manifestPaths).toContain('docs/large.txt');

    // Byte-identical SHA-256 check on retained binary
    const expectedPngHash = await sha256Hex(pngBytes);
    const pngEntry = res.result.manifest.find((m) => m.path === 'assets/logo.png');
    expect(pngEntry?.sha256).toBe(expectedPngHash);
    expect(res.result.rawEntriesByPath['assets/logo.png']).toEqual(pngBytes);

    // Ignored / binary excluded from textFiles
    expect(res.result.textFiles['node_modules/pkg/index.js']).toBeUndefined();
    expect(res.result.textFiles['.git/HEAD']).toBeUndefined();
    expect(res.result.textFiles['dist/bundle.js']).toBeUndefined();
    expect(res.result.textFiles['assets/logo.png']).toBeUndefined();

    // Large text capped
    expect(res.result.textFiles['docs/large.txt']?.truncated).toBe(true);
    expect(
      new TextEncoder().encode(res.result.textFiles['docs/large.txt']?.content ?? '').byteLength
    ).toBeLessThanOrEqual(MAX_TEXT_FILE_BYTES);

    // Skipped list contains reasons
    expect(res.result.skipped.some((s) => s.path === 'node_modules/pkg/index.js' && s.category === 'ignored-dir')).toBe(true);
    expect(res.result.skipped.some((s) => s.path === 'dist/bundle.js' && s.category === 'build-output')).toBe(true);
    expect(res.result.skipped.some((s) => s.path === 'assets/logo.png' && s.category === 'binary')).toBe(true);
    expect(res.result.skipped.some((s) => s.path === 'docs/large.txt' && s.category === 'text-cap')).toBe(true);
  });

  it('ingests a project folder, passes through a folder containing a single .zip, and enforces folder safety limits', async () => {
    const encoder = new TextEncoder();
    const pkgBytes = encoder.encode(JSON.stringify({ name: 'folder-app', version: '1.0.0' }));
    const srcBytes = encoder.encode('export const ok = true;\n');

    const makeReadable = (name: string, bytes: Uint8Array) => ({
      name,
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
    });

    // 1. Standard project folder upload via store action
    await usePipelineStore.getState().ingestFolder([
      { relativePath: 'my-folder-app/package.json', file: makeReadable('package.json', pkgBytes) },
      { relativePath: 'my-folder-app/src/index.ts', file: makeReadable('index.ts', srcBytes) },
    ]);

    const storeState = usePipelineStore.getState();
    expect(storeState.ingestStatus).toBe('ready');
    expect(storeState.ingest?.archiveName).toBe('my-folder-app.zip');
    expect(storeState.ingest?.fileCount).toBe(2);
    expect(storeState.ingest?.textFiles['my-folder-app/src/index.ts']?.content).toBe(
      'export const ok = true;\n'
    );
    const expectedHash = await sha256Hex(srcBytes);
    expect(
      storeState.ingest?.manifest.find((m) => m.path === 'my-folder-app/src/index.ts')?.sha256
    ).toBe(expectedHash);

    // 2. Folder containing a single .zip file passes through directly without double-wrapping
    const innerZipBuf = await buildZipArrayBuffer((zip) => {
      zip.file('index.html', '<h1>Hi</h1>');
    });
    const innerZipBytes = new Uint8Array(innerZipBuf);
    const singleZipFolderRes = await ingestFolderInputs([
      { relativePath: 'zips/site.zip', file: makeReadable('site.zip', innerZipBytes) },
    ]);
    expect(singleZipFolderRes.ok).toBe(true);
    if (singleZipFolderRes.ok) {
      expect(singleZipFolderRes.result.archiveName).toBe('site.zip');
      expect(singleZipFolderRes.result.textFiles['index.html']?.content).toBe('<h1>Hi</h1>');
    }

    // 3. Empty folder and unsafe paths fail closed
    const emptyFolderRes = await ingestFolderInputs([]);
    expect(emptyFolderRes.ok).toBe(false);
    if (!emptyFolderRes.ok) expect(emptyFolderRes.error.code).toBe('EMPTY_FILE');

    const unsafeFolderRes = await ingestFolderInputs([
      { relativePath: '../secret.txt', file: makeReadable('secret.txt', srcBytes) },
    ]);
    expect(unsafeFolderRes.ok).toBe(false);
    if (!unsafeFolderRes.ok) expect(unsafeFolderRes.error.code).toBe('UNSAFE_PATH');

    const deepRel = `${Array.from({ length: MAX_NESTING_DEPTH + 1 }, (_, i) => `d${i}`).join('/')}/a.txt`;
    const deepFolderRes = await ingestFolderInputs([
      { relativePath: deepRel, file: makeReadable('a.txt', srcBytes) },
    ]);
    expect(deepFolderRes.ok).toBe(false);
    if (!deepFolderRes.ok) expect(deepFolderRes.error.code).toBe('MAX_DEPTH_EXCEEDED');
  });
});
