import { describe, it, expect, beforeEach } from 'bun:test';
import {
  auditPromoteService,
  AuditPromoteService,
} from '../src/lib/auditPromoteService';
import {
  setForceInMemory,
  inMemoryStore,
  persistProject,
  persistBlock,
} from '../src/lib/storage';
import { computeContentHash } from '../src/lib/hash';
import {
  ProjectOwnershipError,
  ConcurrencyConflictError,
  SnapshotIntegrityError,
  type Block,
  type Project,
} from '../src/types/model';

describe('Audit-Promote Stage 1 Foundation Tests', () => {
  const projectAId = 'proj-alpha-123';
  const projectBId = 'proj-beta-456';

  let blockA1: Block;
  let blockA2: Block;
  let blockB1: Block;

  beforeEach(async () => {
    // Force in-memory test store and reset
    setForceInMemory(true);
    inMemoryStore.clear();

    const now = Date.now();

    // Setup Project A
    const projA: Project = { id: projectAId, name: 'Project Alpha', createdAt: now, updatedAt: now };
    await persistProject(projA);

    // Setup Project B
    const projB: Project = { id: projectBId, name: 'Project Beta', createdAt: now, updatedAt: now };
    await persistProject(projB);

    // Setup Block A1 in Project A
    blockA1 = {
      id: 'block-a1',
      projectId: projectAId,
      groupId: 'grp-1',
      kind: 'code',
      title: 'main.ts',
      sourcePath: 'src/main.ts',
      x: 0,
      y: 0,
      status: 'ready',
      data: {
        path: 'src/main.ts',
        language: 'typescript',
        currentContent: 'export const x = 42;\n',
        revisions: [],
      },
      createdAt: now,
      updatedAt: now,
    };
    await persistBlock(blockA1);

    // Setup Block A2 in Project A
    blockA2 = {
      id: 'block-a2',
      projectId: projectAId,
      groupId: 'grp-1',
      kind: 'code',
      title: 'utils.ts',
      sourcePath: 'src/utils.ts',
      x: 100,
      y: 0,
      status: 'ready',
      data: {
        path: 'src/utils.ts',
        language: 'typescript',
        currentContent: 'export function add(a: number, b: number) { return a + b; }\n',
        revisions: [],
      },
      createdAt: now,
      updatedAt: now,
    };
    await persistBlock(blockA2);

    // Setup Block B1 in Project B
    blockB1 = {
      id: 'block-b1',
      projectId: projectBId,
      groupId: 'grp-b',
      kind: 'code',
      title: 'secret.ts',
      sourcePath: 'src/secret.ts',
      x: 0,
      y: 0,
      status: 'ready',
      data: {
        path: 'src/secret.ts',
        language: 'typescript',
        currentContent: 'export const betaSecret = "top-secret";\n',
        revisions: [],
      },
      createdAt: now,
      updatedAt: now,
    };
    await persistBlock(blockB1);
  });

  // 1. Immutable Revision Behavior
  it('enforces immutable revision behavior and content deduplication', async () => {
    const rev1 = await auditPromoteService.createRevision({
      projectId: projectAId,
      blockId: blockA1.id,
      content: 'console.log("immutable v1");',
      origin: 'edited',
      label: 'v1.0.0',
    });

    expect(rev1.id).toBeDefined();
    expect(rev1.content).toBe('console.log("immutable v1");');
    expect(rev1.contentHash).toBe(computeContentHash('console.log("immutable v1");'));

    // Attempting to create identical content for same block returns existing immutable revision
    const revDuplicate = await auditPromoteService.createRevision({
      projectId: projectAId,
      blockId: blockA1.id,
      content: 'console.log("immutable v1");',
      origin: 'edited',
    });
    expect(revDuplicate.id).toBe(rev1.id);

    // Different content produces a distinct immutable revision
    const rev2 = await auditPromoteService.createRevision({
      projectId: projectAId,
      blockId: blockA1.id,
      content: 'console.log("immutable v2");',
      origin: 'edited',
      parentRevisionIds: [rev1.id],
    });
    expect(rev2.id).not.toBe(rev1.id);
    expect(rev2.parentRevisionIds).toEqual([rev1.id]);
    expect(rev2.contentHash).toBe(computeContentHash('console.log("immutable v2");'));
  });

  // 2. Hash Stability and Change Detection
  it('guarantees hash stability and detects changes deterministically', async () => {
    const content = 'export const API_URL = "https://api.example.com";\n';
    const hash1 = computeContentHash(content);
    const hash2 = computeContentHash(content);

    // Stability: identical content always has the exact same SHA-256
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // Standard SHA-256 hex length

    // Change detection: single byte difference alters the hash
    const modifiedContent = 'export const API_URL = "https://api.example.com"; ';
    const modifiedHash = computeContentHash(modifiedContent);
    expect(modifiedHash).not.toBe(hash1);
  });

  // 3. Sandbox Isolation
  it('isolates sandbox mutations from the active block until explicit promotion', async () => {
    // Initial active content of blockA1 is 'export const x = 42;\n'
    const sandbox = await auditPromoteService.createSandbox({
      projectId: projectAId,
      sourceBlockId: blockA1.id,
    });

    expect(sandbox.workingContent).toBe('export const x = 42;\n');
    expect(sandbox.version).toBe(1);
    expect(sandbox.status).toBe('active');

    // Mutate the sandbox
    const updatedSandbox = await auditPromoteService.updateSandboxWorkingContent({
      projectId: projectAId,
      sandboxId: sandbox.id,
      expectedVersion: 1,
      newWorkingContent: 'export const x = 999; // sandboxed experimental work\n',
    });

    expect(updatedSandbox.workingContent).toBe('export const x = 999; // sandboxed experimental work\n');
    expect(updatedSandbox.version).toBe(2);

    // Verify Active Block in Project A remains completely un-mutated!
    const activeBlock = await inMemoryStore.blocks.get(blockA1.id);
    expect((activeBlock?.data as { currentContent?: string })?.currentContent).toBe('export const x = 42;\n');
  });

  // 4. Cross-Project Access Denial
  it('strictly denies cross-project access across all read and write operations', async () => {
    // Attempt to create a revision on Project A block using Project B credentials
    await expect(
      auditPromoteService.createRevision({
        projectId: projectBId,
        blockId: blockA1.id,
        content: 'malicious injection',
        origin: 'edited',
      })
    ).rejects.toThrow(ProjectOwnershipError);

    // Create a revision in Project A
    const revA = await auditPromoteService.createRevision({
      projectId: projectAId,
      blockId: blockA1.id,
      content: 'clean code',
      origin: 'edited',
    });

    // Attempt to read Project A revision from Project B context
    await expect(
      auditPromoteService.getRevision(projectBId, revA.id)
    ).rejects.toThrow(ProjectOwnershipError);

    // Attempt to create sandbox in Project B for Project A block
    await expect(
      auditPromoteService.createSandbox({
        projectId: projectBId,
        sourceBlockId: blockA1.id,
      })
    ).rejects.toThrow(ProjectOwnershipError);

    // Create sandbox in Project A
    const sandboxA = await auditPromoteService.createSandbox({
      projectId: projectAId,
      sourceBlockId: blockA1.id,
    });

    // Attempt to update Project A sandbox using Project B credentials
    await expect(
      auditPromoteService.updateSandboxWorkingContent({
        projectId: projectBId,
        sandboxId: sandboxA.id,
        expectedVersion: 1,
        newWorkingContent: 'stolen access',
      })
    ).rejects.toThrow(ProjectOwnershipError);
  });

  // 5. Snapshot Manifest Integrity
  it('creates deterministic snapshot manifests, scrubs secrets, and detects tampering', async () => {
    // Add a sensitive env block to Project A to test secret exclusion
    const envBlock: Block = {
      id: 'block-env',
      projectId: projectAId,
      groupId: 'grp-1',
      kind: 'text',
      title: '.env.local',
      sourcePath: '.env.local',
      x: 0,
      y: 0,
      status: 'ready',
      data: { content: 'DATABASE_PASSWORD=super-secret-pw-123' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await persistBlock(envBlock);

    const snapshot = await auditPromoteService.createProjectSnapshot({
      projectId: projectAId,
    });

    expect(snapshot.id).toBeDefined();
    expect(snapshot.manifestHash.length).toBe(64);

    // Verify secret scrubbing: .env.local must NOT be in manifest entries
    const envEntry = snapshot.manifest.find((m) => m.path === '.env.local' || m.blockId === 'block-env');
    expect(envEntry).toBeUndefined();

    // Verify integrity passes
    const isValid = await auditPromoteService.verifySnapshotIntegrity(projectAId, snapshot.id);
    expect(isValid).toBe(true);

    // Tampering test: if manifest is tampered, verification must fail
    snapshot.manifest[0].contentHash = 'tampered-fake-hash';
    await expect(
      auditPromoteService.verifySnapshotIntegrity(projectAId, snapshot.id)
    ).rejects.toThrow(SnapshotIntegrityError);
  });

  // 6. Concurrent Sandbox-Edit Conflict Handling
  it('detects and rejects conflicting concurrent updates using optimistic concurrency', async () => {
    const sandbox = await auditPromoteService.createSandbox({
      projectId: projectAId,
      sourceBlockId: blockA1.id,
    });

    expect(sandbox.version).toBe(1);

    // Client 1 applies edit based on version 1
    const edit1 = await auditPromoteService.updateSandboxWorkingContent({
      projectId: projectAId,
      sandboxId: sandbox.id,
      expectedVersion: 1,
      newWorkingContent: 'client 1 update',
    });

    expect(edit1.version).toBe(2);

    // Client 2 (stale, still holding version 1) attempts to submit
    await expect(
      auditPromoteService.updateSandboxWorkingContent({
        projectId: projectAId,
        sandboxId: sandbox.id,
        expectedVersion: 1, // Stale!
        newWorkingContent: 'client 2 conflicting update',
      })
    ).rejects.toThrow(ConcurrencyConflictError);
  });

  // 7. Full Promotion Lineage Flow
  it('executes full promotion lineage from sandbox to active block with cryptographic snapshots', async () => {
    const sandbox = await auditPromoteService.createSandbox({
      projectId: projectAId,
      sourceBlockId: blockA2.id,
    });

    await auditPromoteService.updateSandboxWorkingContent({
      projectId: projectAId,
      sandboxId: sandbox.id,
      expectedVersion: 1,
      newWorkingContent: 'export function add(a: number, b: number) { return (a + b) | 0; } // optimized\n',
    });

    const { promotionRecord, promotedRevision, updatedBlock } = await auditPromoteService.promoteSandbox({
      projectId: projectAId,
      sandboxId: sandbox.id,
      actor: 'senior-engineer',
      reason: 'Bitwise optimization after benchmark',
    });

    expect(promotionRecord.actor).toBe('senior-engineer');
    expect(promotionRecord.reason).toBe('Bitwise optimization after benchmark');
    expect(promotionRecord.beforeProjectSnapshotId).toBeDefined();
    expect(promotionRecord.afterProjectSnapshotId).toBeDefined();
    expect(promotionRecord.newActiveRevisionId).toBe(promotedRevision.id);

    // Verify block content updated
    expect((updatedBlock.data as { currentContent?: string }).currentContent).toBe(
      'export function add(a: number, b: number) { return (a + b) | 0; } // optimized\n'
    );
    expect(updatedBlock.activeRevisionId).toBe(promotedRevision.id);

    // Sandbox is now archived
    const archivedSandbox = await inMemoryStore.sandboxes.get(sandbox.id);
    expect(archivedSandbox?.status).toBe('archived');
  });
});
