import { NextRequest, NextResponse } from 'next/server';
import {
  GitHubApiError,
  extractGitHubSession,
  githubApiFetch,
} from '../../../../src/lib/githubServer';

interface RawGitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  updated_at: string;
  has_pages: boolean;
  owner: {
    login: string;
    avatar_url: string;
  };
  permissions?: {
    admin?: boolean;
    push?: boolean;
    pull?: boolean;
  };
}

export async function GET(req: NextRequest) {
  const session = extractGitHubSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Not connected to GitHub.' }, { status: 401 });
  }

  const query = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';

  try {
    const { data } = await githubApiFetch<RawGitHubRepo[]>(
      '/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member',
      session.token
    );

    const repos = data
      .filter((r) => r.permissions?.push !== false)
      .filter(
        (r) =>
          !query ||
          r.full_name.toLowerCase().includes(query) ||
          (r.description || '').toLowerCase().includes(query)
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner.login,
        isPrivate: r.private,
        htmlUrl: r.html_url,
        description: r.description,
        defaultBranch: r.default_branch || 'main',
        updatedAt: r.updated_at,
        hasPages: r.has_pages,
      }));

    return NextResponse.json({ repos });
  } catch (err) {
    const status = err instanceof GitHubApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : 'Failed to list GitHub repositories.';
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  const session = extractGitHubSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Not connected to GitHub.' }, { status: 401 });
  }

  let body: { name?: string; description?: string; isPrivate?: boolean } = {};
  try {
    body = (await req.json()) as { name?: string; description?: string; isPrivate?: boolean };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
    return NextResponse.json(
      { error: 'Repository name must use only letters, numbers, dots, underscores, or hyphens.' },
      { status: 400 }
    );
  }

  try {
    const { data: created } = await githubApiFetch<RawGitHubRepo>(
      '/user/repos',
      session.token,
      {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: (body.description || '').trim() || 'Deployed from Tether Workspace',
          private: Boolean(body.isPrivate),
          auto_init: true,
        }),
      }
    );

    return NextResponse.json({
      repo: {
        id: created.id,
        name: created.name,
        fullName: created.full_name,
        owner: created.owner.login,
        isPrivate: created.private,
        htmlUrl: created.html_url,
        description: created.description,
        defaultBranch: created.default_branch || 'main',
        updatedAt: created.updated_at,
        hasPages: created.has_pages,
      },
    });
  } catch (err) {
    const status = err instanceof GitHubApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : 'Failed to create repository.';
    return NextResponse.json({ error: message }, { status });
  }
}
