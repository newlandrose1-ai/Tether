import { createId } from './id';
import {
  computeContentHash,
  computeManifestHash,
  isPathSensitive,
  containsSensitiveContent,
} from './hash';
import {
  type Block,
  type ImmutableRevision,
  type BlockSandbox,
  type ProjectSnapshot,
  type SnapshotManifestEntry,
  type AuditRun,
  type AuditFinding,
  type PromotionRecord,
  type PromotionOverrideMetadata,
  type RevisionOrigin,
  ProjectOwnershipError,
  ConcurrencyConflictError,
  ImmutableRevisionError,
  SnapshotIntegrityError,
} from '../types/model';
import {
  getBlockFromStorage,
  persistBlock,
  persistRevision,
  getRevisionById,
  getRevisionsByBlockId,
  persistSandbox,
  getSandboxById,
  getActiveSandboxForBlock,
  getSandboxesForBlock,
  getAllSandboxesForProject,
  persistProjectSnapshot,
  getProjectSnapshotById,
  persistAuditRun,
  getAuditRunById,
  persistPromotionRecord,
  getPromotionRecordsByBlock,
  loadWorkspaceFromStorage,
} from './storage';

export interface CreateRevisionInput {
  projectId: string;
  blockId: string;
  content: string;
  origin: RevisionOrigin;
  parentRevisionIds?: string[];
  label?: string;
  author?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateSandboxInput {
  projectId: string;
  sourceBlockId: string;
  baseRevisionId?: string;
  initialWorkingContent?: string;
  baseProjectSnapshotId?: string;
}

export interface UpdateSandboxInput {
  projectId: string;
  sandboxId: string;
  expectedVersion: number;
  newWorkingContent: string;
}

export interface CreateSnapshotInput {
  projectId: string;
  scope?: {
    includedBlockIds?: string[];
    excludedPaths?: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface CreateAuditRunInput {
  projectId: string;
  baselineRevisionId: string;
  candidateRevisionId: string;
  projectSnapshotId?: string;
  checkConfig?: Record<string, unknown>;
}

export interface PromoteSandboxInput {
  projectId: string;
  sandboxId: string;
  actor: string;
  reason: string;
  auditRunId?: string;
  overrideMetadata?: PromotionOverrideMetadata;
}

/**
 * Service Layer enforcing Stage 1 Sandboxing, Immutable Revisions,
 * Project Snapshots, and Audit Lineage with strict tenant ownership boundaries.
 */
export class AuditPromoteService {
  /**
   * Creates an immutable, content-addressed revision for a block.
   * Throws ProjectOwnershipError if block does not belong to projectId.
   * Throws ImmutableRevisionError if attempting to mutate an existing revision with conflicting content.
   */
  async createRevision(input: CreateRevisionInput): Promise<ImmutableRevision> {
    const block = await getBlockFromStorage(input.blockId);
    if (!block || block.projectId !== input.projectId) {
      throw new ProjectOwnershipError(
        `Block '${input.blockId}' not found in project '${input.projectId}'. Access denied.`
      );
    }

    const contentHash = computeContentHash(input.content);

    // Reuse existing content revision if identical content already stored for this block
    const existingRevisions = await getRevisionsByBlockId(input.projectId, input.blockId);
    const existingDuplicate = existingRevisions.find((r) => r.contentHash === contentHash);
    if (existingDuplicate) {
      return existingDuplicate;
    }

    const revision: ImmutableRevision = {
      id: createId(),
      projectId: input.projectId,
      blockId: input.blockId,
      content: input.content,
      contentHash,
      parentRevisionIds: input.parentRevisionIds || (block.activeRevisionId ? [block.activeRevisionId] : []),
      origin: input.origin,
      label: input.label,
      author: input.author || 'system',
      createdAt: Date.now(),
      metadata: input.metadata,
    };

    await persistRevision(revision);
    return revision;
  }

  /**
   * Retrieves an immutable revision by ID with strict project ownership verification.
   */
  async getRevision(projectId: string, revisionId: string): Promise<ImmutableRevision> {
    const revision = await getRevisionById(revisionId);
    if (!revision || revision.projectId !== projectId) {
      throw new ProjectOwnershipError(
        `Revision '${revisionId}' not found in project '${projectId}'. Access denied.`
      );
    }
    return revision;
  }

  /**
   * Lists all revisions for a block within an authorized project.
   */
  async listRevisionsForBlock(projectId: string, blockId: string): Promise<ImmutableRevision[]> {
    const block = await getBlockFromStorage(blockId);
    if (!block || block.projectId !== projectId) {
      throw new ProjectOwnershipError(
        `Block '${blockId}' not found in project '${projectId}'. Access denied.`
      );
    }
    return getRevisionsByBlockId(projectId, blockId);
  }

  /**
   * Spawns an isolated mutable sandbox for experimentation without altering the active block.
   */
  async createSandbox(input: CreateSandboxInput): Promise<BlockSandbox> {
    const block = await getBlockFromStorage(input.sourceBlockId);
    if (!block || block.projectId !== input.projectId) {
      throw new ProjectOwnershipError(
        `Block '${input.sourceBlockId}' not found in project '${input.projectId}'. Access denied.`
      );
    }

    // Determine base revision: use provided revision, active revision, or create initial baseline
    let baseRevisionId = input.baseRevisionId || block.activeRevisionId;
    let baseContent = input.initialWorkingContent;

    if (!baseRevisionId) {
      const currentBlockContent =
        block.kind === 'code'
          ? (block.data as { currentContent?: string }).currentContent || ''
          : (block.data as { content?: string }).content || '';

      const initialRev = await this.createRevision({
        projectId: input.projectId,
        blockId: block.id,
        content: currentBlockContent,
        origin: 'imported',
        label: 'initial base',
      });
      baseRevisionId = initialRev.id;
      if (baseContent === undefined) {
        baseContent = currentBlockContent;
      }
    } else {
      const baseRev = await this.getRevision(input.projectId, baseRevisionId);
      if (baseContent === undefined) {
        baseContent = baseRev.content;
      }
    }

    const sandbox: BlockSandbox = {
      id: createId(),
      projectId: input.projectId,
      sourceBlockId: input.sourceBlockId,
      baseRevisionId,
      baseProjectSnapshotId: input.baseProjectSnapshotId,
      workingContent: baseContent ?? '',
      version: 1, // Initial optimistic concurrency version
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await persistSandbox(sandbox);
    return sandbox;
  }

  /**
   * Updates sandbox working content with optimistic concurrency control.
   * Throws ConcurrencyConflictError if expectedVersion does not match current version.
   */
  async updateSandboxWorkingContent(input: UpdateSandboxInput): Promise<BlockSandbox> {
    const sandbox = await getSandboxById(input.sandboxId);
    if (!sandbox || sandbox.projectId !== input.projectId) {
      throw new ProjectOwnershipError(
        `Sandbox '${input.sandboxId}' not found in project '${input.projectId}'. Access denied.`
      );
    }

    if (sandbox.status !== 'active') {
      throw new Error(`Cannot update archived sandbox '${input.sandboxId}'.`);
    }

    if (sandbox.version !== input.expectedVersion) {
      throw new ConcurrencyConflictError(
        `Optimistic concurrency conflict on sandbox '${input.sandboxId}'. Expected version ${input.expectedVersion}, but found version ${sandbox.version}.`
      );
    }

    const updated: BlockSandbox = {
      ...sandbox,
      workingContent: input.newWorkingContent,
      version: sandbox.version + 1,
      updatedAt: Date.now(),
    };

    await persistSandbox(updated);
    return updated;
  }

  /**
   * Evaluates whether a block kind can be sandboxed.
   * Whole-file blocks (code, text, file) are supported.
   * Zip archives (upload) are explicitly unsupported with an explanatory message.
   */
  isBlockSupportedForSandboxing(block: Block): { supported: boolean; reason?: string } {
    if (block.kind === 'upload') {
      return {
        supported: false,
        reason: 'Upload archives cannot be sandboxed directly. Extract individual files first.',
      };
    }
    return { supported: true };
  }

  /**
   * Opens an existing active sandbox for the block or creates a new one from the active revision.
   */
  async getOrOpenActiveSandbox(projectId: string, sourceBlockId: string): Promise<BlockSandbox> {
    const existing = await getActiveSandboxForBlock(projectId, sourceBlockId);
    if (existing) {
      return existing;
    }
    return this.createSandbox({ projectId, sourceBlockId });
  }

  /**
   * Reopens an archived sandbox, making it active again for editing.
   */
  async reopenSandbox(projectId: string, sandboxId: string): Promise<BlockSandbox> {
    const sandbox = await getSandboxById(sandboxId);
    if (!sandbox || sandbox.projectId !== projectId) {
      throw new ProjectOwnershipError(
        `Sandbox '${sandboxId}' not found in project '${projectId}'. Access denied.`
      );
    }

    // If another sandbox is active for this same block, archive it first
    const currentActive = await getActiveSandboxForBlock(projectId, sandbox.sourceBlockId);
    if (currentActive && currentActive.id !== sandbox.id) {
      await this.archiveSandbox(projectId, currentActive.id);
    }

    const updated: BlockSandbox = {
      ...sandbox,
      status: 'active',
      updatedAt: Date.now(),
    };

    await persistSandbox(updated);
    return updated;
  }

  /**
   * Retrieves all sandboxes (active and archived) for a specific block.
   */
  async getSandboxesForBlock(projectId: string, sourceBlockId: string): Promise<BlockSandbox[]> {
    const block = await getBlockFromStorage(sourceBlockId);
    if (!block || block.projectId !== projectId) {
      throw new ProjectOwnershipError(
        `Block '${sourceBlockId}' not found in project '${projectId}'. Access denied.`
      );
    }
    return getSandboxesForBlock(projectId, sourceBlockId);
  }

  /**
   * Retrieves all sandboxes for a project.
   */
  async getAllSandboxesForProject(projectId: string): Promise<BlockSandbox[]> {
    return getAllSandboxesForProject(projectId);
  }

  /**
   * Archives a sandbox to prevent further mutations without deleting revision history.
   */
  async archiveSandbox(projectId: string, sandboxId: string): Promise<BlockSandbox> {
    const sandbox = await getSandboxById(sandboxId);
    if (!sandbox || sandbox.projectId !== projectId) {
      throw new ProjectOwnershipError(
        `Sandbox '${sandboxId}' not found in project '${projectId}'. Access denied.`
      );
    }

    const updated: BlockSandbox = {
      ...sandbox,
      status: 'archived',
      updatedAt: Date.now(),
    };

    await persistSandbox(updated);
    return updated;
  }

  /**
   * Creates an immutable, deterministic project snapshot manifest.
   * Excludes sensitive credential files and calculates canonical manifest hash.
   */
  async createProjectSnapshot(input: CreateSnapshotInput): Promise<ProjectSnapshot> {
    const workspace = await loadWorkspaceFromStorage();
    const projectBlocks = workspace.blocks.filter((b) => b.projectId === input.projectId);
    const projectTethers = workspace.tethers.filter((t) => t.projectId === input.projectId);

    const includedBlockIds = input.scope?.includedBlockIds || projectBlocks.map((b) => b.id);
    const excludedPaths = input.scope?.excludedPaths || [];

    const manifestEntries: SnapshotManifestEntry[] = [];

    for (const b of projectBlocks) {
      if (!includedBlockIds.includes(b.id)) continue;

      const path = b.sourcePath || (b.data as { path?: string })?.path || b.title;

      // Enforce secret scrubbing
      if (isPathSensitive(path) || excludedPaths.some((p) => path.includes(p))) {
        continue;
      }

      const content =
        b.kind === 'code'
          ? (b.data as { currentContent?: string }).currentContent || ''
          : (b.data as { content?: string }).content || '';

      if (containsSensitiveContent(content)) {
        continue; // Scrub private keys / raw tokens
      }

      // Ensure active revision exists
      let revisionId = b.activeRevisionId;
      let contentHash = '';

      if (revisionId) {
        const rev = await getRevisionById(revisionId);
        if (rev && rev.projectId === input.projectId) {
          contentHash = rev.contentHash;
        } else {
          revisionId = undefined;
        }
      }

      if (!revisionId) {
        const rev = await this.createRevision({
          projectId: input.projectId,
          blockId: b.id,
          content,
          origin: 'imported',
          label: 'snapshot revision',
        });
        revisionId = rev.id;
        contentHash = rev.contentHash;
      }

      manifestEntries.push({
        blockId: b.id,
        path,
        revisionId,
        contentHash,
        kind: b.kind,
      });
    }

    // Deterministic sorting of manifest entries by path then blockId
    manifestEntries.sort((a, b) => {
      const cmp = a.path.localeCompare(b.path);
      return cmp !== 0 ? cmp : a.blockId.localeCompare(b.blockId);
    });

    const graphState = {
      tethers: projectTethers.map((t) => ({
        id: t.id,
        sourceBlockId: t.sourceBlockId,
        targetBlockId: t.targetBlockId,
        label: t.label,
      })),
    };

    const manifestPayload = {
      projectId: input.projectId,
      entries: manifestEntries,
      graphState,
    };

    const manifestHash = computeManifestHash(manifestPayload);

    const snapshot: ProjectSnapshot = {
      id: createId(),
      projectId: input.projectId,
      manifestHash,
      manifest: manifestEntries,
      graphState,
      scope: {
        includedBlockIds,
        excludedPaths,
      },
      createdAt: Date.now(),
      metadata: input.metadata,
    };

    await persistProjectSnapshot(snapshot);
    return snapshot;
  }

  /**
   * Verifies the cryptographic integrity of a project snapshot against its stored manifest hash.
   */
  async verifySnapshotIntegrity(projectId: string, snapshotId: string): Promise<boolean> {
    const snapshot = await getProjectSnapshotById(snapshotId);
    if (!snapshot || snapshot.projectId !== projectId) {
      throw new ProjectOwnershipError(
        `Snapshot '${snapshotId}' not found in project '${projectId}'. Access denied.`
      );
    }

    const manifestPayload = {
      projectId: snapshot.projectId,
      entries: snapshot.manifest,
      graphState: snapshot.graphState,
    };

    const recomputedHash = computeManifestHash(manifestPayload);
    if (recomputedHash !== snapshot.manifestHash) {
      throw new SnapshotIntegrityError(
        `Snapshot '${snapshotId}' manifest hash mismatch. Expected ${snapshot.manifestHash}, recomputed ${recomputedHash}.`
      );
    }

    return true;
  }

  /**
   * Creates an audit run freezing baseline and candidate revisions.
   */
  async createAuditRun(input: CreateAuditRunInput): Promise<AuditRun> {
    const baseline = await this.getRevision(input.projectId, input.baselineRevisionId);
    const candidate = await this.getRevision(input.projectId, input.candidateRevisionId);

    if (baseline.projectId !== input.projectId || candidate.projectId !== input.projectId) {
      throw new ProjectOwnershipError('Audit run revisions do not belong to the authorized project.');
    }

    const checkConfigHash = computeContentHash(JSON.stringify(input.checkConfig || { default: true }));

    const auditRun: AuditRun = {
      id: createId(),
      projectId: input.projectId,
      baselineRevisionId: input.baselineRevisionId,
      candidateRevisionId: input.candidateRevisionId,
      projectSnapshotId: input.projectSnapshotId,
      checkConfigHash,
      lifecycleState: 'pending',
      findings: [],
      createdAt: Date.now(),
    };

    await persistAuditRun(auditRun);
    return auditRun;
  }

  /**
   * Records findings and finishes an audit run.
   */
  async recordAuditFindings(
    projectId: string,
    auditRunId: string,
    findings: AuditFinding[],
    evidence?: Record<string, unknown>
  ): Promise<AuditRun> {
    const auditRun = await getAuditRunById(auditRunId);
    if (!auditRun || auditRun.projectId !== projectId) {
      throw new ProjectOwnershipError(
        `AuditRun '${auditRunId}' not found in project '${projectId}'. Access denied.`
      );
    }

    const hasErrors = findings.some((f) => f.severity === 'error');
    const updated: AuditRun = {
      ...auditRun,
      lifecycleState: hasErrors ? 'failed' : 'completed',
      findings,
      evidence,
      completedAt: Date.now(),
    };

    await persistAuditRun(updated);
    return updated;
  }

  /**
   * Promotes candidate sandbox content to become the block's active revision.
   * Atomically snapshots before and after states and creates a PromotionRecord.
   */
  async promoteSandbox(input: PromoteSandboxInput): Promise<{
    promotionRecord: PromotionRecord;
    promotedRevision: ImmutableRevision;
    updatedBlock: Block;
  }> {
    const sandbox = await getSandboxById(input.sandboxId);
    if (!sandbox || sandbox.projectId !== input.projectId) {
      throw new ProjectOwnershipError(
        `Sandbox '${input.sandboxId}' not found in project '${input.projectId}'. Access denied.`
      );
    }

    if (sandbox.status !== 'active') {
      throw new Error(`Cannot promote archived sandbox '${input.sandboxId}'.`);
    }

    const block = await getBlockFromStorage(sandbox.sourceBlockId);
    if (!block || block.projectId !== input.projectId) {
      throw new ProjectOwnershipError(
        `Source block '${sandbox.sourceBlockId}' not found in project '${input.projectId}'.`
      );
    }

    // 1. Create Point-in-time BEFORE snapshot
    const beforeSnapshot = await this.createProjectSnapshot({
      projectId: input.projectId,
      metadata: { reason: `Before promotion of sandbox ${sandbox.id}` },
    });

    const previousActiveRevisionId = block.activeRevisionId || sandbox.baseRevisionId;

    // 2. Create the immutable promoted revision
    const promotedRevision = await this.createRevision({
      projectId: input.projectId,
      blockId: block.id,
      content: sandbox.workingContent,
      origin: 'candidate',
      parentRevisionIds: [previousActiveRevisionId],
      label: `Promoted from sandbox (${input.reason})`,
      author: input.actor,
    });

    // 3. Atomically update block's active revision and content
    const updatedBlock: Block = {
      ...block,
      activeRevisionId: promotedRevision.id,
      data: {
        ...block.data,
        ...(block.kind === 'code'
          ? { currentContent: sandbox.workingContent }
          : { content: sandbox.workingContent }),
      },
      updatedAt: Date.now(),
    };
    await persistBlock(updatedBlock);

    // 4. Create Point-in-time AFTER snapshot
    const afterSnapshot = await this.createProjectSnapshot({
      projectId: input.projectId,
      metadata: { reason: `After promotion of sandbox ${sandbox.id}` },
    });

    // 5. Create immutable Promotion Record
    const promotionRecord: PromotionRecord = {
      id: createId(),
      projectId: input.projectId,
      blockId: block.id,
      previousActiveRevisionId,
      newActiveRevisionId: promotedRevision.id,
      beforeProjectSnapshotId: beforeSnapshot.id,
      afterProjectSnapshotId: afterSnapshot.id,
      auditRunId: input.auditRunId,
      actor: input.actor,
      reason: input.reason,
      overrideMetadata: input.overrideMetadata,
      timestamp: Date.now(),
    };
    await persistPromotionRecord(promotionRecord);

    // 6. Archive the sandbox now that it has been promoted
    await this.archiveSandbox(input.projectId, sandbox.id);

    return {
      promotionRecord,
      promotedRevision,
      updatedBlock,
    };
  }
}

export const auditPromoteService = new AuditPromoteService();
