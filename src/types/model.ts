export type BlockKind = 'text' | 'upload' | 'file' | 'code';

export type BlockStatus = 'idle' | 'extracting' | 'ready' | 'error';

export type RevisionOrigin =
  | 'imported'
  | 'edited'
  | 'candidate'
  | 'generated'
  | 'restored'
  | 'before-promotion';

/**
 * Prior lightweight revision format for backwards compatibility
 */
export interface CodeRevision {
  id: string;
  createdAt: number;
  content: string;
  label?: string;
  contentHash?: string;
  origin?: RevisionOrigin;
}

export interface TextBlockData {
  content: string;
}

export interface UploadBlockData {
  fileName: string;
  size: number;
  extractedBlockIds: string[];
  structureCollapsed?: boolean;
  expandedFolderPaths?: string[];
}

export interface FileBlockData {
  path: string;
  mimeType: string;
  size: number;
  content?: string;
  binary: boolean;
  parentFolderPath?: string;
  dataUrl?: string;
  isPdf?: boolean;
}

export interface CodeBlockData {
  path: string;
  language: string;
  currentContent: string;
  revisions: CodeRevision[];
}

export type BlockData =
  | TextBlockData
  | UploadBlockData
  | FileBlockData
  | CodeBlockData;

export interface FolderStructureNode {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  blockId?: string;
  parentBlockId?: string;
  groupId?: string;
  tetherLabel?: string;
  children: FolderStructureNode[];
}

export interface Block<T extends BlockData = BlockData> {
  id: string;
  projectId: string;
  groupId: string;
  kind: BlockKind;
  title: string;
  sourcePath?: string;
  originalSourcePath?: string;
  tetherParentId?: string;
  isInFolderStructure?: boolean;
  projectCategory?: string;
  activeRevisionId?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  collapsed?: boolean;
  copiedFromBlockId?: string;
  lastAuditStatus?: 'unverified' | 'passed' | 'failed';
  lastAuditHash?: string;
  lastAuditFindings?: AuditFinding[];
  lastAuditRunId?: string;
  status: BlockStatus;
  data: T;
  createdAt: number;
  updatedAt: number;
}

export interface TetherGroup {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: number;
}

export type GitHubDeployMode = 'source' | 'web-html' | 'source-and-web';

export interface GitHubRepoLink {
  owner: string;
  repo: string;
  branch: string;
  deployMode: GitHubDeployMode;
  lastDeployedAt?: number;
  lastCommitSha?: string;
  lastCommitUrl?: string;
  lastDeployedBy?: string;
}

export interface Project {
  id: string;
  name: string;
  githubLink?: GitHubRepoLink;
  folderStructure?: FolderStructureNode[];
  createdAt: number;
  updatedAt: number;
}

export interface Tether {
  id: string;
  projectId: string;
  groupId: string;
  sourceBlockId: string;
  targetBlockId: string;
  label?: string;
  createdAt: number;
}

// =============================================================================
// STAGE 1 AUDIT & PROMOTE DATA MODELS
// =============================================================================

/**
 * Immutable, content-addressed revision
 */
export interface ImmutableRevision {
  id: string;
  projectId: string;
  blockId: string;
  content: string;
  contentHash: string; // Deterministic SHA-256
  parentRevisionIds: string[];
  origin: RevisionOrigin;
  label?: string;
  author?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export type SandboxStatus = 'active' | 'archived';

/**
 * Isolated mutable working sandbox for draft experimentation
 */
export interface BlockSandbox {
  id: string;
  projectId: string;
  sourceBlockId: string;
  baseRevisionId: string;
  baseProjectSnapshotId?: string;
  workingContent: string;
  version: number; // Monotonically increasing for optimistic concurrency
  status: SandboxStatus;
  createdAt: number;
  updatedAt: number;
}

export interface SnapshotManifestEntry {
  blockId: string;
  path: string;
  revisionId: string;
  contentHash: string;
  kind: BlockKind;
}

export interface SnapshotGraphState {
  tethers: Array<{
    id: string;
    sourceBlockId: string;
    targetBlockId: string;
    label?: string;
  }>;
}

/**
 * Point-in-time immutable project snapshot with canonical manifest
 */
export interface ProjectSnapshot {
  id: string;
  projectId: string;
  manifestHash: string; // Deterministic SHA-256 of sorted canonical manifest
  manifest: SnapshotManifestEntry[];
  graphState: SnapshotGraphState;
  dependencyRefs?: Record<string, string>;
  scope: {
    includedBlockIds: string[];
    excludedPaths?: string[];
  };
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export type AuditLifecycleState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AuditFinding {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  ruleId?: string;
  file?: string;
  blockId?: string;
  category?:
    | 'syntax'
    | 'semantic'
    | 'logic'
    | 'types'
    | 'imports'
    | 'structure'
    | 'security'
    | 'runtime'
    | 'knowledge-gap';
  fixable?: boolean;
  suggestion?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  from?: number;
  to?: number;
}

export type AuditTargetType = 'block' | 'file' | 'folder' | 'selection' | 'project';

export interface AuditVerificationProof {
  compiledCleanly: boolean;
  typeCheckedCleanly: boolean;
  runtimeVerified: boolean;
  geminiAudited: boolean;
  checksRun: string[];
  summary: string;
}

export interface AuditKnowledgeGap {
  id: string;
  blockId?: string;
  file: string;
  language: string;
  frameworkOrTopic: string;
  reason: string;
  suggestedQuery: string;
}

export interface AuditTargetFileReport {
  blockId: string;
  path: string;
  title: string;
  language: string;
  passed: boolean;
  testable: boolean;
  errorCount: number;
  warningCount: number;
  findings: AuditFinding[];
  knowledgeGaps: AuditKnowledgeGap[];
  contentHash: string;
  verification?: AuditVerificationProof;
}

export interface TargetAuditReport {
  targetType: AuditTargetType;
  targetLabel: string;
  projectId: string;
  auditedAt: number;
  filesAudited: number;
  passed: boolean;
  testable: boolean;
  errorCount: number;
  warningCount: number;
  fileReports: AuditTargetFileReport[];
  findings: AuditFinding[];
  knowledgeGaps: AuditKnowledgeGap[];
  contentHashes: Record<string, string>;
  verification?: AuditVerificationProof;
}

export interface AutofixWebSource {
  title: string;
  uri: string;
  query?: string;
}

export interface AutofixStepLog {
  id: string;
  iteration: number;
  phase:
    | 'audit'
    | 'verify'
    | 'gemini-audit'
    | 'fix'
    | 'web-search'
    | 're-audit'
    | 'clean'
    | 'stopped'
    | 'unresolved';
  message: string;
  filePath?: string;
  errorCount?: number;
  warningCount?: number;
  sources?: AutofixWebSource[];
  timestamp: number;
}

export interface AutofixSessionResult {
  status: 'clean' | 'stopped' | 'unresolved' | 'declined';
  iterations: number;
  report: TargetAuditReport;
  steps: AutofixStepLog[];
  modifiedBlockIds: string[];
  webSources: AutofixWebSource[];
  remainingReason?: string;
  verification?: AuditVerificationProof;
}

/**
 * Audit run evaluating baseline vs candidate revisions within a snapshot context
 */
export interface AuditRun {
  id: string;
  projectId: string;
  baselineRevisionId: string;
  candidateRevisionId: string;
  projectSnapshotId?: string;
  checkConfigHash: string;
  lifecycleState: AuditLifecycleState;
  findings: AuditFinding[];
  evidence?: Record<string, unknown>;
  artifactRefs?: string[];
  cancellationReason?: string;
  failureMetadata?: {
    error: string;
    stack?: string;
  };
  createdAt: number;
  completedAt?: number;
}

export interface PromotionOverrideMetadata {
  overriddenBy?: string;
  justification?: string;
}

/**
 * Cryptographically linked record of a revision promotion event
 */
export interface PromotionRecord {
  id: string;
  projectId: string;
  blockId: string;
  previousActiveRevisionId: string;
  newActiveRevisionId: string;
  beforeProjectSnapshotId: string;
  afterProjectSnapshotId: string;
  auditRunId?: string;
  actor: string;
  reason: string;
  overrideMetadata?: PromotionOverrideMetadata;
  timestamp: number;
}

// =============================================================================
// DOMAIN ERRORS
// =============================================================================

export class ProjectOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectOwnershipError';
  }
}

export class ConcurrencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}

export class ImmutableRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImmutableRevisionError';
  }
}

export class SnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotIntegrityError';
  }
}
