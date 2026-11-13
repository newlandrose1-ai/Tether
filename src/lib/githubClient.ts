import type {
  Block,
  CodeBlockData,
  FileBlockData,
  GitHubDeployMode,
  Project,
  Tether,
  TextBlockData,
} from '../types/model';
import {
  extractProjectExportFiles,
  generateStandaloneWebHtml,
} from './webHtmlExport';

const SEALED_SESSION_STORAGE_KEY = 'tether:gh_sealed_session';

export interface GitHubSessionInfo {
  connected: boolean;
  mode: 'oauth' | 'pat' | null;
  user: {
    login: string;
    name: string | null;
    avatarUrl: string;
    htmlUrl: string;
  } | null;
  scopes: string[];
  oauthConfigured: boolean;
  callbackUrl: string;
  error?: string;
}

export interface GitHubRepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  isPrivate: boolean;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  updatedAt: string;
  hasPages: boolean;
}

export interface GitHubBranchSummary {
  name: string;
  isProtected: boolean;
}

export interface GitHubDeployManifestFile {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  byteSize: number;
  generated?: boolean;
}

export interface GitHubDeployManifest {
  files: GitHubDeployManifestFile[];
  skippedPaths: Array<{ path: string; reason: string }>;
  totalBytes: number;
}

export interface GitHubDeployReceipt {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  commitUrl: string;
  repoUrl: string;
  filesCommitted: number;
  skippedPaths: string[];
  pagesUrl?: string;
}

export function saveClientSealedSession(sealed: string | undefined | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (sealed) {
      window.sessionStorage.setItem(SEALED_SESSION_STORAGE_KEY, sealed);
    } else {
      window.sessionStorage.removeItem(SEALED_SESSION_STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable
  }
}

export function getClientSealedSession(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(SEALED_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function buildAuthHeaders(extra?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = { ...(extra || {}) };
  const sealed = getClientSealedSession();
  if (sealed) {
    headers['X-Tether-GitHub-Session'] = sealed;
  }
  return headers;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }
  if (!res.ok) {
    const errMsg =
      typeof parsed === 'object' && parsed && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return parsed as T;
}

export async function fetchGitHubSession(): Promise<GitHubSessionInfo> {
  const res = await fetch('/api/github/session', {
    method: 'GET',
    headers: buildAuthHeaders(),
    cache: 'no-store',
  });
  const data = await parseJsonResponse<GitHubSessionInfo>(res);
  if (!data.connected) {
    saveClientSealedSession(null);
  }
  return data;
}

export async function fetchGitHubOAuthUrl(): Promise<{
  configured: boolean;
  url: string | null;
  callbackUrl: string;
}> {
  const res = await fetch('/api/github/auth/url', {
    method: 'GET',
    cache: 'no-store',
  });
  return parseJsonResponse(res);
}

export async function connectGitHubWithToken(
  token: string
): Promise<GitHubSessionInfo & { sealedSession?: string }> {
  const res = await fetch('/api/github/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await parseJsonResponse<GitHubSessionInfo & { sealedSession?: string }>(res);
  if (data.sealedSession) {
    saveClientSealedSession(data.sealedSession);
  }
  return data;
}

export async function disconnectGitHub(): Promise<void> {
  saveClientSealedSession(null);
  await fetch('/api/github/session', {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  });
}

export async function fetchGitHubRepos(query = ''): Promise<GitHubRepoSummary[]> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const res = await fetch(`/api/github/repos${qs}`, {
    method: 'GET',
    headers: buildAuthHeaders(),
    cache: 'no-store',
  });
  const data = await parseJsonResponse<{ repos: GitHubRepoSummary[] }>(res);
  return data.repos;
}

export async function createGitHubRepo(input: {
  name: string;
  description?: string;
  isPrivate: boolean;
}): Promise<GitHubRepoSummary> {
  const res = await fetch('/api/github/repos', {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ repo: GitHubRepoSummary }>(res);
  return data.repo;
}

export async function fetchGitHubRepoBranches(
  owner: string,
  repo: string
): Promise<{
  defaultBranch: string;
  htmlUrl: string;
  hasPages: boolean;
  isPrivate: boolean;
  branches: GitHubBranchSummary[];
}> {
  const res = await fetch(
    `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    {
      method: 'GET',
      headers: buildAuthHeaders(),
      cache: 'no-store',
    }
  );
  return parseJsonResponse(res);
}

export async function deployManifestToGitHub(payload: {
  owner: string;
  repo: string;
  branch: string;
  commitMessage: string;
  replaceTree?: boolean;
  files: Array<{ path: string; content: string; encoding: 'utf-8' | 'base64' }>;
}): Promise<GitHubDeployReceipt> {
  const res = await fetch('/api/github/deploy', {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<GitHubDeployReceipt>(res);
}

function normalizeClientPath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();
}

function isSensitiveEnvPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) return true;
  if (segments[0] === '.git') return true;
  const base = segments[segments.length - 1].toLowerCase();
  return base === '.env' || (base.startsWith('.env.') && base !== '.env.example');
}

function estimateBase64Bytes(base64: string): number {
  const cleaned = base64.replace(/=+$/, '');
  return Math.floor((cleaned.length * 3) / 4);
}

export function buildGitHubDeployManifest(params: {
  project: Project;
  blocks: Block[];
  tethers: Tether[];
  deployMode: GitHubDeployMode;
  groupId?: string | null;
}): GitHubDeployManifest {
  const { project, blocks, tethers, deployMode, groupId } = params;

  const scopedBlocks = blocks.filter(
    (b) =>
      b.projectId === project.id &&
      b.kind !== 'upload' &&
      (!groupId || b.groupId === groupId)
  );

  const fileMap = new Map<string, GitHubDeployManifestFile>();
  const skippedPaths: Array<{ path: string; reason: string }> = [];

  for (const b of scopedBlocks) {
    let rawPath = b.sourcePath || b.title;
    let content = '';
    let encoding: 'utf-8' | 'base64' = 'utf-8';
    let byteSize = 0;

    if (b.kind === 'code') {
      const data = b.data as CodeBlockData;
      rawPath = data?.path || b.sourcePath || b.title;
      content = data?.currentContent ?? '';
      byteSize = new Blob([content]).size;
    } else if (b.kind === 'text') {
      const data = b.data as TextBlockData;
      rawPath = b.sourcePath || (/\.(md|txt|markdown)$/i.test(b.title) ? b.title : `${b.title}.md`);
      content = data?.content ?? '';
      byteSize = new Blob([content]).size;
    } else if (b.kind === 'file') {
      const data = b.data as FileBlockData;
      rawPath = data?.path || b.sourcePath || b.title;

      if (data?.binary) {
        if (data.dataUrl && data.dataUrl.includes(',')) {
          const base64Part = data.dataUrl.slice(data.dataUrl.indexOf(',') + 1);
          content = base64Part;
          encoding = 'base64';
          byteSize = data.size || estimateBase64Bytes(base64Part);
        } else {
          skippedPaths.push({
            path: normalizeClientPath(rawPath) || b.title,
            reason: 'Binary asset has no in-memory data payload',
          });
          continue;
        }
      } else {
        content = data?.content ?? '';
        byteSize = new Blob([content]).size;
      }
    }

    const safePath = normalizeClientPath(rawPath);
    if (!safePath || isSensitiveEnvPath(safePath)) {
      skippedPaths.push({
        path: safePath || b.title,
        reason: 'Excluded local environment secret or invalid path',
      });
      continue;
    }

    fileMap.set(safePath, {
      path: safePath,
      content,
      encoding,
      byteSize,
    });
  }

  if (deployMode === 'web-html' || deployMode === 'source-and-web') {
    const exportFiles = extractProjectExportFiles(project, scopedBlocks);
    const html = generateStandaloneWebHtml(project, exportFiles, tethers);
    const htmlBytes = new Blob([html]).size;

    if (deployMode === 'web-html') {
      fileMap.set('index.html', {
        path: 'index.html',
        content: html,
        encoding: 'utf-8',
        byteSize: htmlBytes,
        generated: true,
      });
    } else {
      const explorerPath = fileMap.has('index.html')
        ? 'tether-explorer.html'
        : 'index.html';
      fileMap.set(explorerPath, {
        path: explorerPath,
        content: html,
        encoding: 'utf-8',
        byteSize: htmlBytes,
        generated: true,
      });
    }

    fileMap.set('.nojekyll', {
      path: '.nojekyll',
      content: '',
      encoding: 'utf-8',
      byteSize: 0,
      generated: true,
    });
  }

  const files = Array.from(fileMap.values()).sort((a, b) =>
    a.path.localeCompare(b.path)
  );
  const totalBytes = files.reduce((acc, f) => acc + f.byteSize, 0);

  return {
    files,
    skippedPaths,
    totalBytes,
  };
}
