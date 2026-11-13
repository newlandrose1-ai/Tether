# Audit-Promote System Implementation Plan

This document establishes the architecture, data models, and migration plan for the Tether Sandboxing, Immutable Revisions, Project Snapshots, and Audit Lineage system.

---

## Architectural Overview

Tether provides a local-first workspace for code and document blocks connected via visual logic tethers. The **Audit-Promote System** introduces an enterprise-grade revision lineage and sandboxing foundation:

1. **Immutable Revisions**: Content revisions are write-once, content-addressed (SHA-256), and cryptographically verified.
2. **Isolated Sandboxes**: Mutable working buffers for drafting changes without affecting the active project state. Protected with optimistic concurrency versioning.
3. **Deterministic Project Snapshots**: Point-in-time immutable manifests capturing blocks, source paths, content hashes, and graph connectivity (tethers), with automatic secret scrubbing.
4. **Audit Runs**: Frozen baseline vs. candidate comparisons with structured findings, artifact references, and lifecycle states.
5. **Promotion Records**: Full cryptographic lineage linking before/after snapshot manifests, active revision swaps, actor attribution, and audit provenance.

---

## Stage 1: Durable Data Foundation (Active Implementation)

### 1. Core Data Models

#### Block Extension
- Stable UUID (`id`).
- Project ownership (`projectId`).
- Source mapping (`sourcePath` / `data.path`).
- Active revision pointer (`activeRevisionId`).
- Graph identity (`groupId`, position `x, y`, connected tethers).

#### Revision (`ImmutableRevision`)
- `id`: Stable revision UUID.
- `projectId`: Enforced project boundary.
- `blockId`: Reference to parent block.
- `content`: Immutable content text.
- `contentHash`: Deterministic SHA-256 hash of content.
- `parentRevisionIds`: Parent revision UUIDs for lineage DAG.
- `origin`: `'imported' | 'edited' | 'candidate' | 'generated' | 'restored' | 'before-promotion'`.
- `label`: Human-readable tag (e.g., `"v1.0"`, `"pre-refactor"`).
- `author`: Attributed actor (e.g., `"developer"`, `"system"`).
- `createdAt`: Millisecond timestamp.
- `metadata`: Optional structured metadata.

#### Sandbox (`BlockSandbox`)
- `id`: Sandbox UUID.
- `projectId`: Enforced project boundary.
- `sourceBlockId`: Block being sandboxed.
- `baseRevisionId`: The immutable revision this sandbox was branched from.
- `baseProjectSnapshotId`: Optional snapshot anchor for the whole project at branch time.
- `workingContent`: Mutable draft content.
- `version`: Monotonically increasing integer for optimistic concurrency control.
- `status`: `'active' | 'archived'`.
- `createdAt`, `updatedAt`: Millisecond timestamps.

#### Project Snapshot (`ProjectSnapshot`)
- `id`: Snapshot UUID.
- `projectId`: Enforced project boundary.
- `manifestHash`: Deterministic SHA-256 hash of canonicalized JSON manifest.
- `manifest`: Array of `{ blockId, path, revisionId, contentHash, kind }`.
- `graphState`: Tether graph snapshot `{ tethers: [{ id, sourceBlockId, targetBlockId, label }] }`.
- `dependencyRefs`: Key-value map of dependencies / package configurations.
- `scope`: `{ includedBlockIds: string[]; excludedPaths?: string[] }`.
- `createdAt`: Millisecond timestamp.

#### Audit Run (`AuditRun`)
- `id`: Audit run UUID.
- `projectId`: Enforced project boundary.
- `baselineRevisionId`: Frozen base revision.
- `candidateRevisionId`: Proposed candidate revision.
- `projectSnapshotId`: Snapshot contextualizing the audit run.
- `checkConfigHash`: SHA-256 hash of check rules and configuration.
- `lifecycleState`: `'pending' | 'running' | 'completed' | 'failed' | 'cancelled'`.
- `findings`: Array of `{ id, severity, message, ruleId?, file?, line? }`.
- `evidence`: Arbitrary structured evidence.
- `artifactRefs`: Output artifact identifiers.
- `cancellationReason`: Reason if cancelled.
- `failureMetadata`: Error stack and message if failed.
- `createdAt`, `completedAt`: Timestamps.

#### Promotion Record (`PromotionRecord`)
- `id`: Promotion record UUID.
- `projectId`: Enforced project boundary.
- `blockId`: Block whose active revision was promoted.
- `previousActiveRevisionId`: The revision active immediately prior to promotion.
- `newActiveRevisionId`: The promoted candidate revision.
- `beforeProjectSnapshotId`: Full project snapshot manifest immediately before promotion.
- `afterProjectSnapshotId`: Full project snapshot manifest immediately after promotion.
- `auditRunId`: Optional audit run that qualified this promotion.
- `actor`: Identity of user or service initiating promotion.
- `reason`: Rationale statement.
- `overrideMetadata`: Justification if audit was bypassed or overridden.
- `timestamp`: Millisecond timestamp.

---

### 2. Security & Invariant Rules
- **Strict Project Boundary**: Every query and mutation validates `entity.projectId === expectedProjectId`. Access across project boundaries throws `ProjectOwnershipError`.
- **Untrusted Client Inputs**: Project ownership is determined from verified context or session, never trusted blindly from entity payloads.
- **Secret Scrubbing**: Files matching credential patterns (`.env*`, `*KEY*`, `*SECRET*`, `*TOKEN*`, `*.pem`) are excluded or redacted in snapshot manifests.
- **Optimistic Concurrency**: Sandbox updates require `expectedVersion`. Conflicting updates throw `ConcurrencyConflictError`.
- **Content Deduplication**: Immutable revisions with identical content share the same content hash.

---

## Future Stages
- **Stage 2: Static Analysis & Local Diagnostics Engine**: Integration of browser-only AST linting, structure checking, and diff generation.
- **Stage 3: Interactive Sandbox Workspace & Promotion UI**: Side-by-side comparison, diagnostic gates, and promotion review modal.
- **Stage 4: Automated CI Audit Verification & Export**: Exportable provenance packages and reproducible snapshot verify tools.
