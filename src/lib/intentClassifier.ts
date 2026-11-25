import profilesData from '../data/profiles.json';
import {
  INTENT_PROMPT_VERSION,
  validateIntentSchemaWithReason,
} from '../ai/prompts/intentClassification';
import { chunkRankedFilesForBudget } from './aiChunking';
import {
  MAX_GEMINI_PAYLOAD_CHARS,
  enforceJsonPayloadCharLimit,
  stripUnsafeControlAndBidiChars,
} from './securityGuards';
import type {
  DeterministicAnalysis,
  EvidenceSignalType,
  GeminiIntentAdvice,
  IngestResult,
  IntentContradiction,
  ProfileEvidenceItem,
  ProfileId,
  RankedProfileScore,
} from '../types/pipeline';

interface ProfileDefinition {
  id: ProfileId;
  name: string;
  description: string;
  evidence_rules: {
    dependencies: string[];
    entry_points: string[];
    config_files: string[];
    asset_extensions: string[];
    asset_dirs: string[];
    code_patterns: string[];
    readme_keywords: string[];
  };
}

interface ModifierDefinition {
  id: string;
  name: string;
  description: string;
}

const SIGNAL_WEIGHTS: Record<EvidenceSignalType, number> = {
  dependencies: 40,
  entry_points: 22,
  config_files: 14,
  asset_types: 10,
  code_patterns: 10,
  readme: 4,
};

export function getLoadedProfiles(): ProfileDefinition[] {
  return profilesData.profiles as ProfileDefinition[];
}

export function getLoadedModifiers(): ModifierDefinition[] {
  return profilesData.modifiers as ModifierDefinition[];
}

function getBaseName(path: string): string {
  return (path.split('/').pop() ?? path).toLowerCase();
}

function hasCanvasInHtml(ingest: IngestResult): boolean {
  for (const [path, entry] of Object.entries(ingest.textFiles)) {
    if (getBaseName(path).endsWith('.html') && /<canvas\b/i.test(entry.content)) {
      return true;
    }
  }
  return false;
}

function isBrowserExtensionManifest(ingest: IngestResult): boolean {
  for (const [path, entry] of Object.entries(ingest.textFiles)) {
    if (getBaseName(path) === 'manifest.json') {
      try {
        const parsed = JSON.parse(entry.content) as Record<string, unknown>;
        if ('manifest_version' in parsed) return true;
      } catch {
        // ignore invalid json here
      }
    }
  }
  return false;
}

function isPwaManifestOrSw(ingest: IngestResult, depSet: Set<string>): boolean {
  if (depSet.has('vite-plugin-pwa') || depSet.has('workbox-window')) return true;
  for (const entry of ingest.manifest) {
    const base = getBaseName(entry.path);
    if (base === 'sw.js' || base === 'service-worker.js' || base === 'manifest.webmanifest') {
      return true;
    }
  }
  for (const [path, entry] of Object.entries(ingest.textFiles)) {
    if (getBaseName(path) === 'manifest.json') {
      try {
        const parsed = JSON.parse(entry.content) as Record<string, unknown>;
        if (!('manifest_version' in parsed) && ('short_name' in parsed || 'display' in parsed || 'start_url' in parsed)) {
          return true;
        }
      } catch {
        // ignore
      }
    }
  }
  return false;
}

export function detectSuggestedModifiers(
  ingest: IngestResult,
  analysis: DeterministicAnalysis
): string[] {
  const depSet = new Set(analysis.dependencies.map((d) => d.name.toLowerCase()));
  const modifiers: string[] = [];

  if (isPwaManifestOrSw(ingest, depSet)) {
    modifiers.push('pwa');
  }
  if (
    analysis.languages.some((l) => l.language === 'TypeScript') ||
    analysis.configFiles.some((p) => getBaseName(p) === 'tsconfig.json')
  ) {
    modifiers.push('typescript');
  }
  if (
    analysis.configFiles.some((p) => getBaseName(p) === 'dockerfile' || getBaseName(p).startsWith('docker-compose'))
  ) {
    modifiers.push('docker');
  }

  return modifiers;
}

function scoreProfile(
  profile: ProfileDefinition,
  ingest: IngestResult,
  analysis: DeterministicAnalysis
): RankedProfileScore {
  const rules = profile.evidence_rules;
  const depNames = new Set(analysis.dependencies.map((d) => d.name.toLowerCase()));
  const nonIgnoredPaths = ingest.manifest
    .filter((m) => m.analysisStatus !== 'ignored-dir' && m.analysisStatus !== 'build-output')
    .map((m) => m.path);
  const nonIgnoredLower = nonIgnoredPaths.map((p) => p.toLowerCase());
  const nonIgnoredBases = new Set(nonIgnoredLower.map((p) => getBaseName(p)));

  const hasApiDeps = ['express', 'fastify', 'hono', '@nestjs/core', 'fastapi', 'flask', 'django'].some((d) =>
    depNames.has(d)
  );
  const hasGameDeps = ['phaser', 'pixi.js', 'pixijs', 'kaplay', 'kaboom', 'littlejsengine', 'pygame'].some((d) =>
    depNames.has(d)
  );
  const htmlHasCanvas = hasCanvasInHtml(ingest);
  const browserExt = isBrowserExtensionManifest(ingest);

  // 1. Dependencies (40 max)
  const matchedDeps = rules.dependencies.filter((d) => depNames.has(d.toLowerCase()));
  let depPoints = 0;
  if (matchedDeps.length >= 2) depPoints = 40;
  else if (matchedDeps.length === 1) depPoints = 32;
  else if (profile.id === 'web-page' && !hasApiDeps && !hasGameDeps && nonIgnoredBases.has('index.html')) {
    // Plain static HTML/CSS site with no server or game dependencies
    depPoints = 20;
  }

  // 2. Entry points / structure (22 max)
  const matchedEntries = new Set<string>();
  for (const ep of rules.entry_points) {
    const epLower = ep.toLowerCase();
    for (const p of nonIgnoredLower) {
      if (p === epLower || p.endsWith(`/${epLower}`) || getBaseName(p) === epLower) {
        matchedEntries.add(ep);
      }
    }
  }
  let entryPoints = 0;
  if (profile.id === 'browser-game-2d') {
    if (matchedEntries.has('project.godot')) entryPoints = 22;
    else if (matchedEntries.has('index.html') && htmlHasCanvas) entryPoints = 22;
    else if (matchedEntries.has('index.html') && hasGameDeps) entryPoints = 18;
    else if (matchedEntries.has('index.html')) entryPoints = 5;
  } else if (profile.id === 'web-page') {
    if (matchedEntries.size > 0 && !hasApiDeps && !htmlHasCanvas) entryPoints = 22;
    else if (matchedEntries.size > 0 && !hasApiDeps) entryPoints = 12;
  } else if (profile.id === 'api-service') {
    if (matchedEntries.size >= 2) entryPoints = 22;
    else if (matchedEntries.size === 1) entryPoints = 16;
  }

  // 3. Config files (14 max)
  const matchedConfigs = new Set<string>();
  for (const cfg of rules.config_files) {
    const cfgLower = cfg.toLowerCase();
    if (nonIgnoredBases.has(cfgLower)) {
      if (profile.id === 'web-page' && cfgLower === 'manifest.json' && browserExt) {
        continue;
      }
      matchedConfigs.add(cfg);
    }
  }
  const configPoints =
    matchedConfigs.size >= 2 ? 14 : matchedConfigs.size === 1 ? (profile.id === 'browser-game-2d' && matchedConfigs.has('project.godot') ? 14 : 10) : 0;

  // 4. Asset types / directories (10 max)
  const matchedAssets = new Set<string>();
  for (const ext of rules.asset_extensions) {
    if (analysis.assetExtensionsPresent.includes(ext)) {
      matchedAssets.add(ext);
    }
  }
  for (const dir of rules.asset_dirs) {
    const token = `/${dir.toLowerCase()}/`;
    if (nonIgnoredLower.some((p) => p.startsWith(`${dir.toLowerCase()}/`) || p.includes(token))) {
      matchedAssets.add(`${dir}/`);
    }
  }
  const assetPoints = matchedAssets.size >= 2 ? 10 : matchedAssets.size === 1 ? 6 : 0;

  // 5. Code patterns (10 max)
  const matchedPatterns = rules.code_patterns.filter((pat) =>
    analysis.codePatternsMatched.includes(pat)
  );
  if (profile.id === 'browser-game-2d' && htmlHasCanvas) {
    matchedPatterns.push('<canvas>');
  }
  const patternPoints =
    matchedPatterns.length >= 2 ? 10 : matchedPatterns.length === 1 ? 6 : 0;

  // 6. README / filename keywords (4 max - weak tiebreaker only)
  const matchedReadmeKeywords = new Set<string>();
  const readmeTexts = analysis.hygiene.readmePaths
    .map((p) => ingest.textFiles[p]?.content ?? '')
    .join('\n')
    .toLowerCase();
  const archiveNameLower = ingest.archiveName.toLowerCase();

  for (const kw of rules.readme_keywords) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(readmeTexts) || archiveNameLower.includes(kw)) {
      matchedReadmeKeywords.add(kw);
    }
  }
  const readmePoints = matchedReadmeKeywords.size >= 2 ? 4 : matchedReadmeKeywords.size === 1 ? 2 : 0;

  const evidence: ProfileEvidenceItem[] = [
    {
      signal: 'dependencies',
      weightAwarded: depPoints,
      maxWeight: SIGNAL_WEIGHTS.dependencies,
      matchedItems: matchedDeps,
      summary:
        matchedDeps.length > 0
          ? `Matched dependencies: ${matchedDeps.join(', ')}`
          : depPoints > 0
          ? 'No server or game framework dependencies; static web baseline'
          : 'No profile-specific dependencies detected',
    },
    {
      signal: 'entry_points',
      weightAwarded: entryPoints,
      maxWeight: SIGNAL_WEIGHTS.entry_points,
      matchedItems: Array.from(matchedEntries),
      summary:
        matchedEntries.size > 0
          ? `Matched entry points: ${Array.from(matchedEntries).join(', ')}`
          : 'No profile-specific entry points matched',
    },
    {
      signal: 'config_files',
      weightAwarded: configPoints,
      maxWeight: SIGNAL_WEIGHTS.config_files,
      matchedItems: Array.from(matchedConfigs),
      summary:
        matchedConfigs.size > 0
          ? `Matched config files: ${Array.from(matchedConfigs).join(', ')}`
          : 'No profile-specific config files matched',
    },
    {
      signal: 'asset_types',
      weightAwarded: assetPoints,
      maxWeight: SIGNAL_WEIGHTS.asset_types,
      matchedItems: Array.from(matchedAssets),
      summary:
        matchedAssets.size > 0
          ? `Matched assets/directories: ${Array.from(matchedAssets).join(', ')}`
          : 'No profile-specific asset patterns matched',
    },
    {
      signal: 'code_patterns',
      weightAwarded: patternPoints,
      maxWeight: SIGNAL_WEIGHTS.code_patterns,
      matchedItems: matchedPatterns,
      summary:
        matchedPatterns.length > 0
          ? `Matched code patterns: ${matchedPatterns.join(', ')}`
          : 'No profile-specific code patterns matched',
    },
    {
      signal: 'readme',
      weightAwarded: readmePoints,
      maxWeight: SIGNAL_WEIGHTS.readme,
      matchedItems: Array.from(matchedReadmeKeywords),
      summary:
        matchedReadmeKeywords.size > 0
          ? `README/name tiebreaker keywords: ${Array.from(matchedReadmeKeywords).join(', ')}`
          : 'No README/filename tiebreaker keywords matched',
    },
  ];

  const rawScore = evidence.reduce((sum, item) => sum + item.weightAwarded, 0);
  const maxPossibleScore = 100;
  const confidence = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    profileId: profile.id,
    name: profile.name,
    description: profile.description,
    confidence,
    rawScore,
    maxPossibleScore,
    evidence,
  };
}

export function classifyProjectIntent(
  ingest: IngestResult,
  analysis: DeterministicAnalysis
): {
  rankedProfiles: RankedProfileScore[];
  autoLockEligible: boolean;
  autoLockReason: string;
  suggestedModifiers: string[];
} {
  const profiles = getLoadedProfiles();
  const rankedProfiles = profiles
    .map((profile) => scoreProfile(profile, ingest, analysis))
    .sort((a, b) => b.confidence - a.confidence || a.profileId.localeCompare(b.profileId));

  const top = rankedProfiles[0];
  const second = rankedProfiles[1];
  const leadMargin = top && second ? top.confidence - second.confidence : top?.confidence ?? 0;

  // Rule: 80%+ and a clear lead (>= 15 points over runner-up) => auto-lock
  const autoLockEligible = Boolean(top && top.confidence >= 80 && leadMargin >= 15);

  let autoLockReason = '';
  if (autoLockEligible && top) {
    autoLockReason = `Auto-locked ${top.name} at ${top.confidence}% confidence (${leadMargin} point lead over ${second?.name ?? 'runner-up'}).`;
  } else if (top && top.confidence >= 80) {
    autoLockReason = `Top score ${top.name} (${top.confidence}%) does not have a clear lead (${leadMargin} pt margin). Asking Gemini & confirming with you.`;
  } else if (top) {
    autoLockReason = `Top score ${top.name} is ${top.confidence}% (< 80% auto-lock threshold). Asking Gemini & confirming with you.`;
  } else {
    autoLockReason = 'No profile rules matched; user selection required.';
  }

  return {
    rankedProfiles,
    autoLockEligible,
    autoLockReason,
    suggestedModifiers: detectSuggestedModifiers(ingest, analysis),
  };
}

export function buildSanitizedIntentPayload(
  ingest: IngestResult,
  analysis: DeterministicAnalysis,
  rankedProfiles: RankedProfileScore[],
  suggestedModifiers: string[]
) {
  const chunked = chunkRankedFilesForBudget(ingest, analysis, {
    promptVersion: INTENT_PROMPT_VERSION,
    maxBlockBudgetChars: 4_800,
    chunkSizeChars: 700,
    maxChunksPerFile: 2,
    maxFiles: 6,
  });

  const fileBlocks = chunked.fileBlocks.map((b) => ({
    path: b.path,
    importance: b.importance,
    block: b.block,
  }));

  const rawPayload = {
    promptVersion: INTENT_PROMPT_VERSION,
    contentHashKey: chunked.contentHashKey,
    archiveName: stripUnsafeControlAndBidiChars(ingest.archiveName, false),
    languages: analysis.languages.slice(0, 8),
    packageManagers: analysis.packageManagers,
    entryPoints: analysis.entryPoints.slice(0, 20),
    configFiles: analysis.configFiles.slice(0, 20),
    dependencies: analysis.dependencies.slice(0, 40).map((d) => `${d.name} (${d.scope})`),
    frameworks: analysis.frameworks,
    bundlers: analysis.bundlers,
    hygiene: {
      hasTests: analysis.hygiene.hasTests,
      hasCI: analysis.hygiene.hasCI,
      hasLockfile: analysis.hygiene.hasLockfile,
      hasReadme: analysis.hygiene.hasReadme,
      hasLicense: analysis.hygiene.hasLicense,
      hasEnvExample: analysis.hygiene.hasEnvExample,
    },
    assetExtensionsPresent: analysis.assetExtensionsPresent,
    codePatternsMatched: analysis.codePatternsMatched,
    suggestedModifiers,
    strippedSecretFilesCount: chunked.strippedSecretFilesCount,
    chunkedFileCount: chunked.chunkedFileCount,
    includedPaths: chunked.includedPaths,
    fileBlocks,
    rankedCandidates: rankedProfiles.map((r) => ({
      profileId: r.profileId,
      name: r.name,
      confidence: r.confidence,
      evidence: r.evidence
        .filter((e) => e.weightAwarded > 0)
        .map((e) => `${e.signal} (+${e.weightAwarded}): ${e.summary}`),
    })),
  };

  return enforceJsonPayloadCharLimit(rawPayload, MAX_GEMINI_PAYLOAD_CHARS).payload;
}

export function getIntentAiPreview(
  ingest: IngestResult,
  analysis: DeterministicAnalysis,
  rankedProfiles: RankedProfileScore[],
  suggestedModifiers: string[]
) {
  const payload = buildSanitizedIntentPayload(
    ingest,
    analysis,
    rankedProfiles,
    suggestedModifiers
  );
  const previewText = JSON.stringify(payload, null, 2);
  return {
    payload,
    fileCount: payload.includedPaths.length,
    strippedCount: payload.strippedSecretFilesCount,
    charCount: JSON.stringify(payload).length,
    maxChars: MAX_GEMINI_PAYLOAD_CHARS,
    promptVersion: payload.promptVersion,
    contentHashKey: payload.contentHashKey,
    previewText,
  };
}

export function validateGeminiIntentAdvice(
  raw: unknown,
  model: string
): GeminiIntentAdvice | null {
  const checked = validateIntentSchemaWithReason(raw);
  if (!checked.ok) return null;
  return {
    ...checked.data,
    model,
    promptVersion: INTENT_PROMPT_VERSION,
  };
}

export function detectIntentContradiction(
  lockedProfileId: ProfileId | null,
  rankedProfiles: RankedProfileScore[],
  analysis: DeterministicAnalysis
): IntentContradiction | null {
  if (!lockedProfileId || rankedProfiles.length === 0) return null;

  const top = rankedProfiles[0];
  const lockedScore = rankedProfiles.find((r) => r.profileId === lockedProfileId);
  if (!top || !lockedScore) return null;

  if (top.profileId === lockedProfileId) return null;

  const margin = top.confidence - lockedScore.confidence;
  const depSet = new Set(analysis.dependencies.map((d) => d.name.toLowerCase()));

  const strongApiEvidence = ['express', 'fastify', 'hono', '@nestjs/core', 'fastapi', 'flask', 'django'].some((d) =>
    depSet.has(d)
  );
  const strongGameEvidence = ['phaser', 'pixi.js', 'pixijs', 'kaplay', 'kaboom', 'littlejsengine', 'pygame'].some((d) =>
    depSet.has(d)
  );

  let contradictionReason = '';
  if (top.confidence >= 60 && margin >= 20) {
    contradictionReason = `Locked profile "${lockedScore.name}" scored ${lockedScore.confidence}%, while "${top.name}" scored ${top.confidence}% (+${margin} pts) based on detected project signals.`;
  } else if (lockedProfileId === 'web-page' && strongApiEvidence) {
    contradictionReason = `Locked profile is Web Page / SPA, but backend API dependencies (${analysis.frameworks.join(', ')}) were detected.`;
  } else if (lockedProfileId === 'api-service' && strongGameEvidence) {
    contradictionReason = `Locked profile is API / Backend Service, but 2D game engine dependencies (${analysis.frameworks.join(', ')}) were detected.`;
  } else if (lockedProfileId === 'browser-game-2d' && strongApiEvidence && !strongGameEvidence) {
    contradictionReason = `Locked profile is Browser Game (2D), but backend API dependencies were detected with no game engine signals.`;
  }

  if (!contradictionReason) return null;

  return {
    detected: true,
    lockedProfileId,
    suggestedProfileId: top.profileId,
    suggestedConfidence: top.confidence,
    reason: contradictionReason,
    dismissed: false,
  };
}
