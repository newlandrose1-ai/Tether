import { NextRequest, NextResponse } from 'next/server';
import {
  GitHubApiError,
  extractGitHubSession,
  githubApiFetch,
} from '../../../../../../../src/lib/githubServer';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ owner: string; repo: string }> }
) {
  const session = extractGitHubSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Not connected to GitHub.' }, { status: 401 });
  }

  const { owner, repo } = await context.params;
  if (!owner || !repo) {
    return NextResponse.json({ error: 'Owner and repository are required.' }, { status: 400 });
  }

  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  try {
    const [repoRes, branchesRes] = await Promise.all([
      githubApiFetch<{
        default_branch: string;
        html_url: string;
        has_pages: boolean;
        private: boolean;
      }>(repoPath, session.token),
      githubApiFetch<Array<{ name: string; protected: boolean }>>(
        `${repoPath}/branches?per_page=100`,
        session.token
      ),
    ]);

    return NextResponse.json({
      defaultBranch: repoRes.data.default_branch || 'main',
      htmlUrl: repoRes.data.html_url,
      hasPages: repoRes.data.has_pages,
      isPrivate: repoRes.data.private,
      branches: branchesRes.data.map((b) => ({
        name: b.name,
        isProtected: Boolean(b.protected),
      })),
    });
  } catch (err) {
    const status = err instanceof GitHubApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : 'Failed to load repository branches.';
    return NextResponse.json({ error: message }, { status });
  }
}
