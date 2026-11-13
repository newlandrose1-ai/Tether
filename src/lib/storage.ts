import Dexie, { type Table } from 'dexie';
import type {
  Project,
  TetherGroup,
  Block,
  Tether,
  ImmutableRevision,
  BlockSandbox,
  ProjectSnapshot,
  AuditRun,
  PromotionRecord,
} from '../types/model';

export class TetherDatabase extends Dexie {
  projects!: Table<Project, string>;
  groups!: Table<TetherGroup, string>;
  blocks!: Table<Block, string>;
  tethers!: Table<Tether, string>;
  revisions!: Table<ImmutableRevision, string>;
  sandboxes!: Table<BlockSandbox, string>;
  projectSnapshots!: Table<ProjectSnapshot, string>;
  auditRuns!: Table<AuditRun, string>;
  promotionRecords!: Table<PromotionRecord, string>;

  constructor() {
    super('tether_workspace_db');

    // Version 1 (Initial schema)
    this.version(1).stores({
      projects: 'id, createdAt, updatedAt',
      groups: 'id, projectId, createdAt',
      blocks: 'id, projectId, groupId, kind, status, createdAt',
      tethers: 'id, projectId, groupId, sourceBlockId, targetBlockId, createdAt',
    });

    // Version 2 (Audit-Promote & Sandboxing Durable Foundation)
    this.version(2)
      .stores({
        projects: 'id, createdAt, updatedAt',
        groups: 'id, projectId, createdAt',
        blocks: 'id, projectId, groupId, kind, status, activeRevisionId, createdAt',
        tethers: 'id, projectId, groupId, sourceBlockId, targetBlockId, createdAt',
        revisions: 'id, projectId, blockId, contentHash, origin, createdAt, [projectId+blockId], [projectId+contentHash]',
        sandboxes: 'id, projectId, sourceBlockId, status, updatedAt, [projectId+sourceBlockId]',
        projectSnapshots: 'id, projectId, manifestHash, createdAt',
        auditRuns: 'id, projectId, baselineRevisionId, candidateRevisionId, lifecycleState, createdAt',
        promotionRecords: 'id, projectId, blockId, auditRunId, timestamp',
      })
      .upgrade((tx) => {
        // Upgrade migration: ensure existing blocks have updated schema compliance
        return tx
          .table('blocks')
          .toCollection()
          .modify((block: Block) => {
            if (!block.activeRevisionId && block.data && 'currentContent' in block.data) {
              // Existing blocks retain stable identity
              block.sourcePath = (block.data as { path?: string })?.path || block.title;
            }
          });
      });
  }
}

// In-memory fallback repository for non-browser runtimes (CLI, automated tests, SSR)
class InMemoryStore {
  projects = new Map<string, Project>();
  groups = new Map<string, TetherGroup>();
  blocks = new Map<string, Block>();
  tethers = new Map<string, Tether>();
  revisions = new Map<string, ImmutableRevision>();
  sandboxes = new Map<string, BlockSandbox>();
  projectSnapshots = new Map<string, ProjectSnapshot>();
  auditRuns = new Map<string, AuditRun>();
  promotionRecords = new Map<string, PromotionRecord>();

  clear() {
    this.projects.clear();
    this.groups.clear();
    this.blocks.clear();
    this.tethers.clear();
    this.revisions.clear();
    this.sandboxes.clear();
    this.projectSnapshots.clear();
    this.auditRuns.clear();
    this.promotionRecords.clear();
  }
}

export const inMemoryStore = new InMemoryStore();

let dbInstance: TetherDatabase | null = null;
let forceInMemory = false;

export function setForceInMemory(val: boolean) {
  forceInMemory = val;
}

export function getDatabase(): TetherDatabase | null {
  if (forceInMemory || typeof window === 'undefined') return null;
  if (!dbInstance) {
    dbInstance = new TetherDatabase();
  }
  return dbInstance;
}

export async function loadWorkspaceFromStorage(): Promise<{
  projects: Project[];
  groups: TetherGroup[];
  blocks: Block[];
  tethers: Tether[];
}> {
  const db = getDatabase();
  if (!db) {
    return {
      projects: Array.from(inMemoryStore.projects.values()),
      groups: Array.from(inMemoryStore.groups.values()),
      blocks: Array.from(inMemoryStore.blocks.values()),
      tethers: Array.from(inMemoryStore.tethers.values()),
    };
  }

  const [projects, groups, blocks, tethers] = await Promise.all([
    db.projects.toArray(),
    db.groups.toArray(),
    db.blocks.toArray(),
    db.tethers.toArray(),
  ]);

  return { projects, groups, blocks, tethers };
}

export async function persistProject(project: Project): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.projects.set(project.id, { ...project });
    return;
  }
  await db.projects.put(project);
}

export async function removeProjectFromStorage(id: string): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.projects.delete(id);
    for (const [k, v] of inMemoryStore.groups.entries()) if (v.projectId === id) inMemoryStore.groups.delete(k);
    for (const [k, v] of inMemoryStore.blocks.entries()) if (v.projectId === id) inMemoryStore.blocks.delete(k);
    for (const [k, v] of inMemoryStore.tethers.entries()) if (v.projectId === id) inMemoryStore.tethers.delete(k);
    for (const [k, v] of inMemoryStore.revisions.entries()) if (v.projectId === id) inMemoryStore.revisions.delete(k);
    for (const [k, v] of inMemoryStore.sandboxes.entries()) if (v.projectId === id) inMemoryStore.sandboxes.delete(k);
    for (const [k, v] of inMemoryStore.projectSnapshots.entries()) if (v.projectId === id) inMemoryStore.projectSnapshots.delete(k);
    for (const [k, v] of inMemoryStore.auditRuns.entries()) if (v.projectId === id) inMemoryStore.auditRuns.delete(k);
    for (const [k, v] of inMemoryStore.promotionRecords.entries()) if (v.projectId === id) inMemoryStore.promotionRecords.delete(k);
    return;
  }
  await db.transaction(
    'rw',
    [
      db.projects,
      db.groups,
      db.blocks,
      db.tethers,
      db.revisions,
      db.sandboxes,
      db.projectSnapshots,
      db.auditRuns,
      db.promotionRecords,
    ],
    async () => {
      await db.projects.delete(id);
      await db.groups.where('projectId').equals(id).delete();
      await db.blocks.where('projectId').equals(id).delete();
      await db.tethers.where('projectId').equals(id).delete();
      await db.revisions.where('projectId').equals(id).delete();
      await db.sandboxes.where('projectId').equals(id).delete();
      await db.projectSnapshots.where('projectId').equals(id).delete();
      await db.auditRuns.where('projectId').equals(id).delete();
      await db.promotionRecords.where('projectId').equals(id).delete();
    }
  );
}

export async function persistGroup(group: TetherGroup): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.groups.set(group.id, { ...group });
    return;
  }
  await db.groups.put(group);
}

export async function removeGroupFromStorage(id: string): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.groups.delete(id);
    for (const [k, v] of inMemoryStore.blocks.entries()) if (v.groupId === id) inMemoryStore.blocks.delete(k);
    for (const [k, v] of inMemoryStore.tethers.entries()) if (v.groupId === id) inMemoryStore.tethers.delete(k);
    return;
  }
  await db.transaction('rw', db.groups, db.blocks, db.tethers, async () => {
    await db.groups.delete(id);
    await db.blocks.where('groupId').equals(id).delete();
    await db.tethers.where('groupId').equals(id).delete();
  });
}

export async function persistBlock(block: Block): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.blocks.set(block.id, { ...block });
    return;
  }
  await db.blocks.put(block);
}

export async function getBlockFromStorage(id: string): Promise<Block | undefined> {
  const db = getDatabase();
  if (!db) {
    const b = inMemoryStore.blocks.get(id);
    return b ? { ...b } : undefined;
  }
  return db.blocks.get(id);
}

export async function removeBlockFromStorage(id: string, tetherIdsToDelete: string[]): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.blocks.delete(id);
    for (const tid of tetherIdsToDelete) inMemoryStore.tethers.delete(tid);
    return;
  }
  await db.transaction('rw', db.blocks, db.tethers, async () => {
    await db.blocks.delete(id);
    if (tetherIdsToDelete.length > 0) {
      await db.tethers.bulkDelete(tetherIdsToDelete);
    }
  });
}

export async function persistTether(tether: Tether): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.tethers.set(tether.id, { ...tether });
    return;
  }
  await db.tethers.put(tether);
}

export async function removeTetherFromStorage(id: string): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.tethers.delete(id);
    return;
  }
  await db.tethers.delete(id);
}

// =============================================================================
// AUDIT & PROMOTE STAGE 1 STORAGE OPERATIONS
// =============================================================================

export async function persistRevision(revision: ImmutableRevision): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.revisions.set(revision.id, { ...revision });
    return;
  }
  await db.revisions.put(revision);
}

export async function getRevisionById(id: string): Promise<ImmutableRevision | undefined> {
  const db = getDatabase();
  if (!db) {
    const r = inMemoryStore.revisions.get(id);
    return r ? { ...r } : undefined;
  }
  return db.revisions.get(id);
}

export async function getRevisionsByBlockId(projectId: string, blockId: string): Promise<ImmutableRevision[]> {
  const db = getDatabase();
  if (!db) {
    return Array.from(inMemoryStore.revisions.values())
      .filter((r) => r.projectId === projectId && r.blockId === blockId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  return db.revisions
    .where(['projectId', 'blockId'])
    .equals([projectId, blockId])
    .sortBy('createdAt');
}

export async function persistSandbox(sandbox: BlockSandbox): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.sandboxes.set(sandbox.id, { ...sandbox });
    return;
  }
  await db.sandboxes.put(sandbox);
}

export async function getSandboxById(id: string): Promise<BlockSandbox | undefined> {
  const db = getDatabase();
  if (!db) {
    const s = inMemoryStore.sandboxes.get(id);
    return s ? { ...s } : undefined;
  }
  return db.sandboxes.get(id);
}

export async function getActiveSandboxForBlock(projectId: string, sourceBlockId: string): Promise<BlockSandbox | undefined> {
  const db = getDatabase();
  if (!db) {
    return Array.from(inMemoryStore.sandboxes.values()).find(
      (s) => s.projectId === projectId && s.sourceBlockId === sourceBlockId && s.status === 'active'
    );
  }
  return db.sandboxes
    .where(['projectId', 'sourceBlockId'])
    .equals([projectId, sourceBlockId])
    .and((s) => s.status === 'active')
    .first();
}

export async function getSandboxesForBlock(projectId: string, sourceBlockId: string): Promise<BlockSandbox[]> {
  const db = getDatabase();
  if (!db) {
    return Array.from(inMemoryStore.sandboxes.values())
      .filter((s) => s.projectId === projectId && s.sourceBlockId === sourceBlockId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return db.sandboxes
    .where(['projectId', 'sourceBlockId'])
    .equals([projectId, sourceBlockId])
    .reverse()
    .sortBy('updatedAt');
}

export async function getAllSandboxesForProject(projectId: string): Promise<BlockSandbox[]> {
  const db = getDatabase();
  if (!db) {
    return Array.from(inMemoryStore.sandboxes.values())
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return db.sandboxes
    .where('projectId')
    .equals(projectId)
    .reverse()
    .sortBy('updatedAt');
}

export async function persistProjectSnapshot(snapshot: ProjectSnapshot): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.projectSnapshots.set(snapshot.id, { ...snapshot });
    return;
  }
  await db.projectSnapshots.put(snapshot);
}

export async function getProjectSnapshotById(id: string): Promise<ProjectSnapshot | undefined> {
  const db = getDatabase();
  if (!db) {
    const s = inMemoryStore.projectSnapshots.get(id);
    return s ? { ...s } : undefined;
  }
  return db.projectSnapshots.get(id);
}

export async function persistAuditRun(auditRun: AuditRun): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.auditRuns.set(auditRun.id, { ...auditRun });
    return;
  }
  await db.auditRuns.put(auditRun);
}

export async function getAuditRunById(id: string): Promise<AuditRun | undefined> {
  const db = getDatabase();
  if (!db) {
    const a = inMemoryStore.auditRuns.get(id);
    return a ? { ...a } : undefined;
  }
  return db.auditRuns.get(id);
}

export async function persistPromotionRecord(record: PromotionRecord): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.promotionRecords.set(record.id, { ...record });
    return;
  }
  await db.promotionRecords.put(record);
}

export async function getPromotionRecordsByBlock(projectId: string, blockId: string): Promise<PromotionRecord[]> {
  const db = getDatabase();
  if (!db) {
    return Array.from(inMemoryStore.promotionRecords.values())
      .filter((p) => p.projectId === projectId && p.blockId === blockId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  return db.promotionRecords
    .where('projectId')
    .equals(projectId)
    .and((p) => p.blockId === blockId)
    .sortBy('timestamp');
}

export async function replaceWorkspaceStorage(data: {
  projects: Project[];
  groups: TetherGroup[];
  blocks: Block[];
  tethers: Tether[];
}): Promise<void> {
  const db = getDatabase();
  if (!db) {
    inMemoryStore.clear();
    for (const p of data.projects) inMemoryStore.projects.set(p.id, p);
    for (const g of data.groups) inMemoryStore.groups.set(g.id, g);
    for (const b of data.blocks) inMemoryStore.blocks.set(b.id, b);
    for (const t of data.tethers) inMemoryStore.tethers.set(t.id, t);
    return;
  }
  await db.transaction('rw', db.projects, db.groups, db.blocks, db.tethers, async () => {
    await db.projects.clear();
    await db.groups.clear();
    await db.blocks.clear();
    await db.tethers.clear();

    if (data.projects.length > 0) await db.projects.bulkAdd(data.projects);
    if (data.groups.length > 0) await db.groups.bulkAdd(data.groups);
    if (data.blocks.length > 0) await db.blocks.bulkAdd(data.blocks);
    if (data.tethers.length > 0) await db.tethers.bulkAdd(data.tethers);
  });
}
