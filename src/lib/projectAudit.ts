import type {
  AuditFinding,
  AuditKnowledgeGap,
  AuditTargetFileReport,
  AuditTargetType,
  AuditVerificationProof,
  Block,
  CodeBlockData,
  FileBlockData,
  Project,
  TargetAuditReport,
} from '../types/model';
import { runCodeAudit, type CodeAuditProjectContext } from './codeAudit';
import { collectProjectZipManifest } from './projectZipExport';
import { getFileTypeInfo } from './fileTypes';

export interface AuditTargetParams {
  targetType: AuditTargetType;
  project: Project;
  blocks: Block[];
  blockId?: string;
  folderPath?: string;
  selectedBlockIds?: string[];
  includeUntethered?: boolean;
}

function extractDeclaredDependencies(
  files: Array<{ path: string; content: string; encoding: 'utf-8' | 'base64' }>
): string[] | undefined {
  const pkgEntry = files.find(
    (f) => f.encoding === 'utf-8' && f.path.toLowerCase().split('/').pop() === 'package.json'
  );
  if (!pkgEntry) return undefined;
  try {
    const parsed = JSON.parse(pkgEntry.content) as Record<string, unknown>;
    const deps = new Set<string>();
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const section = parsed[key];
      if (section && typeof section === 'object' && !Array.isArray(section)) {
        for (const pkgName of Object.keys(section as Record<string, unknown>)) {
          deps.add(pkgName);
        }
      }
    }
    return Array.from(deps);
  } catch {
    return undefined;
  }
}

function getLanguageForBlock(block: Block, path: string): string {
  if (block.kind === 'code') {
    const lang = (block.data as CodeBlockData)?.language;
    if (lang) return lang;
  }
  const base = path.split('/').pop() || block.title;
  const ext = base.includes('.') ? base.split('.').pop()?.toLowerCase() : undefined;
  if (ext) return ext;
  return block.kind === 'text' ? 'markdown' : 'javascript';
}

function isBlockTextAuditable(block: Block, path: string): boolean {
  if (block.kind === 'upload') return false;
  if (block.kind === 'file') {
    const fData = block.data as FileBlockData;
    if (fData?.binary || fData?.isPdf) return false;
  }
  const fileInfo = getFileTypeInfo({
    title: path.split('/').pop() || block.title,
    kind: block.kind,
    mimeType: (block.data as FileBlockData)?.mimeType,
    binary: (block.data as FileBlockData)?.binary,
    isPdf: (block.data as FileBlockData)?.isPdf,
    language: (block.data as CodeBlockData)?.language,
  });
  return fileInfo.isTextEditable;
}

/**
 * Runs a unified audit across any supported target:
 * - single code block or single file ('block' | 'file')
 * - selected subset of blocks ('selection')
 * - folder subtree ('folder')
 * - full live seed / .zip project ('project')
 */
export function auditTarget(params: AuditTargetParams): TargetAuditReport {
  const {
    targetType,
    project,
    blocks,
    blockId,
    folderPath,
    selectedBlockIds = [],
    includeUntethered = true,
  } = params;

  const manifest = collectProjectZipManifest(project, blocks, {
    includeUntethered,
  });

  const projectContext: CodeAuditProjectContext = {
    allPaths: manifest.files.map((f) => f.path),
    declaredDependencies: extractDeclaredDependencies(manifest.files),
  };

  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const normalizedFolder = (folderPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');

  let targetEntries = manifest.files;
  let targetLabel = `${project.name} (${manifest.archiveFileName})`;

  if (targetType === 'block' || targetType === 'file') {
    const matched = manifest.files.filter((f) => f.blockId === blockId);
    if (matched.length > 0) {
      targetEntries = matched;
      targetLabel = matched[0].path;
    } else if (blockId) {
      const b = blockById.get(blockId);
      if (b && isBlockTextAuditable(b, b.sourcePath || b.title)) {
        const content =
          b.kind === 'code'
            ? (b.data as CodeBlockData)?.currentContent || ''
            : (b.data as { content?: string })?.content || '';
        const p = (b.sourcePath || (b.data as { path?: string })?.path || b.title).replace(
          /^\/+/,
          ''
        );
        targetEntries = [
          {
            blockId: b.id,
            path: p,
            name: b.title,
            content,
            encoding: 'utf-8',
            byteSize: new TextEncoder().encode(content).byteLength,
            isTethered: Boolean(b.isInFolderStructure),
            kind: b.kind,
          },
        ];
        targetLabel = p;
      } else {
        targetEntries = [];
        targetLabel = b?.title || 'Selected Block';
      }
    }
  } else if (targetType === 'selection') {
    const selectedSet = new Set(selectedBlockIds);
    const inManifest = manifest.files.filter((f) => selectedSet.has(f.blockId));
    const includedIds = new Set(inManifest.map((f) => f.blockId));
    const extras = selectedBlockIds
      .filter((id) => !includedIds.has(id))
      .map((id) => blockById.get(id))
      .filter((b): b is Block => Boolean(b && b.projectId === project.id && isBlockTextAuditable(b, b.sourcePath || b.title)))
      .map((b) => {
        const content =
          b.kind === 'code'
            ? (b.data as CodeBlockData)?.currentContent || ''
            : (b.data as { content?: string })?.content || '';
        const p = (b.sourcePath || (b.data as { path?: string })?.path || b.title).replace(
          /^\/+/,
          ''
        );
        return {
          blockId: b.id,
          path: p,
          name: b.title,
          content,
          encoding: 'utf-8' as const,
          byteSize: new TextEncoder().encode(content).byteLength,
          isTethered: Boolean(b.isInFolderStructure),
          kind: b.kind,
        };
      });
    targetEntries = [...inManifest, ...extras];
    targetLabel = `Selected (${targetEntries.length} file${targetEntries.length === 1 ? '' : 's'})`;
  } else if (targetType === 'folder') {
    targetEntries = manifest.files.filter(
      (f) =>
        normalizedFolder &&
        (f.path === normalizedFolder || f.path.startsWith(`${normalizedFolder}/`))
    );
    targetLabel = normalizedFolder ? `${normalizedFolder}/` : 'Folder';
  }

  const fileReports: AuditTargetFileReport[] = [];
  const allFindings: AuditFinding[] = [];
  const allKnowledgeGaps: AuditKnowledgeGap[] = [];
  const contentHashes: Record<string, string> = {};
  const checksSet = new Set<string>();

  for (const entry of targetEntries) {
    if (entry.encoding === 'base64') continue;
    const block = blockById.get(entry.blockId);
    if (!block || !isBlockTextAuditable(block, entry.path)) continue;

    const language = getLanguageForBlock(block, entry.path);
    const result = runCodeAudit({
      content: entry.content,
      language,
      path: entry.path,
      blockId: block.id,
      projectContext,
    });

    contentHashes[block.id] = result.contentHash;
    if (result.verification?.checksRun) {
      for (const c of result.verification.checksRun) checksSet.add(c);
    }

    fileReports.push({
      blockId: block.id,
      path: entry.path,
      title: block.title,
      language: result.language,
      passed: result.passed,
      testable: result.testable,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      findings: result.findings,
      knowledgeGaps: result.knowledgeGaps,
      contentHash: result.contentHash,
      verification: result.verification,
    });

    allFindings.push(...result.findings);
    allKnowledgeGaps.push(...result.knowledgeGaps);
  }

  const errorCount = fileReports.reduce((sum, r) => sum + r.errorCount, 0);
  const warningCount = fileReports.reduce((sum, r) => sum + r.warningCount, 0);
  const passed = errorCount === 0;
  const testable = passed && fileReports.every((r) => r.testable);

  const verification: AuditVerificationProof = {
    compiledCleanly: fileReports.every((r) => r.verification?.compiledCleanly ?? r.passed),
    typeCheckedCleanly: fileReports.every((r) => r.verification?.typeCheckedCleanly ?? r.passed),
    runtimeVerified:
      fileReports.length > 0 &&
      fileReports.some((r) => r.verification?.runtimeVerified) &&
      passed,
    geminiAudited: false,
    checksRun: Array.from(checksSet),
    summary:
      fileReports.length === 0
        ? 'No auditable text or code files in selected target.'
        : passed
        ? `All ${fileReports.length} file(s) parsed cleanly with 0 errors.`
        : `${errorCount} error(s) must be fixed before target is testable.`,
  };

  return {
    targetType,
    targetLabel,
    projectId: project.id,
    auditedAt: Date.now(),
    filesAudited: fileReports.length,
    passed,
    testable,
    errorCount,
    warningCount,
    fileReports,
    findings: allFindings,
    knowledgeGaps: allKnowledgeGaps,
    contentHashes,
    verification,
  };
}
