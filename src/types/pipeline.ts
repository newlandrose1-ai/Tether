import type { NestedArchivePolicy } from '../config/ingestConfig';

export type PipelineStage =
  | 'upload'
  | 'analyse'
  | 'intent'
  | 'findings'
  | 'approve'
  | 'apply'
  | 'verify'
  | 'download';

export interface PipelineStageMeta {
  id: PipelineStage;
  step: number;
  label: string;
  shortDescription: string;
}

export const PIPELINE_STAGES: readonly PipelineStageMeta[] = [
  {
    id: 'upload',
    step: 1,
    label: 'Upload',
    shortDescription: 'Ingest .zip, enforce safety limits, build SHA-256 manifest, scan secrets',
  },
  {
    id: 'analyse',
    step: 2,
    label: 'Analyse',
    shortDescription: 'Detect project runtime, dependencies, entry points, and layout',
  },
  {
    id: 'intent',
    step: 3,
    label: 'Intent lock',
    shortDescription: 'Confirm project type and upgrade target before proposing changes',
  },
  {
    id: 'findings',
    step: 4,
    label: 'Findings & proposals',
    shortDescription: 'Inspect deterministic gaps and structured upgrade proposals',
  },
  {
    id: 'approve',
    step: 5,
    label: 'Approve',
    shortDescription: 'Select and review exact file diffs to apply to the working copy',
  },
  {
    id: 'apply',
    step: 6,
    label: 'Apply',
    shortDescription: 'Patch the isolated browser copy while preserving untouched SHA-256 files',
  },
  {
    id: 'verify',
    step: 7,
    label: 'Verify',
    shortDescription: 'Run structural and static checks; honestly report unrun builds and tests',
  },
  {
    id: 'download',
    step: 8,
    label: 'Download',
    shortDescription: 'Export updated .zip archive alongside manifest proof and changelog',
  },
] as const;

export type AnalysisStatus =
  | 'analyzable'
  | 'ignored-dir'
  | 'build-output'
  | 'binary'
  | 'nested-archive'
  | 'huge-file'
  | 'text-capped';

export interface FileTreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size: number;
  sha256?: string;
  analysisStatus?: AnalysisStatus;
  redactBeforeAi?: boolean;
  children?: FileTreeNode[];
}

export interface ManifestEntry {
  path: string;
  size: number;
  compressedSize: number;
  sha256: string;
  isBinary: boolean;
  isIgnoredForAnalysis: boolean;
  isNestedArchive: boolean;
  analysisStatus: AnalysisStatus;
  unixPermissions: number | null;
  lastModified: string | null;
}

export interface TextFileEntry {
  path: string;
  content: string;
  originalBytes: number;
  truncated: boolean;
  lineCount: number;
  redactBeforeAi: boolean;
  secretFindingCount: number;
}

export type SkippedCategory =
  | 'ignored-dir'
  | 'build-output'
  | 'binary'
  | 'nested-archive'
  | 'huge-file'
  | 'text-cap';

export interface SkippedEntry {
  path: string;
  category: SkippedCategory;
  reason: string;
  size: number;
  retainedInZipAndManifest: boolean;
}

export interface SecretFinding {
  id: string;
  path: string;
  line: number;
  column: number;
  ruleId: string;
  label: string;
  severity: 'high' | 'medium';
  kind: 'pattern' | 'entropy';
  previewMasked: string;
  entropy?: number;
}

export type IngestErrorCode =
  | 'EMPTY_FILE'
  | 'INVALID_EXTENSION'
  | 'MALFORMED_ZIP'
  | 'MAX_ZIPPED_SIZE_EXCEEDED'
  | 'MAX_UNCOMPRESSED_SIZE_EXCEEDED'
  | 'MAX_FILE_COUNT_EXCEEDED'
  | 'COMPRESSION_RATIO_EXCEEDED'
  | 'MAX_DEPTH_EXCEEDED'
  | 'UNSAFE_PATH'
  | 'SYMLINK_REJECTED'
  | 'NESTED_ARCHIVE_REJECTED'
  | 'WEB_CRYPTO_UNAVAILABLE'
  | 'DECOMPRESS_FAILED';

export interface IngestFailure {
  code: IngestErrorCode;
  title: string;
  detail: string;
  offendingPath?: string;
}

export interface IngestResult {
  archiveName: string;
  zippedBytes: number;
  uncompressedBytes: number;
  fileCount: number;
  directoryCount: number;
  compressionRatio: number;
  maxDepth: number;
  nestedArchivePolicy: NestedArchivePolicy;
  originalBufferCopy: ArrayBuffer;
  rawEntriesByPath: Record<string, Uint8Array>;
  fileTree: FileTreeNode[];
  manifest: ManifestEntry[];
  textFiles: Record<string, TextFileEntry>;
  skipped: SkippedEntry[];
  secretFindings: SecretFinding[];
  flaggedPaths: string[];
  ingestedAt: string;
}

export interface LanguageStat {
  language: string;
  fileCount: number;
  percentage: number;
  extensions: string[];
}

export interface DependencyRecord {
  name: string;
  version: string;
  scope: 'runtime' | 'dev';
  sourceFile: string;
}

export interface ProjectHygieneSignals {
  hasTests: boolean;
  testPaths: string[];
  hasCI: boolean;
  ciPaths: string[];
  hasLockfile: boolean;
  lockfilePaths: string[];
  hasReadme: boolean;
  readmePaths: string[];
  hasLicense: boolean;
  licensePaths: string[];
  hasEnvExample: boolean;
  envExamplePaths: string[];
}

export interface DeterministicAnalysis {
  analyzedAt: string;
  analyzableFileCount: number;
  languages: LanguageStat[];
  primaryLanguage: string | null;
  packageManagers: string[];
  entryPoints: string[];
  manifestFiles: string[];
  configFiles: string[];
  dependencies: DependencyRecord[];
  frameworks: string[];
  bundlers: string[];
  hygiene: ProjectHygieneSignals;
  assetExtensionsPresent: string[];
  codePatternsMatched: string[];
  packageJsonScripts: Record<string, string>;
  detectedInstallScripts: Array<{ file: string; scriptName: string; command: string }>;
}

export interface AnalysisStageState {
  status: 'pending' | 'ready';
  result: DeterministicAnalysis | null;
}

export type ProfileId = 'browser-game-2d' | 'web-page' | 'api-service';

export type EvidenceSignalType =
  | 'dependencies'
  | 'entry_points'
  | 'config_files'
  | 'asset_types'
  | 'code_patterns'
  | 'readme';

export interface ProfileEvidenceItem {
  signal: EvidenceSignalType;
  weightAwarded: number;
  maxWeight: number;
  matchedItems: string[];
  summary: string;
}

export interface RankedProfileScore {
  profileId: ProfileId;
  name: string;
  description: string;
  confidence: number;
  rawScore: number;
  maxPossibleScore: number;
  evidence: ProfileEvidenceItem[];
}

export interface GeminiIntentAdvice {
  recommendedProfileId: ProfileId;
  confidence: number;
  reasoning: string;
  suggestedModifiers: string[];
  cautionNotes: string[];
  model: string;
  promptVersion?: string;
}

export interface IntentContradiction {
  detected: boolean;
  lockedProfileId: ProfileId;
  suggestedProfileId: ProfileId;
  suggestedConfidence: number;
  reason: string;
  dismissed: boolean;
}

export interface IntentLockStageState {
  status: 'pending' | 'needs-confirmation' | 'locked';
  rankedProfiles: RankedProfileScore[];
  autoLockEligible: boolean;
  autoLockReason: string;
  projectKind: ProfileId | null;
  modifiers: string[];
  suggestedModifiers: string[];
  lockSource: 'auto' | 'gemini-confirmed' | 'user-override' | null;
  lockedByUser: boolean;
  lockedAt: string | null;
  geminiStatus: 'idle' | 'loading' | 'ready' | 'skipped' | 'error';
  geminiAdvice: GeminiIntentAdvice | null;
  geminiError: string | null;
  geminiSkipReason: string | null;
  geminiPromptVersion: string | null;
  geminiCacheHit: boolean;
  geminiRejected: boolean;
  contradiction: IntentContradiction | null;
}

export type FindingOrigin = 'profile-checklist' | 'generic' | 'ai-gap';
export type FindingSeverity = 'high' | 'medium' | 'low';

export interface LicencePolicyRule {
  license: string;
  policy: 'Allow' | 'Warn' | 'Block' | 'Unverified';
  safe_for_saas_backend: string;
  safe_to_inject: string;
  action: string;
}

export interface RegistryEntry {
  id: string;
  name: string;
  package: string;
  registry: 'npm' | 'github' | 'pypi';
  repo_url: string | null;
  category: string;
  profiles: string[];
  tier: 'core' | 'alternative' | 'dev-tools' | 'poor-fit' | 'review' | 'exclude';
  requires: {
    engine?: string;
    build?: string;
    test?: string;
    framework?: string;
  };
  conflicts_with: string[];
  license_stated: string;
  source_batch: string;
  flags: string | null;
  why: string;
  pitfalls: string;
  license_policy: 'Allow' | 'Unverified' | 'Warn' | 'Block';
  proposable_now: boolean;
  verified: {
    license_spdx: string | null;
    latest_version: string | null;
    last_publish: string | null;
    archived: boolean | null;
    verified_on: string | null;
  };
  status: 'unverified' | 'needs-review' | 'excluded' | 'rejected' | 'active' | 'stale' | 'archived';
}

export interface FindingItem {
  id: string;
  checklistId: string | null;
  title: string;
  description: string;
  origin: FindingOrigin;
  severity: FindingSeverity;
  category: string;
  status: 'gap' | 'satisfied';
  evidence: string;
  aiSuggested: boolean;
  promptVersion?: string;
  aiRejected?: boolean;
  linkedProposalId: string | null;
}

export type ProposalSource = 'registry-library' | 'generated' | 'reference-repo';
export type RiskTier = 'A' | 'B' | 'C';

export interface ProposalFileChange {
  path: string;
  action: 'add' | 'modify';
  beforeContent: string | null;
  afterContent: string;
  unifiedDiff: string;
}

export interface ProposalItem {
  id: string;
  findingId: string;
  title: string;
  why: string;
  rationale: string;
  expectedEffect: string;
  source: ProposalSource;
  registryEntryId?: string;
  packageName?: string;
  licence: string;
  licencePolicy: 'Allow' | 'Project-generated';
  riskTier: RiskTier;
  aiSuggested: boolean;
  promptVersion?: string;
  aiRejected?: boolean;
  filesToAddOrChange: ProposalFileChange[];
  targetPaths: string[];
  diffPreview: string;
  approved: boolean;
  unverifiedPackage?: boolean;
  unverifiedPackageNames?: string[];
  securityWarnings?: string[];
}

export interface RegistryExclusionNote {
  entryId: string;
  packageName: string;
  reason: string;
}

export interface GeminiGapSuggestion {
  findingTitle: string;
  findingDescription: string;
  category: string;
  severity: FindingSeverity;
  proposalTitle: string;
  why: string;
  expectedEffect: string;
  riskTier: RiskTier;
  targetPath: string;
  action: 'add' | 'modify';
  suggestedContent: string;
}

export interface FindingsStageState {
  status: 'pending' | 'ready';
  findings: FindingItem[];
  proposals: ProposalItem[];
  eligibleRegistryIds: string[];
  excludedRegistryNotes: RegistryExclusionNote[];
  geminiStatus: 'idle' | 'loading' | 'ready' | 'skipped' | 'error';
  geminiError: string | null;
  geminiSkipReason: string | null;
  geminiModel: string | null;
  geminiPromptVersion: string | null;
  geminiCacheHit: boolean;
}

export interface ApproveStageState {
  status: 'pending' | 'approved';
  approvedProposalIds: string[];
}

export interface AppliedProposalOutcome {
  proposalId: string;
  title: string;
  riskTier: RiskTier;
  source: ProposalSource;
  packageName?: string;
  licence: string;
  status: 'applied' | 'rolled-back';
  reason: string;
  touchedPaths: string[];
  checksRun: string[];
}

export interface ApplyStageState {
  status: 'pending' | 'applied';
  appliedAt: string | null;
  outcomes: AppliedProposalOutcome[];
  appliedProposalIds: string[];
  rolledBackProposalIds: string[];
  addedPaths: string[];
  modifiedPaths: string[];
  workingFiles: Record<string, Uint8Array>;
  workingPermissions: Record<string, number>;
  changelogPath: string | null;
  noticePath: string | null;
}

export interface VerificationCheckDetail {
  id: string;
  level: 'structural' | 'static' | 'secret-scan';
  label: string;
  passed: boolean;
  detail: string;
  affectedPaths: string[];
}

export interface VerifyStageState {
  status: 'pending' | 'complete';
  verifiedAt: string | null;
  structuralPassed: boolean | null;
  staticPassed: boolean | null;
  secretScanPassed: boolean | null;
  buildsAndTestsRun: false;
  honestyNotice: string;
  note: string | null;
  checks: VerificationCheckDetail[];
  outputSha256ByPath: Record<string, string>;
  untouchedVerifiedCount: number;
  untouchedTotalCount: number;
  modifiedVerifiedCount: number;
  addedVerifiedCount: number;
  outputSecretFindings: SecretFinding[];
  newSecretFindings: SecretFinding[];
  outputZipBytes: Uint8Array | null;
}

export interface DownloadStageState {
  status: 'pending' | 'ready';
  outputArchiveName: string | null;
  changelogMarkdown: string | null;
  noticeMarkdown: string | null;
  unifiedPatchDiff: string | null;
  beforeAfterReportMarkdown: string | null;
}

export interface AiCallLogEntry {
  id: string;
  callType: 'intent-classify' | 'gap-analysis';
  promptVersion: string;
  model: string;
  status: 'success' | 'cached' | 'skipped' | 'fallback';
  cacheHit: boolean;
  contentHashKey: string;
  decisionSummary: string;
  skipReason?: string;
  attempts: number;
  timestamp: string;
}

export interface WorkerProgressState {
  active: boolean;
  task: 'ingest' | 'verify' | null;
  phase: string;
  label: string;
  completed: number;
  total: number;
  percent: number;
  currentPath?: string;
}

export interface PipelineSharedState {
  jobId: string;
  aiEnabled: boolean;
  keepSessionOptIn: boolean;
  sessionHydrated: boolean;
  aiRequestBudgetUsed: number;
  aiRequestBudgetLimit: number;
  aiResponseCache: Record<string, unknown>;
  aiUsageLog: AiCallLogEntry[];
  currentStage: PipelineStage;
  highestUnlockedStage: PipelineStage;
  completedStages: PipelineStage[];
  ingestStatus: 'idle' | 'ingesting' | 'ready' | 'error';
  ingestProgress: WorkerProgressState | null;
  nestedArchivePolicy: NestedArchivePolicy;
  ingestError: IngestFailure | null;
  ingest: IngestResult | null;
  analysis: AnalysisStageState;
  intent: IntentLockStageState;
  findings: FindingsStageState;
  approve: ApproveStageState;
  isApplying: boolean;
  apply: ApplyStageState;
  isVerifying: boolean;
  verifyProgress: WorkerProgressState | null;
  verify: VerifyStageState;
  download: DownloadStageState;
}
