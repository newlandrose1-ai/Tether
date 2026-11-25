import JSZip from 'jszip';
import { MAX_HUGE_FILE_BYTES, VERIFY_BATCH_SIZE } from '../config/ingestConfig';
import type { ApplyEngineResult } from './applyEngine';
import { scanTextForSecrets } from './secretScanner';
import {
  checkAllImportsResolve,
  checkPackageJsonDependencies,
  isIgnoredOrBuildPath,
  isJsOrTsPath,
  validateJsonContent,
  validateJsTsSyntax,
} from './staticChecks';
import {
  type ProgressCallback,
  throwIfAborted,
  yieldToEventLoop,
} from './workerProtocol';
import { sha256Hex } from './zipIngest';
import {
  escapeMarkdownCodeSpan,
  escapeMarkdownInline,
  sanitizeDiffHeaderPath,
  sanitizeUntrustedDiffBodyLine,
} from './securityGuards';
import type {
  DeterministicAnalysis,
  IngestResult,
  IntentLockStageState,
  SecretFinding,
  VerificationCheckDetail,
} from '../types/pipeline';

export const VERIFICATION_HONESTY_NOTICE = 'Builds and tests were not run.';

export interface VerifyAndArtifactsResult {
  verifiedAt: string;
  structuralPassed: boolean;
  staticPassed: boolean;
  secretScanPassed: boolean;
  buildsAndTestsRun: false;
  honestyNotice: string;
  note: string;
  checks: VerificationCheckDetail[];
  outputSha256ByPath: Record<string, string>;
  untouchedVerifiedCount: number;
  untouchedTotalCount: number;
  modifiedVerifiedCount: number;
  addedVerifiedCount: number;
  outputSecretFindings: SecretFinding[];
  newSecretFindings: SecretFinding[];
  outputZipBytes: Uint8Array;
  outputArchiveName: string;
  unifiedPatchDiff: string;
  beforeAfterReportMarkdown: string;
}

function getBaseNameLower(filePath: string): string {
  return (filePath.split('/').pop() ?? filePath).toLowerCase();
}

function computeLineDiff(beforeText: string | null, afterText: string, filePath: string): string {
  const safePath = sanitizeDiffHeaderPath(filePath);
  const beforeLines =
    beforeText === null
      ? []
      : beforeText.replace(/\r\n/g, '\n').split('\n').map(sanitizeUntrustedDiffBodyLine);
  const afterLines = afterText.replace(/\r\n/g, '\n').split('\n').map(sanitizeUntrustedDiffBodyLine);

  if (beforeText === null) {
    const header = [
      `--- /dev/null`,
      `+++ b/${safePath}`,
      `@@ -0,0 +1,${afterLines.length} @@`,
    ];
    return [...header, ...afterLines.map((l) => `+${l}`)].join('\n');
  }

  // Myers/LCS diff bounded for typical source/config files
  if (beforeLines.length * afterLines.length > 250_000) {
    return [
      `--- a/${safePath}`,
      `+++ b/${safePath}`,
      `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
      ...beforeLines.slice(0, 20).map((l) => `-${l}`),
      ...(beforeLines.length > 20 ? [`-... (${beforeLines.length - 20} more lines)`] : []),
      ...afterLines.slice(0, 20).map((l) => `+${l}`),
      ...(afterLines.length > 20 ? [`+... (${afterLines.length - 20} more lines)`] : []),
    ].join('\n');
  }

  const m = beforeLines.length;
  const n = afterLines.length;
  const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (beforeLines[i] === afterLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: Array<{ type: ' ' | '-' | '+'; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ type: ' ', text: beforeLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: '-', text: beforeLines[i] });
      i += 1;
    } else {
      ops.push({ type: '+', text: afterLines[j] });
      j += 1;
    }
  }
  while (i < m) {
    ops.push({ type: '-', text: beforeLines[i] });
    i += 1;
  }
  while (j < n) {
    ops.push({ type: '+', text: afterLines[j] });
    j += 1;
  }

  const hasChanges = ops.some((op) => op.type !== ' ');
  if (!hasChanges) {
    return `--- a/${safePath}\n+++ b/${safePath}\n`;
  }

  return [
    `--- a/${safePath}`,
    `+++ b/${safePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...ops.map((op) => `${op.type}${op.text}`),
  ].join('\n');
}

function buildUnifiedPatchDiff(
  ingest: IngestResult,
  applyResult: ApplyEngineResult
): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const changedPaths = Array.from(
    new Set([...applyResult.modifiedPaths, ...applyResult.addedPaths])
  ).sort();

  if (changedPaths.length === 0) {
    return '# No files were added or modified.\n';
  }

  const patches: string[] = [];
  for (const path of changedPaths) {
    const origBytes = ingest.rawEntriesByPath[path];
    const beforeText = origBytes ? decoder.decode(origBytes) : null;
    const afterBytes = applyResult.workingFiles[path];
    if (!afterBytes) continue;
    const afterText = decoder.decode(afterBytes);
    patches.push(computeLineDiff(beforeText, afterText, path));
  }

  return `${patches.join('\n\n')}\n`;
}

function buildBeforeAfterReportMarkdown(params: {
  ingest: IngestResult;
  analysis: DeterministicAnalysis;
  intent: IntentLockStageState;
  applyResult: ApplyEngineResult;
  structuralPassed: boolean;
  staticPassed: boolean;
  secretScanPassed: boolean;
  untouchedVerifiedCount: number;
  untouchedTotalCount: number;
  modifiedVerifiedCount: number;
  addedVerifiedCount: number;
  outputFileCount: number;
  outputUncompressedBytes: number;
  outputZippedBytes: number;
  checks: VerificationCheckDetail[];
  outputSecretFindings: SecretFinding[];
  newSecretFindings: SecretFinding[];
}): string {
  const {
    ingest,
    analysis,
    intent,
    applyResult,
    structuralPassed,
    staticPassed,
    secretScanPassed,
    untouchedVerifiedCount,
    untouchedTotalCount,
    modifiedVerifiedCount,
    addedVerifiedCount,
    outputFileCount,
    outputUncompressedBytes,
    outputZippedBytes,
    checks,
    outputSecretFindings,
    newSecretFindings,
  } = params;

  const applied = applyResult.outcomes.filter((o) => o.status === 'applied');
  const rolledBack = applyResult.outcomes.filter((o) => o.status === 'rolled-back');
  const addedLibs = applied.filter((o) => o.source === 'registry-library' && o.packageName);

  const lines: string[] = [
    `# Before / After Upgrade Report`,
    '',
    `- **Input archive**: \`${escapeMarkdownCodeSpan(ingest.archiveName)}\``,
    `- **Profile**: \`${escapeMarkdownCodeSpan(intent.projectKind ?? 'unknown')}\`${intent.modifiers.length > 0 ? ` (${intent.modifiers.map((m) => escapeMarkdownInline(m)).join(', ')})` : ''}`,
    `- **Primary language**: ${escapeMarkdownInline(analysis.primaryLanguage ?? 'Unknown')}`,
    `- **Verified at**: ${new Date().toISOString()}`,
    '',
    `## Verification Summary`,
    '',
    `- **Structural verification**: ${structuralPassed ? 'PASSED' : 'FAILED'}`,
    `- **Static verification**: ${staticPassed ? 'PASSED' : 'FAILED'}`,
    `- **Secret rescan**: ${secretScanPassed ? 'PASSED' : 'FAILED'} (${newSecretFindings.length} new, ${outputSecretFindings.length} total in output)`,
    `- **Execution scope**: ${VERIFICATION_HONESTY_NOTICE}`,
    '',
    `## Archive Comparison (Before vs After)`,
    '',
    `| Metric | Before | After |`,
    `| --- | ---: | ---: |`,
    `| Total files | ${ingest.fileCount} | ${outputFileCount} |`,
    `| Uncompressed size (bytes) | ${ingest.uncompressedBytes.toLocaleString()} | ${outputUncompressedBytes.toLocaleString()} |`,
    `| Zipped archive size (bytes) | ${ingest.zippedBytes.toLocaleString()} | ${outputZippedBytes.toLocaleString()} |`,
    `| Untouched files SHA-256 matched | ${untouchedTotalCount} | ${untouchedVerifiedCount} / ${untouchedTotalCount} |`,
    `| Modified files | 0 | ${modifiedVerifiedCount} |`,
    `| Added files (incl. CHANGELOG/NOTICE) | 0 | ${addedVerifiedCount} |`,
    '',
    `## Detailed Verification Checks`,
    '',
  ];

  for (const check of checks) {
    lines.push(
      `- [${check.passed ? 'PASS' : 'FAIL'}] **${escapeMarkdownInline(check.label)}** (${check.level}): ${escapeMarkdownInline(check.detail)}`
    );
  }

  if (analysis.detectedInstallScripts && analysis.detectedInstallScripts.length > 0) {
    lines.push('', `## Install Script Warnings (Existing Archive)`, '');
    for (const hit of analysis.detectedInstallScripts) {
      lines.push(
        `- \`${escapeMarkdownCodeSpan(hit.file)}\` defines \`${escapeMarkdownCodeSpan(hit.scriptName)}\`: \`${escapeMarkdownCodeSpan(hit.command)}\``
      );
    }
  }

  lines.push('', `## Proposals Applied (${applied.length})`, '');
  if (applied.length === 0) {
    lines.push('- None', '');
  } else {
    for (const item of applied) {
      lines.push(
        `- **[Tier ${item.riskTier}] ${escapeMarkdownInline(item.title)}** — ${item.touchedPaths.map((p) => `\`${escapeMarkdownCodeSpan(p)}\``).join(', ')}`
      );
    }
    lines.push('');
  }

  if (rolledBack.length > 0) {
    lines.push(`## Proposals Rolled Back (${rolledBack.length})`, '');
    for (const item of rolledBack) {
      lines.push(
        `- **[Tier ${item.riskTier}] ${escapeMarkdownInline(item.title)}** — ${escapeMarkdownInline(item.reason)}`
      );
    }
    lines.push('');
  }

  lines.push(`## Added Libraries & Licences (${addedLibs.length})`, '');
  if (addedLibs.length === 0) {
    lines.push('- No external registry dependencies were added.', '');
  } else {
    for (const lib of addedLibs) {
      lines.push(
        `- \`${escapeMarkdownCodeSpan(lib.packageName ?? '')}\` — ${escapeMarkdownInline(lib.licence)}`
      );
    }
    lines.push('');
  }

  lines.push(`---`, '', `> ${VERIFICATION_HONESTY_NOTICE}`, '');
  return lines.join('\n');
}

export interface VerifyOptions {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export async function runVerificationAndBuildArtifacts(
  ingest: IngestResult,
  analysis: DeterministicAnalysis,
  intent: IntentLockStageState,
  applyResult: ApplyEngineResult,
  options: VerifyOptions = {}
): Promise<VerifyAndArtifactsResult> {
  const { onProgress, signal } = options;
  throwIfAborted(signal);

  const verifiedAt = new Date().toISOString();
  const manifestByPath = new Map(ingest.manifest.map((m) => [m.path, m]));
  const modifiedSet = new Set(applyResult.modifiedPaths);
  const addedSet = new Set(applyResult.addedPaths);

  // 1. Package working copy into a fresh .zip preserving UNIX execute permissions
  const outZip = new JSZip();
  const sortedPaths = Object.keys(applyResult.workingFiles).sort((a, b) => a.localeCompare(b));

  onProgress?.({
    phase: 'packaging',
    label: `Packaging ${sortedPaths.length} output files into .zip`,
    completed: 0,
    total: Math.max(1, sortedPaths.length),
    percent: 8,
  });

  for (let i = 0; i < sortedPaths.length; i += 1) {
    throwIfAborted(signal);
    const path = sortedPaths[i];
    const bytes = applyResult.workingFiles[path];
    const orig = manifestByPath.get(path);
    const unixPermissions = applyResult.workingPermissions[path] ?? orig?.unixPermissions ?? 0o100644;
    const date = orig?.lastModified ? new Date(orig.lastModified) : new Date();
    outZip.file(path, bytes, {
      unixPermissions,
      date,
    });
  }

  const outputZipBytes = await outZip.generateAsync({
    type: 'uint8array',
    platform: 'UNIX',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  throwIfAborted(signal);
  onProgress?.({
    phase: 'reopening',
    label: 'Reopening output archive for SHA-256 verification',
    completed: 0,
    total: Math.max(1, sortedPaths.length),
    percent: 28,
  });

  const checks: VerificationCheckDetail[] = [];
  const outputSha256ByPath: Record<string, string> = {};
  const outputTextMap: Record<string, string> = {};
  const decoder = new TextDecoder('utf-8', { fatal: false });

  // 2. Structural Check #1: Output zip opens cleanly and contains expected entries
  let reopenedZip: JSZip | null = null;
  let zipOpenError: string | null = null;
  try {
    reopenedZip = await JSZip.loadAsync(outputZipBytes);
  } catch (err) {
    zipOpenError = err instanceof Error ? err.message : 'Unable to open packaged .zip archive.';
  }

  const reopenedFileEntries: Array<{ path: string; entry: JSZip.JSZipObject }> = [];
  if (reopenedZip) {
    for (const [name, entry] of Object.entries(reopenedZip.files)) {
      if (!entry.dir) {
        reopenedFileEntries.push({ path: name, entry });
      }
    }
  }

  const reopenedPathSet = new Set(reopenedFileEntries.map((e) => e.path));
  const missingExpected = sortedPaths.filter((p) => !reopenedPathSet.has(p));

  const zipOpenPassed = Boolean(reopenedZip) && missingExpected.length === 0;
  checks.push({
    id: 'structural-zip-open',
    level: 'structural',
    label: 'Output archive opens & entry inventory matches',
    passed: zipOpenPassed,
    detail: zipOpenPassed
      ? `Reopened ${reopenedFileEntries.length} file entries from ${(outputZipBytes.byteLength / 1024).toFixed(1)} KB .zip archive.`
      : zipOpenError ?? `Missing entries after packaging: ${missingExpected.slice(0, 5).join(', ')}`,
    affectedPaths: missingExpected,
  });

  // 3. Structural Check #2: Re-hash every entry in batches and verify byte-identity for untouched files
  let outputUncompressedBytes = 0;
  const shaMismatches: string[] = [];
  const execPermFailures: string[] = [];
  let untouchedVerifiedCount = 0;
  let untouchedTotalCount = 0;
  let modifiedVerifiedCount = 0;
  let addedVerifiedCount = 0;
  const totalReopened = reopenedFileEntries.length;

  for (let i = 0; i < totalReopened; i += 1) {
    throwIfAborted(signal);
    const item = reopenedFileEntries[i];
    const bytes = await item.entry.async('uint8array');
    outputUncompressedBytes += bytes.byteLength;
    const digest = await sha256Hex(bytes);
    outputSha256ByPath[item.path] = digest;

    const origManifest = manifestByPath.get(item.path);
    const isModified = modifiedSet.has(item.path);
    const isAdded = addedSet.has(item.path);

    if (origManifest && !isModified) {
      untouchedTotalCount += 1;
      if (digest === origManifest.sha256) {
        untouchedVerifiedCount += 1;
      } else {
        shaMismatches.push(item.path);
      }
    } else if (isModified) {
      const expectedWorkingDigest = await sha256Hex(applyResult.workingFiles[item.path]);
      if (digest === expectedWorkingDigest) {
        modifiedVerifiedCount += 1;
      } else {
        shaMismatches.push(item.path);
      }
    } else if (isAdded) {
      const expectedWorkingDigest = await sha256Hex(applyResult.workingFiles[item.path]);
      if (digest === expectedWorkingDigest) {
        addedVerifiedCount += 1;
      } else {
        shaMismatches.push(item.path);
      }
    }

    // Execute permission check for files expected to preserve execute bit
    const expectedPerm = applyResult.workingPermissions[item.path];
    const shouldHaveExec =
      (expectedPerm !== undefined && (expectedPerm & 0o111) !== 0) ||
      (origManifest?.unixPermissions !== null &&
        origManifest?.unixPermissions !== undefined &&
        (origManifest.unixPermissions & 0o111) !== 0);

    if (shouldHaveExec) {
      const actualPerm =
        typeof item.entry.unixPermissions === 'number' ? item.entry.unixPermissions : 0;
      if ((actualPerm & 0o111) === 0) {
        execPermFailures.push(item.path);
      }
    }

    // Collect analyzable text files for static & secret rescan (skip huge/binary/ignored entries)
    const isSkippedNonText =
      bytes.byteLength > MAX_HUGE_FILE_BYTES ||
      (origManifest && (origManifest.isBinary || origManifest.isNestedArchive)) ||
      isIgnoredOrBuildPath(item.path);
    if (!isSkippedNonText) {
      outputTextMap[item.path] = decoder.decode(bytes);
    }

    if ((i + 1) % VERIFY_BATCH_SIZE === 0 || i === totalReopened - 1) {
      const percent = 30 + Math.round(((i + 1) / Math.max(1, totalReopened)) * 35);
      onProgress?.({
        phase: 'hashing-output',
        label: `Verifying output SHA-256 fingerprints (${i + 1}/${totalReopened})`,
        completed: i + 1,
        total: totalReopened,
        percent,
        currentPath: item.path,
      });
      await yieldToEventLoop();
    }
  }

  // Also ensure no untouched manifest file was dropped
  for (const orig of ingest.manifest) {
    if (!modifiedSet.has(orig.path) && !reopenedPathSet.has(orig.path)) {
      untouchedTotalCount += 1;
      shaMismatches.push(orig.path);
    }
  }

  const shaPassed = shaMismatches.length === 0;
  checks.push({
    id: 'structural-sha256-manifest',
    level: 'structural',
    label: 'Untouched files match original SHA-256 manifest byte-for-byte',
    passed: shaPassed,
    detail: shaPassed
      ? `Verified ${untouchedVerifiedCount}/${untouchedTotalCount} untouched files are byte-identical to input SHA-256 manifest.`
      : `${shaMismatches.length} file(s) failed SHA-256 integrity check: ${shaMismatches.slice(0, 5).join(', ')}`,
    affectedPaths: shaMismatches,
  });

  const execPermPassed = execPermFailures.length === 0;
  checks.push({
    id: 'structural-exec-permissions',
    level: 'structural',
    label: 'Execute permissions (0o755) preserved in output archive',
    passed: execPermPassed,
    detail: execPermPassed
      ? 'All executable scripts and entries retained Unix execute permission bits.'
      : `Lost execute permissions on: ${execPermFailures.join(', ')}`,
    affectedPaths: execPermFailures,
  });

  const structuralPassed = zipOpenPassed && shaPassed && execPermPassed;

  // 4. Static Verification Checks (plain code, batched across reopened output archive)
  const invalidJsonErrors: Array<{ path: string; error: string }> = [];
  const invalidJsTsErrors: Array<{ path: string; error: string }> = [];
  let checkedJsonCount = 0;
  let checkedJsTsCount = 0;

  const outputTextEntries = Object.entries(outputTextMap);
  for (let i = 0; i < outputTextEntries.length; i += 1) {
    throwIfAborted(signal);
    const [path, content] = outputTextEntries[i];
    const baseLower = getBaseNameLower(path);
    if (baseLower.endsWith('.json') || baseLower.endsWith('.webmanifest')) {
      checkedJsonCount += 1;
      const res = validateJsonContent(path, content);
      if (!res.valid) {
        invalidJsonErrors.push({ path, error: res.error });
      }
    }
    if (isJsOrTsPath(path)) {
      checkedJsTsCount += 1;
      const res = validateJsTsSyntax(path, content);
      if (!res.valid) {
        invalidJsTsErrors.push({ path, error: res.error });
      }
    }
    if ((i + 1) % VERIFY_BATCH_SIZE === 0 || i === outputTextEntries.length - 1) {
      const percent = 65 + Math.round(((i + 1) / Math.max(1, outputTextEntries.length)) * 20);
      onProgress?.({
        phase: 'static-parse',
        label: `Parsing JSON & JS/TS syntax (${i + 1}/${outputTextEntries.length})`,
        completed: i + 1,
        total: outputTextEntries.length,
        percent,
        currentPath: path,
      });
      await yieldToEventLoop();
    }
  }

  const jsonPassed = invalidJsonErrors.length === 0;
  checks.push({
    id: 'static-json-parse',
    level: 'static',
    label: 'JSON & webmanifest files parse cleanly',
    passed: jsonPassed,
    detail: jsonPassed
      ? `Parsed ${checkedJsonCount} JSON/webmanifest file(s) with zero syntax errors.`
      : invalidJsonErrors.map((e) => `${e.path}: ${e.error}`).join('; '),
    affectedPaths: invalidJsonErrors.map((e) => e.path),
  });

  const jsTsPassed = invalidJsTsErrors.length === 0;
  checks.push({
    id: 'static-jsts-parse',
    level: 'static',
    label: 'JS/TS source files parse without syntax errors',
    passed: jsTsPassed,
    detail: jsTsPassed
      ? `Parsed ${checkedJsTsCount} JS/JSX/TS/TSX file(s) without syntax errors.`
      : invalidJsTsErrors.map((e) => `${e.path}: ${e.error}`).join('; '),
    affectedPaths: invalidJsTsErrors.map((e) => e.path),
  });

  const depResult = checkPackageJsonDependencies(outputTextMap);
  checks.push({
    id: 'static-dependencies',
    level: 'static',
    label: 'No duplicate or conflicting dependency entries',
    passed: depResult.passed,
    detail: depResult.passed
      ? `Checked ${depResult.declaredPackages.size} declared package(s); zero duplicates or conflicts found.`
      : depResult.issues.join('; '),
    affectedPaths: depResult.passed ? [] : ['package.json'],
  });

  const hasPackageJson = Object.keys(outputTextMap).some(
    (p) => !isIgnoredOrBuildPath(p) && getBaseNameLower(p) === 'package.json'
  );
  const importResult = checkAllImportsResolve(
    outputTextMap,
    reopenedPathSet,
    depResult.declaredPackages,
    hasPackageJson
  );
  checks.push({
    id: 'static-import-resolution',
    level: 'static',
    label: 'Imports resolve to archive files or declared dependencies',
    passed: importResult.passed,
    detail: importResult.passed
      ? 'All relative file imports and bare package imports resolve cleanly.'
      : importResult.unresolvedImports.map((u) => `${u.file}: ${u.reason}`).join('; '),
    affectedPaths: Array.from(new Set(importResult.unresolvedImports.map((u) => u.file))),
  });

  const staticPassed = jsonPassed && jsTsPassed && depResult.passed && importResult.passed;

  // 5. Output Secret Rescan (batched)
  const outputSecretFindings: SecretFinding[] = [];
  for (let i = 0; i < outputTextEntries.length; i += 1) {
    throwIfAborted(signal);
    const [path, content] = outputTextEntries[i];
    outputSecretFindings.push(...scanTextForSecrets(path, content));
    if ((i + 1) % VERIFY_BATCH_SIZE === 0 || i === outputTextEntries.length - 1) {
      const percent = 85 + Math.round(((i + 1) / Math.max(1, outputTextEntries.length)) * 12);
      onProgress?.({
        phase: 'secret-rescan',
        label: `Re-scanning output files for secrets (${i + 1}/${outputTextEntries.length})`,
        completed: i + 1,
        total: outputTextEntries.length,
        percent,
        currentPath: path,
      });
      await yieldToEventLoop();
    }
  }

  const origFindingSignatures = new Set(
    ingest.secretFindings.map((f) => `${f.path}::${f.ruleId}::${f.line}`)
  );
  const changedPathsSet = new Set([...applyResult.modifiedPaths, ...applyResult.addedPaths]);
  const newSecretFindings = outputSecretFindings.filter(
    (f) => changedPathsSet.has(f.path) || !origFindingSignatures.has(`${f.path}::${f.ruleId}::${f.line}`)
  );

  const secretScanPassed = newSecretFindings.length === 0;
  checks.push({
    id: 'secret-rescan-output',
    level: 'secret-scan',
    label: 'Secret scan rerun on output archive',
    passed: secretScanPassed,
    detail: secretScanPassed
      ? outputSecretFindings.length === 0
        ? `Scanned ${Object.keys(outputTextMap).length} output text files; zero secret patterns detected.`
        : `Zero new secrets introduced (${outputSecretFindings.length} pre-existing finding(s) preserved in untouched files).`
      : `Detected ${newSecretFindings.length} secret finding(s) in generated/modified files: ${newSecretFindings.map((f) => `${f.path}:${f.line}`).join(', ')}`,
    affectedPaths: Array.from(new Set(newSecretFindings.map((f) => f.path))),
  });

  // 6. Generate downloadable diff and before/after report
  throwIfAborted(signal);
  const stem = ingest.archiveName.replace(/\.zip$/i, '');
  const outputArchiveName = `${stem}-upgraded.zip`;
  const unifiedPatchDiff = buildUnifiedPatchDiff(ingest, applyResult);
  const beforeAfterReportMarkdown = buildBeforeAfterReportMarkdown({
    ingest,
    analysis,
    intent,
    applyResult,
    structuralPassed,
    staticPassed,
    secretScanPassed,
    untouchedVerifiedCount,
    untouchedTotalCount,
    modifiedVerifiedCount,
    addedVerifiedCount,
    outputFileCount: reopenedFileEntries.length,
    outputUncompressedBytes,
    outputZippedBytes: outputZipBytes.byteLength,
    checks,
    outputSecretFindings,
    newSecretFindings,
  });

  const passedLevels: string[] = [];
  if (structuralPassed) passedLevels.push('Structural');
  if (staticPassed) passedLevels.push('Static');
  if (secretScanPassed) passedLevels.push('Secret Rescan');

  const note = `${passedLevels.length > 0 ? `Passed: ${passedLevels.join(', ')}.` : 'No verification levels passed cleanly.'} ${VERIFICATION_HONESTY_NOTICE}`;

  onProgress?.({
    phase: 'complete',
    label: 'Verification complete',
    completed: outputTextEntries.length,
    total: outputTextEntries.length,
    percent: 100,
  });

  return {
    verifiedAt,
    structuralPassed,
    staticPassed,
    secretScanPassed,
    buildsAndTestsRun: false,
    honestyNotice: VERIFICATION_HONESTY_NOTICE,
    note,
    checks,
    outputSha256ByPath,
    untouchedVerifiedCount,
    untouchedTotalCount,
    modifiedVerifiedCount,
    addedVerifiedCount,
    outputSecretFindings,
    newSecretFindings,
    outputZipBytes,
    outputArchiveName,
    unifiedPatchDiff,
    beforeAfterReportMarkdown,
  };
}
