import crypto from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const GITHUB_SESSION_COOKIE = 'tether_gh_session';
export const GITHUB_OAUTH_STATE_COOKIE = 'tether_gh_oauth_state';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days
const GITHUB_API_BASE = 'https://api.github.com';

export type GitHubAuthMode = 'oauth' | 'pat';

export interface GitHubSessionPayload {
  token: string;
  mode: GitHubAuthMode;
  createdAt: number;
}

export interface GitHubUserSummary {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GitHubDeployFileInput {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface GitHubDeployResult {
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

export class GitHubApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'github_api_error') {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.code = code;
  }
}

declare global {
  var __tetherGitHubFallbackSecret: string | undefined;
}

function getSessionSecretKey(): Buffer {
  const configured =
    process.env.GITHUB_SESSION_SECRET?.trim() ||
    process.env.GITHUB_CLIENT_SECRET?.trim();

  if (configured) {
    return crypto.createHash('sha256').update(configured).digest();
  }

  if (!globalThis.__tetherGitHubFallbackSecret) {
    globalThis.__tetherGitHubFallbackSecret = crypto.randomBytes(32).toString('hex');
  }
  return crypto
    .createHash('sha256')
    .update(globalThis.__tetherGitHubFallbackSecret)
    .digest();
}

export function sealSessionPayload(payload: GitHubSessionPayload): string {
  const key = getSessionSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function unsealSessionPayload(sealed: string): GitHubSessionPayload | null {
  try {
    const parts = sealed.split('.');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const encrypted = Buffer.from(dataB64, 'base64url');
    const key = getSessionSecretKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted) as GitHubSessionPayload;
    if (!parsed?.token || (parsed.mode !== 'oauth' && parsed.mode !== 'pat')) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function extractGitHubSession(req: NextRequest): GitHubSessionPayload | null {
  const cookieVal = req.cookies.get(GITHUB_SESSION_COOKIE)?.value;
  if (cookieVal) {
    const unsealed = unsealSessionPayload(cookieVal);
    if (unsealed) return unsealed;
  }

  const headerVal = req.headers.get('x-tether-github-session');
  if (headerVal) {
    const unsealed = unsealSessionPayload(headerVal.trim());
    if (unsealed) return unsealed;
  }

  return null;
}

export function setGitHubSessionCookie(res: NextResponse, sealed: string): void {
  res.cookies.set(GITHUB_SESSION_COOKIE, sealed, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearGitHubSessionCookie(res: NextResponse): void {
  res.cookies.set(GITHUB_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 0,
  });
}

export function setOAuthStateCookie(res: NextResponse, state: string): void {
  res.cookies.set(GITHUB_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  });
}

export function clearOAuthStateCookie(res: NextResponse): void {
  res.cookies.set(GITHUB_OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 0,
  });
}

export function getAppBaseUrl(req: NextRequest): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, '');
  }
  return req.nextUrl.origin.replace(/\/+$/, '');
}

export function getGitHubOAuthConfig(req: NextRequest): {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
} {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim() || '';
  const callbackUrl = `${getAppBaseUrl(req)}/auth/callback`;
  return {
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    callbackUrl,
  };
}

export function sanitizeDeployPath(rawPath: string): string | null {
  const normalized = rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();

  if (!normalized || normalized.endsWith('/')) return null;

  const segments = normalized.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) {
    return null;
  }

  // Never deploy local env secrets or .git internals
  const lowerBase = segments[segments.length - 1].toLowerCase();
  if (
    lowerBase === '.env' ||
    (lowerBase.startsWith('.env.') && lowerBase !== '.env.example') ||
    segments[0] === '.git'
  ) {
    return null;
  }

  return segments.join('/');
}

export async function githubApiFetch<T>(
  pathOrUrl: string,
  token: string,
  init: RequestInit = {}
): Promise<{ data: T; headers: Headers }> {
  const url = pathOrUrl.startsWith('https://')
    ? pathOrUrl
    : `${GITHUB_API_BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  headers.set('User-Agent', 'Tether-Workspace/1.0');
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }

  if (!res.ok) {
    const ghMessage =
      typeof parsed === 'object' && parsed && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : `GitHub API error (${res.status})`;

    if (res.status === 401) {
      throw new GitHubApiError(
        'GitHub token is invalid or expired. Reconnect your GitHub account.',
        401,
        'unauthorized'
      );
    }
    if (res.status === 403) {
      throw new GitHubApiError(
        `GitHub rejected the request (403): ${ghMessage}. Ensure your token has Contents read & write permission.`,
        403,
        'forbidden'
      );
    }
    if (res.status === 404) {
      throw new GitHubApiError(
        `Repository or branch not found (${ghMessage}). Check repository access permissions.`,
        404,
        'not_found'
      );
    }
    if (res.status === 409) {
      throw new GitHubApiError(ghMessage, 409, 'conflict');
    }
    if (res.status === 422) {
      throw new GitHubApiError(`GitHub validation failed: ${ghMessage}`, 422, 'validation_failed');
    }

    throw new GitHubApiError(ghMessage, res.status, 'github_error');
  }

  return { data: parsed as T, headers: res.headers };
}

export async function verifyGitHubToken(token: string): Promise<{
  user: GitHubUserSummary;
  scopes: string[];
}> {
  const { data, headers } = await githubApiFetch<{
    login: string;
    name: string | null;
    avatar_url: string;
    html_url: string;
  }>('/user', token);

  const rawScopes = headers.get('x-oauth-scopes') || '';
  const scopes = rawScopes
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    user: {
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      htmlUrl: data.html_url,
    },
    scopes,
  };
}

function encodeBase64PathSegment(val: string): string {
  return encodeURIComponent(val);
}

async function runInBatches<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(slice.map(worker));
    results.push(...batchResults);
  }
  return results;
}

export async function deployFilesToGitHub(params: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  commitMessage: string;
  files: GitHubDeployFileInput[];
  replaceTree?: boolean;
}): Promise<GitHubDeployResult> {
  const { token, owner, repo, branch, commitMessage, files, replaceTree = false } = params;

  const ownerClean = owner.trim();
  const repoClean = repo.trim();
  const branchClean = branch.trim().replace(/^refs\/heads\//, '');

  if (!ownerClean || !repoClean || !branchClean) {
    throw new GitHubApiError('Owner, repository, and target branch are required.', 400, 'invalid_target');
  }

  // Sanitize & deduplicate files by path (last entry wins if duplicate)
  const skippedPaths: string[] = [];
  const fileMap = new Map<string, { path: string; content: string; encoding: 'utf-8' | 'base64' }>();

  for (const file of files) {
    const safePath = sanitizeDeployPath(file.path);
    if (!safePath) {
      skippedPaths.push(file.path);
      continue;
    }
    fileMap.set(safePath, {
      path: safePath,
      content: file.content ?? '',
      encoding: file.encoding === 'base64' ? 'base64' : 'utf-8',
    });
  }

  const normalizedFiles = Array.from(fileMap.values());
  if (normalizedFiles.length === 0) {
    throw new GitHubApiError('No deployable files found after path safety checks.', 400, 'empty_manifest');
  }

  const repoPath = `/repos/${encodeBase64PathSegment(ownerClean)}/${encodeBase64PathSegment(repoClean)}`;

  // 1. Inspect repo metadata
  const { data: repoInfo } = await githubApiFetch<{
    default_branch: string;
    html_url: string;
    has_pages: boolean;
  }>(repoPath, token);

  const defaultBranch = repoInfo.default_branch || 'main';
  let parentCommitSha: string | null = null;
  let baseTreeSha: string | null = null;
  let branchExists = false;

  // 2. Check target branch ref, or fallback to default_branch, or initialize empty repo
  try {
    const { data: targetRef } = await githubApiFetch<{ object: { sha: string } }>(
      `${repoPath}/git/ref/heads/${encodeURIComponent(branchClean)}`,
      token
    );
    parentCommitSha = targetRef.object.sha;
    branchExists = true;
  } catch (err) {
    if (err instanceof GitHubApiError && (err.status === 404 || err.status === 409)) {
      if (branchClean !== defaultBranch) {
        try {
          const { data: defaultRef } = await githubApiFetch<{ object: { sha: string } }>(
            `${repoPath}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
            token
          );
          parentCommitSha = defaultRef.object.sha;
        } catch {
          // Repo is likely uninitialized (0 commits)
        }
      }
    } else {
      throw err;
    }
  }

  // If repository has zero commits yet, bootstrap an initial commit via Contents API
  if (!parentCommitSha) {
    const firstFile = normalizedFiles[0];
    const encodedFirstContent =
      firstFile.encoding === 'base64'
        ? firstFile.content
        : Buffer.from(firstFile.content, 'utf8').toString('base64');

    const { data: initRes } = await githubApiFetch<{
      commit: { sha: string; html_url?: string };
    }>(
      `${repoPath}/contents/${firstFile.path.split('/').map(encodeURIComponent).join('/')}`,
      token,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: commitMessage.trim() || 'Initial deployment from Tether',
          content: encodedFirstContent,
          branch: branchClean,
        }),
      }
    );
    parentCommitSha = initRes.commit.sha;
    branchExists = true;

    if (normalizedFiles.length === 1) {
      const pagesUrl =
        repoInfo.has_pages || branchClean === 'gh-pages'
          ? `https://${ownerClean}.github.io/${repoClean}/`
          : undefined;

      return {
        owner: ownerClean,
        repo: repoClean,
        branch: branchClean,
        commitSha: parentCommitSha,
        commitUrl:
          initRes.commit.html_url ||
          `${repoInfo.html_url}/commit/${parentCommitSha}`,
        repoUrl: repoInfo.html_url,
        filesCommitted: 1,
        skippedPaths,
        pagesUrl,
      };
    }
  }

  // 3. Read parent commit tree SHA
  const { data: parentCommit } = await githubApiFetch<{ tree: { sha: string } }>(
    `${repoPath}/git/commits/${parentCommitSha}`,
    token
  );
  baseTreeSha = parentCommit.tree.sha;

  // 4. Create Git blobs concurrently in controlled batches
  const treeEntries = await runInBatches(normalizedFiles, 6, async (file) => {
    const { data: blob } = await githubApiFetch<{ sha: string }>(
      `${repoPath}/git/blobs`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          content: file.content,
          encoding: file.encoding,
        }),
      }
    );

    return {
      path: file.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: blob.sha,
    };
  });

  // 5. Create new Git Tree (incremental over base_tree unless replaceTree is requested)
  const treePayload: {
    base_tree?: string;
    tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }>;
  } = {
    tree: treeEntries,
  };
  if (!replaceTree && baseTreeSha) {
    treePayload.base_tree = baseTreeSha;
  }

  const { data: createdTree } = await githubApiFetch<{ sha: string }>(
    `${repoPath}/git/trees`,
    token,
    {
      method: 'POST',
      body: JSON.stringify(treePayload),
    }
  );

  // 6. Create Git Commit
  const { data: createdCommit } = await githubApiFetch<{
    sha: string;
    html_url?: string;
  }>(`${repoPath}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message: commitMessage.trim() || 'Deploy workspace from Tether',
      tree: createdTree.sha,
      parents: [parentCommitSha],
    }),
  });

  // 7. Create or Fast-Forward target branch ref
  if (branchExists) {
    await githubApiFetch(`${repoPath}/git/refs/heads/${encodeURIComponent(branchClean)}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: createdCommit.sha,
        force: false,
      }),
    });
  } else {
    await githubApiFetch(`${repoPath}/git/refs`, token, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchClean}`,
        sha: createdCommit.sha,
      }),
    });
  }

  const pagesUrl =
    repoInfo.has_pages || branchClean === 'gh-pages'
      ? `https://${ownerClean}.github.io/${repoClean}/`
      : undefined;

  return {
    owner: ownerClean,
    repo: repoClean,
    branch: branchClean,
    commitSha: createdCommit.sha,
    commitUrl:
      createdCommit.html_url ||
      `${repoInfo.html_url}/commit/${createdCommit.sha}`,
    repoUrl: repoInfo.html_url,
    filesCommitted: normalizedFiles.length,
    skippedPaths,
    pagesUrl,
  };
}
