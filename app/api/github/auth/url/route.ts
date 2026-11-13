import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getGitHubOAuthConfig, setOAuthStateCookie } from '../../../../../src/lib/githubServer';

export async function GET(req: NextRequest) {
  const config = getGitHubOAuthConfig(req);

  if (!config.configured) {
    return NextResponse.json({
      configured: false,
      url: null,
      callbackUrl: config.callbackUrl,
    });
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    scope: 'repo read:user',
    state,
    allow_signup: 'true',
  });

  const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
  const res = NextResponse.json({
    configured: true,
    url: authUrl,
    callbackUrl: config.callbackUrl,
  });

  setOAuthStateCookie(res, state);
  return res;
}
