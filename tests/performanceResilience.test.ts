import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import { buildSafeDiagnosticsPayload } from '../src/components/StageErrorBoundary';
import { MAX_HUGE_FILE_BYTES } from '../src/config/ingestConfig';
import { applyApprovedProposalsSequentially } from '../src/lib/applyEngine';
import { generateFindingsAndProposals } from '../src/lib/findingsEngine';
import { redactTextForAi } from '../src/lib/secretScanner';
import { saveOptInSession } from '../src/lib/sessionPersistence';
import { OperationCancelledError } from '../src/lib/workerProtocol';
import { runVerificationAndBuildArtifacts } from '../src/lib/verifyEngine';
import { ingestZipBuffer } from '../src/lib/zipIngest';
import { usePipelineStore } from '../src/store/pipelineStore';

async function buildZipBuffer(entries: Record<string, string | Uint8Array>, emptyDirOnly = false): Promise<ArrayBuffer> {
  const zip = new JSZip();
  if (emptyDirOnly) {
    zip.folder('empty-only');
  } else {
    for (const [path, content] of Object.entries(entries)) {
      zip.file(path, content);
    }
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
}

describe('Performance and Resilience Pass', () => {
  test('rejects empty zip and directory-only zip cleanly with EMPTY_FILE', async () => {
    const zeroFileZip = await buildZipBuffer({});
    const resZero = await ingestZipBuffer('empty.zip', zeroFileZip);
    expect(resZero.ok).toBe(false);
    if (!resZero.ok) {
      expect(resZero.error.code).toBe('EMPTY_FILE');
    }

    const dirOnlyZip = await buildZipBuffer({}, true);
    const resDir = await ingestZipBuffer('dir-only.zip', dirOnlyZip);
    expect(resDir.ok).toBe(false);
    if (!resDir.ok) {
      expect(resDir.error.code).toBe('EMPTY_FILE');
    }
  });

  test('handles single root folder zip and zip with no manifest end-to-end', async () => {
    // 1. Single root folder
    usePipelineStore.getState().resetPipeline();
    const singleRootZip = await buildZipBuffer({
      'my-game-root/package.json': JSON.stringify(
        {
          name: 'root-wrapped-game',
          version: '1.0.0',
          scripts: { build: 'vite build' },
          dependencies: { phaser: '^3.80.0' },
        },
        null,
        2
      ),
      'my-game-root/index.html': '<!doctype html><html><body><canvas id="game"></canvas><script src="./src/main.js"></script></body></html>',
      'my-game-root/src/main.js': 'const speed = 10;\nexport function tick() { return speed; }\n',
    });

    await usePipelineStore.getState().ingestArrayBuffer('my-game-root.zip', singleRootZip);
    expect(usePipelineStore.getState().ingestStatus).toBe('ready');
    usePipelineStore.getState().advanceFromUpload();
    usePipelineStore.getState().advanceFromAnalyse();
    if (usePipelineStore.getState().intent.status !== 'locked') {
      usePipelineStore.getState().lockIntent('browser-game-2d', [], 'user-override');
    }
    usePipelineStore.getState().advanceFromIntent();
    usePipelineStore.getState().advanceFromFindings();
    usePipelineStore.getState().executeApplyStage();
    await usePipelineStore.getState().executeVerifyStage();

    const rootState = usePipelineStore.getState();
    expect(rootState.verify.structuralPassed).toBe(true);
    expect(rootState.verify.staticPassed).toBe(true);
    expect(rootState.verify.secretScanPassed).toBe(true);
    expect(rootState.verify.untouchedVerifiedCount).toBeGreaterThan(0);

    // 2. Zip with NO manifest (plain HTML + JS + CSS)
    usePipelineStore.getState().resetPipeline();
    const noManifestZip = await buildZipBuffer({
      'index.html': '<!doctype html><html><head><title>Site</title></head><body><h1>Hi</h1><script src="./app.js"></script></body></html>',
      'styles.css': 'body { font-family: sans-serif; }',
      'app.js': 'export const greeting = "hello";\nconsole.log(greeting);\n',
    });

    await usePipelineStore.getState().ingestArrayBuffer('static-no-manifest.zip', noManifestZip);
    expect(usePipelineStore.getState().ingestStatus).toBe('ready');
    usePipelineStore.getState().advanceFromUpload();
    expect(usePipelineStore.getState().analysis.result?.manifestFiles).toEqual([]);
    if (usePipelineStore.getState().intent.status !== 'locked') {
      usePipelineStore.getState().lockIntent('web-page', [], 'user-override');
    }
    usePipelineStore.getState().advanceFromIntent();
    usePipelineStore.getState().advanceFromFindings();
    usePipelineStore.getState().executeApplyStage();
    await usePipelineStore.getState().executeVerifyStage();

    const noManState = usePipelineStore.getState();
    expect(noManState.verify.structuralPassed).toBe(true);
    expect(noManState.verify.staticPassed).toBe(true);
    expect(noManState.verify.secretScanPassed).toBe(true);
  });

  test('preserves non-UTF-8 bytes, Windows CRLF line endings, and handles very long lines quickly', async () => {
    const latin1Bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xe9, 0xf1, 0xfc, 0xff, 0x0a]);
    const crlfPkg = '{\r\n  "name": "crlf-app",\r\n  "version": "1.0.0",\r\n  "scripts": {\r\n    "dev": "vite"\r\n  }\r\n}\r\n';
    const crlfUntouched = 'export const a = 1;\r\nexport const b = 2;\r\n';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_$';
    let variedPayload = '';
    for (let i = 0; i < 60_000; i += 1) {
      variedPayload += chars[(i * 17 + (i >> 3) * 13 + (i % 7)) % chars.length];
    }
    const longMinifiedLine = `const data = "${variedPayload}"; const token = "sk-live-secret9999999999"; export default data;\n`;

    const edgeZip = await buildZipBuffer({
      'package.json': crlfPkg,
      'index.html': '<!doctype html><html><body><script src="./app.js"></script></body></html>',
      'app.js': crlfUntouched,
      'notes-latin1.txt': latin1Bytes,
      'vendor-long.js': longMinifiedLine,
    });

    const start = performance.now();
    const ingestOutcome = await ingestZipBuffer('edge-cases.zip', edgeZip);
    const elapsedMs = performance.now() - start;

    expect(ingestOutcome.ok).toBe(true);
    if (!ingestOutcome.ok) return;
    expect(elapsedMs).toBeLessThan(2000);

    // Bounded redaction on huge single line must execute quickly and return bounded output
    const redacted = redactTextForAi(longMinifiedLine, [
      {
        id: 'sec-1',
        path: 'vendor-long.js',
        line: 1,
        column: 1,
        ruleId: 'test',
        label: 'Secret',
        severity: 'high',
        kind: 'pattern',
        previewMasked: 'sk-l***',
      },
    ]);
    expect(redacted.length).toBeLessThan(17_000);
    expect(redacted).toContain('[long line truncated]');

    // Untouched CRLF and Non-UTF-8 files remain byte-identical through full Apply + Verify
    usePipelineStore.getState().resetPipeline();
    await usePipelineStore.getState().ingestArrayBuffer('edge-cases.zip', edgeZip);
    usePipelineStore.getState().advanceFromUpload();
    usePipelineStore.getState().lockIntent('web-page', [], 'user-override');
    usePipelineStore.getState().advanceFromIntent();
    usePipelineStore.getState().advanceFromFindings();
    usePipelineStore.getState().executeApplyStage();
    await usePipelineStore.getState().executeVerifyStage();

    const st = usePipelineStore.getState();
    expect(st.verify.structuralPassed).toBe(true);
    const rawLatin1 = st.apply.workingFiles['notes-latin1.txt'];
    expect(Array.from(rawLatin1)).toEqual(Array.from(latin1Bytes));
    const rawCrlf = new TextDecoder().decode(st.apply.workingFiles['app.js']);
    expect(rawCrlf).toBe(crlfUntouched);

    // Verify package.json kept CRLF if modified
    const pkgBytes = st.apply.workingFiles['package.json'];
    const pkgText = new TextDecoder().decode(pkgBytes);
    expect(pkgText).toContain('\r\n');
  });

  test('skips huge files (>5 MB) with reason, avoids duplicate copies, and streams determinate progress across 400+ tiny files', async () => {
    const entries: Record<string, string | Uint8Array> = {
      'package.json': JSON.stringify({ name: 'many-files-app', version: '1.0.0' }, null, 2),
      'index.html': '<!doctype html><html><body>Hello</body></html>',
    };
    for (let i = 0; i < 420; i += 1) {
      entries[`src/mod_${String(i).padStart(3, '0')}.js`] = `export const v${i} = ${i};\n`;
    }
    // Add one huge > 5 MB file filled with ASCII spaces/comments so deflate compresses cleanly under 50 MB limit
    // Wait: keep ratio < 100:1 by mixing semi-random non-repeating chunks or storing uncompressed?
    // Build incompressible-ish bytes (~5.2 MB, stored or lightly compressed so zipped size is ~5.2 MB -> ratio ~1:1!)
    const hugeSize = MAX_HUGE_FILE_BYTES + 200_000;
    const hugeBytes = new Uint8Array(hugeSize);
    for (let i = 0; i < hugeSize; i += 1) {
      hugeBytes[i] = 65 + ((i * 31 + (i >> 7)) % 26);
    }

    const zip = new JSZip();
    for (const [k, v] of Object.entries(entries)) {
      zip.file(k, v);
    }
    zip.file('assets/huge-data.txt', hugeBytes, { compression: 'STORE' });
    const manyBuffer = await zip.generateAsync({ type: 'arraybuffer' });

    const progressUpdates: number[] = [];
    const ingestRes = await ingestZipBuffer('many-and-huge.zip', manyBuffer, {
      onProgress: (p) => progressUpdates.push(p.percent),
    });

    expect(ingestRes.ok).toBe(true);
    if (!ingestRes.ok) return;

    // 1. Original raw buffer duplicate is NOT retained in memory
    expect(ingestRes.result.originalBufferCopy.byteLength).toBe(0);

    // 2. Huge file is skipped with category 'huge-file' and reason, not decoded into textFiles, yet preserved in rawEntriesByPath
    const hugeSkip = ingestRes.result.skipped.find((s) => s.path === 'assets/huge-data.txt');
    expect(hugeSkip?.category).toBe('huge-file');
    expect(hugeSkip?.reason).toContain('MB limit');
    expect(ingestRes.result.textFiles['assets/huge-data.txt']).toBeUndefined();
    expect(ingestRes.result.rawEntriesByPath['assets/huge-data.txt']?.byteLength).toBe(hugeSize);

    // 3. Progress streamed determinately and monotonically up to 100
    expect(progressUpdates.length).toBeGreaterThan(5);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
    for (let i = 1; i < progressUpdates.length; i += 1) {
      expect(progressUpdates[i]).toBeGreaterThanOrEqual(progressUpdates[i - 1]);
    }

    // 4. Untouched files reuse references without cloning during Apply, and Verify passes byte-identity
    usePipelineStore.getState().resetPipeline();
    await usePipelineStore.getState().ingestArrayBuffer('many-and-huge.zip', manyBuffer);
    usePipelineStore.getState().advanceFromUpload();
    usePipelineStore.getState().lockIntent('web-page', [], 'user-override');
    usePipelineStore.getState().advanceFromIntent();
    usePipelineStore.getState().advanceFromFindings();

    const stPreApply = usePipelineStore.getState();
    const applyOut = applyApprovedProposalsSequentially(
      stPreApply.ingest!,
      stPreApply.analysis.result!,
      'web-page',
      [],
      stPreApply.findings.proposals
    );
    expect(applyOut.workingFiles['assets/huge-data.txt']).toBe(
      stPreApply.ingest!.rawEntriesByPath['assets/huge-data.txt']
    );

    const verifyProgress: number[] = [];
    const verifyOut = await runVerificationAndBuildArtifacts(
      stPreApply.ingest!,
      stPreApply.analysis.result!,
      stPreApply.intent,
      applyOut,
      { onProgress: (p) => verifyProgress.push(p.percent) }
    );
    expect(verifyOut.structuralPassed).toBe(true);
    expect(verifyOut.untouchedVerifiedCount).toBeGreaterThan(420);
    expect(verifyProgress[verifyProgress.length - 1]).toBe(100);
  });

  test('supports cooperative cancellation, double-click safety, safe diagnostics, and opt-in-only persistence', async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 120; i += 1) {
      entries[`src/f${i}.js`] = `export const x${i} = ${i};\n`;
    }
    const zipBuf = await buildZipBuffer(entries);

    // Abort mid-ingest after first progress tick
    const controller = new AbortController();
    let abortedError: unknown = null;
    try {
      await ingestZipBuffer('abort-me.zip', zipBuf, {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.completed >= 25) {
            controller.abort();
          }
        },
      });
    } catch (err) {
      abortedError = err;
    }
    expect(abortedError).toBeInstanceOf(OperationCancelledError);

    // Store cancelActiveOperation cleanly resets state
    usePipelineStore.getState().resetPipeline();
    const pIngest = usePipelineStore.getState().ingestArrayBuffer('abort-store.zip', zipBuf);
    usePipelineStore.getState().cancelActiveOperation();
    await pIngest;
    expect(usePipelineStore.getState().ingestStatus).toBe('idle');
    expect(usePipelineStore.getState().ingestProgress).toBeNull();

    // Double-click safety on stage advances and locked goToStage bounds
    await usePipelineStore.getState().ingestArrayBuffer('valid.zip', await buildZipBuffer({
      'index.html': '<!doctype html><html><body>Hi</body></html>',
      'app.js': 'console.log("ok");\n',
    }));
    usePipelineStore.getState().advanceFromUpload();
    usePipelineStore.getState().advanceFromUpload();
    expect(usePipelineStore.getState().currentStage).toBe('analyse');

    usePipelineStore.getState().goToStage('download'); // Locked -> must ignore
    expect(usePipelineStore.getState().currentStage).toBe('analyse');

    // Safe diagnostics scrub secrets & file content
    const diagText = buildSafeDiagnosticsPayload(
      new Error('Failed near sk-secretToken1234567890 at C:\\Users\\alice\\repo\\app.js'),
      {
        stage: 'verify',
        fileCount: 12,
        primaryLanguage: 'JavaScript',
        profileId: 'web-page',
        ingestStatus: 'ready',
      }
    );
    expect(diagText).not.toContain('sk-secretToken1234567890');
    expect(diagText).not.toContain('C:\\Users\\alice');
    expect(diagText).toContain('[REDACTED]');

    // Opt-in persistence disabled by default
    expect(usePipelineStore.getState().keepSessionOptIn).toBe(false);
    await expect(saveOptInSession(usePipelineStore.getState())).resolves.toBeUndefined();
    usePipelineStore.getState().setKeepSessionOptIn(true);
    expect(usePipelineStore.getState().keepSessionOptIn).toBe(true);
    usePipelineStore.getState().resetPipeline();
    expect(usePipelineStore.getState().keepSessionOptIn).toBe(false);
  });
});
