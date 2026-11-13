import { NextRequest, NextResponse } from 'next/server';
import {
  GitHubApiError,
  clearGitHubSessionCookie,
  extractGitHubSession,
  getGitHubOAuthConfig,
  sealSessionPayload,
  setGitHubSessionCookie,
  verifyGitHubToken,
} from '../../../../src/lib/githubServer';

export async function GET(req: NextRequest) {
  const oauthConfig = getGitHubOAuthConfig(req);
  const session = extractGitHubSession(req);

  if (!session) {
    return NextResponse.json({
      connected: false,
      mode: null,
      user: null,
      scopes: [],
      oauthConfigured: oauthConfig.configured,
      callbackUrl: oauthConfig.callbackUrl,
    });
  }

  try {
    const { user, scopes } = await verifyGitHubToken(session.token);
    return NextResponse.json({
      connected: true,
      mode: session.mode,
      user,
      scopes,
      oauthConfigured: oauthConfig.configured,
      callbackUrl: oauthConfig.callbackUrl,
    });
  } catch (err) {
    const res = NextResponse.json({
      connected: false,
      mode: null,
      user: null,
      scopes: [],
      oauthConfigured: oauthConfig.configured,
      callbackUrl: oauthConfig.callbackUrl,
      error: err instanceof GitHubApiError ? err.message : 'Session expired or invalid.',
    });
    clearGitHubSessionCookie(res);
    return res;
  }
}

export async function POST(req: NextRequest) {
  const oauthConfig = getGitHubOAuthConfig(req);
  let body: { token?: string } = {};
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const rawToken = typeof body.token === 'string' ? body.token.trim() : '';
  if (!rawToken) {
    return NextResponse.json(
      { error: 'Please paste a valid GitHub Personal Access Token.' },
      { status: 400 }
    );
  }

  try {
    const { user, scopes } = await verifyGitHubToken(rawToken);
    const sealed = sealSessionPayload({
      token: rawToken,
      mode: 'pat',
      createdAt: Date.now(),
    });

    const res = NextResponse.json({
      connected: true,
      mode: 'pat' as const,
      user,
      scopes,
      oauthConfigured: oauthConfig.configured,
      callbackUrl: oauthConfig.callbackUrl,
      sealedSession: sealed,
    });
    setGitHubSessionCookie(res, sealed);
    return res;
  } catch (err) {
    const status = err instanceof GitHubApiError ? err.status : 401;
    const message =
      err instanceof Error ? err.message : 'Could not verify GitHub token.';
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ connected: false });
  clearGitHubSessionCookie(res);
  return res;
}
