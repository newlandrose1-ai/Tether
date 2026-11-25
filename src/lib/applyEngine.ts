import licencePolicyData from '../data/licence-policy.json';
import registryData from '../data/registry.json';
import { scanTextForSecrets } from './secretScanner';
import {
  DANGEROUS_INSTALL_SCRIPT_KEYS,
  enforceRegistryAndInstallScriptPolicyForProposal,
  escapeMarkdownCodeSpan,
  escapeMarkdownInline,
  validateWriteTargetPath,
} from './securityGuards';
import {
  checkAllImportsResolve,
  checkPackageJsonDependencies,
  isIgnoredOrBuildPath,
  isJsOrTsPath,
  validateJsonContent,
  validateJsTsSyntax,
} from './staticChecks';
import type {
  AppliedProposalOutcome,
  DeterministicAnalysis,
  IngestResult,
  LicencePolicyRule,
  ProfileId,
  ProposalItem,
  RegistryEntry,
} from '../types/pipeline';

function detectRootPrefix(ingest: IngestResult): string {
  if (ingest.manifest.length === 0) return '';
  const firstSegs = new Set(ingest.manifest.map((m) => m.path.split('/')[0]));
  const allNestedUnderSingleDir =
    firstSegs.size === 1 && ingest.manifest.every((m) => m.path.includes('/'));
  if (!allNestedUnderSingleDir) return '';
  const root = ingest.manifest[0]?.path.split('/')[0] ?? '';
  return root ? `${root}/` : '';
}

function getBaseNameLower(filePath: string): string {
  return (filePath.split('/').pop() ?? filePath).toLowerCase();
}

function isScriptRequiringExecBit(filePath: string, textContent?: string): boolean {
  const normalized = filePath.toLowerCase();
  if (/^(?:.+\/)?(?:bin|\.husky)\//.test(normalized)) return true;
  if (normalized.endsWith('.sh') || normalized.endsWith('.bash')) return true;
  if (textContent && textContent.startsWith('#!')) return true;
  return false;
}

export function resolveOutputPermissions(
  filePath: string,
  originalPerms: number | null,
  textContent?: string
): number {
  if (originalPerms !== null) {
    if (isScriptRequiringExecBit(filePath, textContent) && (originalPerms & 0o111) === 0) {
      return (originalPerms | 0o100755) & 0o177777;
    }
    return originalPerms;
  }
  if (isScriptRequiringExecBit(filePath, textContent)) {
    return 0o100755;
  }
  return 0o100644;
}

/**
 * Formats ONLY newly generated files (never reformats existing user files).
 */
export function formatGeneratedFileContent(filePath: string, content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const trimmedLines = normalized
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
  if (getBaseNameLower(filePath).endsWith('.json') || getBaseNameLower(filePath).endsWith('.webmanifest')) {
    try {
      const parsed = JSON.parse(trimmedLines);
      return `${JSON.stringify(parsed, null, 2)}\n`;
    } catch {
      return `${trimmedLines}\n`;
    }
  }
  return `${trimmedLines}\n`;
}

function detectIndentAndEol(raw: string): { indent: string; eol: string; trailingNewline: boolean } {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const indentMatch = /\r?\n([ \t]+)"/.exec(raw);
  const indent = indentMatch ? indentMatch[1] : '  ';
  const trailingNewline = raw.endsWith('\n');
  return { indent, eol, trailingNewline };
}

/**
 * Finds the start (`{`) and matching end (`}`) indices of a top-level JSON object property
 * such as `"dependencies"` or `"devDependencies"` or `"scripts"`.
 */
function findTopLevelObjectBlockRange(
  rawJson: string,
  propertyName: string
): { openBraceIdx: number; closeBraceIdx: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let currentString = '';
  let stringStart = -1;

  for (let i = 0; i < rawJson.length; i += 1) {
    const ch = rawJson[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        currentString += ch;
      } else if (ch === '\\') {
        escaped = true;
        currentString += ch;
      } else if (ch === '"') {
        inString = false;
        if (depth === 1 && currentString === propertyName) {
          let look = i + 1;
          while (look < rawJson.length && /\s/.test(rawJson[look])) look += 1;
          if (rawJson[look] === ':') {
            look += 1;
            while (look < rawJson.length && /\s/.test(rawJson[look])) look += 1;
            if (rawJson[look] === '{') {
              const openIdx = look;
              let innerDepth = 0;
              let innerStr = false;
              let innerEsc = false;
              for (let j = openIdx; j < rawJson.length; j += 1) {
                const ic = rawJson[j];
                if (innerStr) {
                  if (innerEsc) innerEsc = false;
                  else if (ic === '\\') innerEsc = true;
                  else if (ic === '"') innerStr = false;
                } else {
                  if (ic === '"') innerStr = true;
                  else if (ic === '{') innerDepth += 1;
                  else if (ic === '}') {
                    innerDepth -= 1;
                    if (innerDepth === 0) {
                      return { openBraceIdx: openIdx, closeBraceIdx: j };
                    }
                  }
                }
              }
            }
          }
        }
        void stringStart;
      } else {
        currentString += ch;
      }
    } else {
      if (ch === '"') {
        inString = true;
        currentString = '';
        stringStart = i;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      }
    }
  }
  return null;
}

function spliceKeysIntoExistingJsonObjectBlock(
  rawJson: string,
  sectionName: string,
  newEntries: Array<[string, string]>,
  indent: string,
  eol: string
): string | null {
  if (newEntries.length === 0) return rawJson;
  const range = findTopLevelObjectBlockRange(rawJson, sectionName);
  if (!range) return null;

  const inner = rawJson.slice(range.openBraceIdx + 1, range.closeBraceIdx);
  const hasExistingKeys = /"/.test(inner);
  const entryLines = newEntries.map(
    ([k, v]) => `${indent}${indent}${JSON.stringify(k)}: ${JSON.stringify(v)}`
  );

  if (!hasExistingKeys) {
    const replacement = `${eol}${entryLines.join(`,${eol}`)}${eol}${indent}`;
    return (
      rawJson.slice(0, range.openBraceIdx + 1) +
      replacement +
      rawJson.slice(range.closeBraceIdx)
    );
  }

  // Insert right after the last non-whitespace token inside the existing `{ ... }` block
  let lastNonSpaceIdx = range.closeBraceIdx - 1;
  while (lastNonSpaceIdx > range.openBraceIdx && /\s/.test(rawJson[lastNonSpaceIdx])) {
    lastNonSpaceIdx -= 1;
  }
  const hasTrailingComma = rawJson[lastNonSpaceIdx] === ',';
  const prefix = rawJson.slice(0, lastNonSpaceIdx + 1);
  const suffix = rawJson.slice(range.closeBraceIdx);
  const inserted = `${hasTrailingComma ? '' : ','}${eol}${entryLines.join(`,${eol}`)}${eol}${indent}`;

  return `${prefix}${inserted}${suffix}`;
}

function appendNewSectionToRootObject(
  rawJson: string,
  sectionName: string,
  entries: Array<[string, string]>,
  indent: string,
  eol: string
): string | null {
  if (entries.length === 0) return rawJson;
  const lastBraceIdx = rawJson.lastIndexOf('}');
  if (lastBraceIdx === -1) return null;

  let lastNonSpaceIdx = lastBraceIdx - 1;
  while (lastNonSpaceIdx >= 0 && /\s/.test(rawJson[lastNonSpaceIdx])) {
    lastNonSpaceIdx -= 1;
  }

  const hasExistingProps = rawJson[lastNonSpaceIdx] !== '{';
  const hasTrailingComma = rawJson[lastNonSpaceIdx] === ',';
  const entryLines = entries.map(
    ([k, v]) => `${indent}${indent}${JSON.stringify(k)}: ${JSON.stringify(v)}`
  );
  const block = [
    `${indent}${JSON.stringify(sectionName)}: {`,
    entryLines.join(`,${eol}`),
    `${indent}}`,
  ].join(eol);

  const prefix = rawJson.slice(0, lastNonSpaceIdx + 1);
  const suffix = rawJson.slice(lastBraceIdx);
  return `${prefix}${hasExistingProps && !hasTrailingComma ? ',' : ''}${eol}${block}${eol}${suffix}`;
}

/**
 * Merges `package.json` changes as minimal textual edits, preserving existing key order,
 * indentation, line endings, and formatting of all untouched lines.
 */
export function mergePackageJsonMinimal(originalText: string, proposedText: string): string {
  try {
    const origObj = JSON.parse(originalText) as Record<string, unknown>;
    const propObj = JSON.parse(proposedText) as Record<string, unknown>;
    const { indent, eol, trailingNewline } = detectIndentAndEol(originalText);

    const sections = ['scripts', 'dependencies', 'devDependencies'] as const;
    let working = originalText;

    const dangerousScriptSet = new Set<string>(
      DANGEROUS_INSTALL_SCRIPT_KEYS.map((k) => k.toLowerCase())
    );

    for (const section of sections) {
      const origSec =
        origObj[section] && typeof origObj[section] === 'object'
          ? (origObj[section] as Record<string, string>)
          : {};
      const propSec =
        propObj[section] && typeof propObj[section] === 'object'
          ? (propObj[section] as Record<string, string>)
          : {};

      const additions: Array<[string, string]> = [];
      for (const [key, val] of Object.entries(propSec)) {
        if (section === 'scripts' && dangerousScriptSet.has(key.toLowerCase())) {
          // Never merge install lifecycle scripts (preinstall, install, postinstall, etc.)
          continue;
        }
        if (!(key in origSec) && typeof val === 'string') {
          additions.push([key, val]);
        }
      }
      if (additions.length === 0) continue;

      const spliced = spliceKeysIntoExistingJsonObjectBlock(
        working,
        section,
        additions,
        indent,
        eol
      );
      if (spliced !== null) {
        working = spliced;
      } else {
        const appended = appendNewSectionToRootObject(working, section, additions, indent, eol);
        if (appended !== null) {
          working = appended;
        }
      }
    }

    if (trailingNewline && !working.endsWith('\n')) {
      working += eol;
    }

    // Confirm minimal splice produced valid JSON
    JSON.parse(working);
    return working;
  } catch {
    return proposedText;
  }
}

function buildTextMapFromWorkingFiles(
  workingFiles: Record<string, Uint8Array>,
  ingest: IngestResult
): Record<string, string> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const textMap: Record<string, string> = {};
  const manifestByPath = new Map(ingest.manifest.map((m) => [m.path, m]));

  for (const [path, bytes] of Object.entries(workingFiles)) {
    const orig = manifestByPath.get(path);
    if (orig && (orig.isBinary || orig.isNestedArchive || isIgnoredOrBuildPath(path))) {
      continue;
    }
    if (isIgnoredOrBuildPath(path)) continue;
    textMap[path] = decoder.decode(bytes);
  }
  return textMap;
}

function buildChangelogContent(
  ingest: IngestResult,
  profileId: ProfileId,
  modifiers: string[],
  outcomes: AppliedProposalOutcome[],
  existingChangelog: string | null
): string {
  const applied = outcomes.filter((o) => o.status === 'applied');
  const rolledBack = outcomes.filter((o) => o.status === 'rolled-back');
  const dateStr = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    `# Upgrade Changelog (${dateStr})`,
    '',
    `- **Source archive**: \`${escapeMarkdownCodeSpan(ingest.archiveName)}\``,
    `- **Locked profile**: \`${escapeMarkdownCodeSpan(profileId)}\`${modifiers.length > 0 ? ` (modifiers: ${modifiers.map((m) => `\`${escapeMarkdownCodeSpan(m)}\``).join(', ')})` : ''}`,
    `- **Applied proposals**: ${applied.length}`,
    `- **Rolled back proposals**: ${rolledBack.length}`,
    `- **Execution disclaimer**: Verified in-browser via structural and static checks only. Builds and tests were not run.`,
    '',
    '## Applied Changes',
    '',
  ];

  if (applied.length === 0) {
    lines.push('No upgrade proposals were applied.', '');
  } else {
    for (const item of applied) {
      lines.push(
        `- **[Tier ${item.riskTier}] ${escapeMarkdownInline(item.title)}** (${escapeMarkdownInline(item.source)}, licence: ${escapeMarkdownInline(item.licence)})`
      );
      lines.push(
        `  - Files: ${item.touchedPaths.map((p) => `\`${escapeMarkdownCodeSpan(p)}\``).join(', ')}`
      );
    }
    lines.push('');
  }

  if (rolledBack.length > 0) {
    lines.push('## Rolled Back Proposals', '');
    for (const item of rolledBack) {
      lines.push(
        `- **[Tier ${item.riskTier}] ${escapeMarkdownInline(item.title)}** — rolled back: ${escapeMarkdownInline(item.reason)}`
      );
    }
    lines.push('');
  }

  const section = lines.join('\n');
  if (existingChangelog && existingChangelog.trim().length > 0) {
    return `${section}\n---\n\n${existingChangelog}`;
  }
  return `${section}`;
}

function buildNoticeContent(outcomes: AppliedProposalOutcome[]): string {
  const registry = registryData as RegistryEntry[];
  const policies = licencePolicyData as LicencePolicyRule[];
  const registryById = new Map(registry.map((r) => [r.id, r]));
  const policyByLicense = new Map(policies.map((p) => [p.license.toLowerCase(), p]));

  const addedLibs = outcomes.filter(
    (o) => o.status === 'applied' && o.source === 'registry-library' && o.packageName
  );

  const lines: string[] = [
    '# Third-Party Notices',
    '',
    'This file lists third-party packages added to the project archive by Zip Upgrader alongside their stated licences and policy notes.',
    '',
  ];

  if (addedLibs.length === 0) {
    lines.push('No external registry libraries were added during this upgrade.', '');
    return lines.join('\n');
  }

  for (const item of addedLibs) {
    const regEntry = Array.from(registryById.values()).find(
      (r) => r.package === item.packageName
    );
    const rule = policyByLicense.get(item.licence.toLowerCase());
    lines.push(`## ${escapeMarkdownInline(item.packageName ?? '')}`);
    lines.push('');
    lines.push(`- **Stated Licence**: ${escapeMarkdownInline(item.licence)}`);
    if (regEntry?.repo_url) {
      lines.push(`- **Source Repository**: ${escapeMarkdownInline(regEntry.repo_url)}`);
    }
    if (rule) {
      lines.push(`- **Policy Note**: ${escapeMarkdownInline(rule.action)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export interface ApplyEngineResult {
  outcomes: AppliedProposalOutcome[];
  appliedProposalIds: string[];
  rolledBackProposalIds: string[];
  addedPaths: string[];
  modifiedPaths: string[];
  workingFiles: Record<string, Uint8Array>;
  workingPermissions: Record<string, number>;
  changelogPath: string;
  noticePath: string;
  changelogMarkdown: string;
  noticeMarkdown: string;
}

export function applyApprovedProposalsSequentially(
  ingest: IngestResult,
  _analysis: DeterministicAnalysis,
  profileId: ProfileId,
  modifiers: string[],
  proposals: ProposalItem[]
): ApplyEngineResult {
  // 1. Work on an isolated copy map (untouched entries share immutable input Uint8Arrays;
  //    modified/added files always allocate new Uint8Arrays, avoiding duplicate memory).
  const workingFiles: Record<string, Uint8Array> = {};
  const workingPermissions: Record<string, number> = {};
  const manifestByPath = new Map(ingest.manifest.map((m) => [m.path, m]));
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const encoder = new TextEncoder();

  for (const [path, bytes] of Object.entries(ingest.rawEntriesByPath)) {
    workingFiles[path] = bytes;
    const origEntry = manifestByPath.get(path);
    const decodedHead =
      origEntry && !origEntry.isBinary ? decoder.decode(bytes.subarray(0, 64)) : undefined;
    workingPermissions[path] = resolveOutputPermissions(
      path,
      origEntry?.unixPermissions ?? null,
      decodedHead
    );
  }

  const originalPaths = new Set(Object.keys(ingest.rawEntriesByPath));
  const originalPackageJsonByPath: Record<string, string> = {};
  for (const [p, entry] of Object.entries(ingest.textFiles)) {
    if (getBaseNameLower(p) === 'package.json') {
      originalPackageJsonByPath[p] = entry.content;
    }
  }
  const approvedProposals = proposals.filter((p) => p.approved && !p.aiRejected);

  const outcomes: AppliedProposalOutcome[] = [];
  const appliedProposalIds: string[] = [];
  const rolledBackProposalIds: string[] = [];
  const addedPathsSet = new Set<string>();
  const modifiedPathsSet = new Set<string>();

  // 2. Apply approved proposals one at a time, running checks after each
  for (const proposal of approvedProposals) {
    const snapshots = new Map<
      string,
      { existed: boolean; bytes?: Uint8Array; perms?: number }
    >();
    const touchedInThisProposal: string[] = [];
    const checksRun: string[] = [
      'Path & overwrite safety',
      'Registry & install-script policy',
      'JSON syntax',
      'JS/TS parse',
      'Dependency & import check',
      'Secret scan',
    ];

    let applyFailureReason: string | null = null;

    const policyCheck = enforceRegistryAndInstallScriptPolicyForProposal(
      proposal,
      originalPackageJsonByPath
    );
    if (!policyCheck.ok) {
      applyFailureReason = policyCheck.reason;
    }

    for (const change of proposal.filesToAddOrChange) {
      if (applyFailureReason) break;
      const existedInWorking = change.path in workingFiles;
      const pathCheck = validateWriteTargetPath(change.path, {
        action: change.action,
        targetExists: existedInWorking,
        forbidCiWithoutTierC: true,
        riskTier: proposal.riskTier,
      });
      if (!pathCheck.valid) {
        applyFailureReason = pathCheck.reason ?? `Unsafe path "${change.path}".`;
        break;
      }

      const normalizedPath = pathCheck.normalizedPath;
      const targetExistsNormalized = normalizedPath in workingFiles;
      if (targetExistsNormalized && change.action !== 'modify') {
        applyFailureReason = `Refused to overwrite existing file "${normalizedPath}" without action="modify".`;
        break;
      }

      if (!snapshots.has(normalizedPath)) {
        snapshots.set(normalizedPath, {
          existed: targetExistsNormalized,
          bytes: targetExistsNormalized ? workingFiles[normalizedPath].slice() : undefined,
          perms: targetExistsNormalized ? workingPermissions[normalizedPath] : undefined,
        });
      }

      let finalContent: string;

      if (targetExistsNormalized && getBaseNameLower(normalizedPath) === 'package.json') {
        const currentText = decoder.decode(workingFiles[normalizedPath]);
        finalContent = mergePackageJsonMinimal(currentText, change.afterContent);
      } else if (!targetExistsNormalized) {
        finalContent = formatGeneratedFileContent(normalizedPath, change.afterContent);
      } else {
        // Existing file: never reformat whole file; apply exact targeted content
        finalContent = change.afterContent;
      }

      workingFiles[normalizedPath] = encoder.encode(finalContent);
      workingPermissions[normalizedPath] = resolveOutputPermissions(
        normalizedPath,
        snapshots.get(normalizedPath)?.perms ?? null,
        finalContent.slice(0, 64)
      );
      touchedInThisProposal.push(normalizedPath);
    }

    // 3. Run per-proposal validation checks
    if (!applyFailureReason) {
      const textMap = buildTextMapFromWorkingFiles(workingFiles, ingest);
      const allOutputPaths = new Set(Object.keys(workingFiles));
      const depCheck = checkPackageJsonDependencies(textMap);
      const hasPackageJson = Object.keys(textMap).some(
        (p) => !isIgnoredOrBuildPath(p) && getBaseNameLower(p) === 'package.json'
      );

      for (const touchedPath of touchedInThisProposal) {
        const content = textMap[touchedPath];
        if (content === undefined) continue;

        const baseLower = getBaseNameLower(touchedPath);
        if (baseLower.endsWith('.json') || baseLower.endsWith('.webmanifest')) {
          const jsonCheck = validateJsonContent(touchedPath, content);
          if (!jsonCheck.valid) {
            applyFailureReason = `${touchedPath} failed JSON parse: ${jsonCheck.error}`;
            break;
          }
        }

        if (isJsOrTsPath(touchedPath)) {
          const syntaxCheck = validateJsTsSyntax(touchedPath, content);
          if (!syntaxCheck.valid) {
            applyFailureReason = `${touchedPath} failed JS/TS parse: ${syntaxCheck.error}`;
            break;
          }
        }

        const secrets = scanTextForSecrets(touchedPath, content);
        if (secrets.length > 0) {
          applyFailureReason = `${touchedPath} triggered secret scanner (${secrets[0].label}).`;
          break;
        }
      }

      if (!applyFailureReason && !depCheck.passed) {
        applyFailureReason = depCheck.issues[0] ?? 'Duplicate or conflicting dependency entry.';
      }

      if (!applyFailureReason) {
        const importCheck = checkAllImportsResolve(
          textMap,
          allOutputPaths,
          depCheck.declaredPackages,
          hasPackageJson
        );
        const touchedSet = new Set(touchedInThisProposal);
        const touchedUnresolved = importCheck.unresolvedImports.find((u) =>
          touchedSet.has(u.file)
        );
        if (touchedUnresolved) {
          applyFailureReason = `${touchedUnresolved.file}: ${touchedUnresolved.reason}`;
        }
      }
    }

    if (applyFailureReason) {
      // 4. Roll back ONLY this proposal cleanly
      for (const [path, snap] of snapshots.entries()) {
        if (snap.existed && snap.bytes) {
          workingFiles[path] = snap.bytes;
          if (snap.perms !== undefined) {
            workingPermissions[path] = snap.perms;
          }
        } else {
          delete workingFiles[path];
          delete workingPermissions[path];
        }
      }
      rolledBackProposalIds.push(proposal.id);
      outcomes.push({
        proposalId: proposal.id,
        title: proposal.title,
        riskTier: proposal.riskTier,
        source: proposal.source,
        packageName: proposal.packageName,
        licence: proposal.licence,
        status: 'rolled-back',
        reason: applyFailureReason,
        touchedPaths: touchedInThisProposal,
        checksRun,
      });
    } else {
      appliedProposalIds.push(proposal.id);
      for (const path of touchedInThisProposal) {
        if (originalPaths.has(path)) {
          modifiedPathsSet.add(path);
        } else {
          addedPathsSet.add(path);
        }
      }
      outcomes.push({
        proposalId: proposal.id,
        title: proposal.title,
        riskTier: proposal.riskTier,
        source: proposal.source,
        packageName: proposal.packageName,
        licence: proposal.licence,
        status: 'applied',
        reason: 'All per-proposal structural, syntax, dependency, import, and secret checks passed.',
        touchedPaths: touchedInThisProposal,
        checksRun,
      });
    }
  }

  // 5. Generate CHANGELOG.md and NOTICE.md (always formatted as generated output files)
  const rootPrefix = detectRootPrefix(ingest);
  const existingChangelogPath = Object.keys(workingFiles).find(
    (p) => getBaseNameLower(p) === 'changelog.md' && !isIgnoredOrBuildPath(p)
  );
  const changelogPath = existingChangelogPath ?? `${rootPrefix}CHANGELOG.md`;
  const existingChangelogText = existingChangelogPath
    ? decoder.decode(workingFiles[existingChangelogPath])
    : null;

  const changelogMarkdown = buildChangelogContent(
    ingest,
    profileId,
    modifiers,
    outcomes,
    existingChangelogText
  );
  workingFiles[changelogPath] = encoder.encode(changelogMarkdown);
  workingPermissions[changelogPath] = 0o100644;
  if (originalPaths.has(changelogPath)) {
    modifiedPathsSet.add(changelogPath);
  } else {
    addedPathsSet.add(changelogPath);
  }

  const noticePath = `${rootPrefix}NOTICE.md`;
  const noticeMarkdown = buildNoticeContent(outcomes);
  workingFiles[noticePath] = encoder.encode(noticeMarkdown);
  workingPermissions[noticePath] = 0o100644;
  if (originalPaths.has(noticePath)) {
    modifiedPathsSet.add(noticePath);
  } else {
    addedPathsSet.add(noticePath);
  }

  return {
    outcomes,
    appliedProposalIds,
    rolledBackProposalIds,
    addedPaths: Array.from(addedPathsSet).sort(),
    modifiedPaths: Array.from(modifiedPathsSet).sort(),
    workingFiles,
    workingPermissions,
    changelogPath,
    noticePath,
    changelogMarkdown,
    noticeMarkdown,
  };
}
