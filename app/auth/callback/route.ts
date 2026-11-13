import { NextRequest, NextResponse } from 'next/server';
import {
  GITHUB_OAUTH_STATE_COOKIE,
  clearOAuthStateCookie,
  getGitHubOAuthConfig,
  sealSessionPayload,
  setGitHubSessionCookie,
} from '../../../src/lib/githubServer';

function renderCallbackHtml(options: {
  ok: boolean;
  message: string;
  sealedSession?: string;
}): NextResponse {
  const payload = options.ok
    ? {
        type: 'OAUTH_AUTH_SUCCESS',
        provider: 'github',
        sealedSession: options.sealedSession,
      }
    : {
        type: 'OAUTH_AUTH_ERROR',
        provider: 'github',
        error: options.message,
      };

  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const safeMsg = options.message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GitHub Connection — Tether</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #090B0E;
      color: #F4F4F5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      padding: 24px;
    }
    .card {
      max-width: 420px;
      width: 100%;
      background: #13161C;
      border: 1px solid ${options.ok ? 'rgba(249, 115, 22, 0.55)' : 'rgba(248, 113, 113, 0.55)'};
      border-radius: 10px;
      padding: 20px;
      box-sizing: border-box;
    }
    h1 {
      font-size: 14px;
      margin: 0 0 8px 0;
      color: ${options.ok ? '#FB923C' : '#FCA5A5'};
    }
    p {
      font-size: 12px;
      line-height: 1.5;
      color: #D4D4D8;
      margin: 0 0 16px 0;
    }
    a {
      display: inline-block;
      padding: 8px 12px;
      background: rgba(249, 115, 22, 0.16);
      border: 1px solid rgba(249, 115, 22, 0.65);
      color: #FED7AA;
      text-decoration: none;
      border-radius: 6px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${options.ok ? 'GitHub Connected' : 'GitHub Connection Issue'}</h1>
    <p>${safeMsg}</p>
    <a href="/">Return to Tether</a>
  </div>
  <script>
    (function () {
      var payload = ${safeJson};
      try {
        if (window.opener) {
          window.opener.postMessage(payload, '*');
          if (${options.ok ? 'true' : 'false'}) {
            setTimeout(function () { window.close(); }, 350);
          }
        }
      } catch (e) {}
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: options.ok ? 200 : 400,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const errorParam = searchParams.get('error_description') || searchParams.get('error');
  if (errorParam) {
    const res = renderCallbackHtml({ ok: false, message: errorParam });
    clearOAuthStateCookie(res);
    return res;
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const expectedState = req.cookies.get(GITHUB_OAUTH_STATE_COOKIE)?.value;

  if (!code) {
    const res = renderCallbackHtml({
      ok: false,
      message: 'Missing authorization code from GitHub.',
    });
    clearOAuthStateCookie(res);
    return res;
  }

  if (!state || !expectedState || state !== expectedState) {
    const res = renderCallbackHtml({
      ok: false,
      message: 'Invalid or expired OAuth state. Please try connecting again.',
    });
    clearOAuthStateCookie(res);
    return res;
  }

  const config = getGitHubOAuthConfig(req);
  if (!config.configured) {
    const res = renderCallbackHtml({
      ok: false,
      message: 'GitHub OAuth credentials are not configured on this server.',
    });
    clearOAuthStateCookie(res);
    return res;
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.callbackUrl,
      }),
      cache: 'no-store',
    });

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenJson.access_token) {
      const msg =
        tokenJson.error_description ||
        tokenJson.error ||
        'GitHub did not issue an access token.';
      const res = renderCallbackHtml({ ok: false, message: msg });
      clearOAuthStateCookie(res);
      return res;
    }

    const sealed = sealSessionPayload({
      token: tokenJson.access_token,
      mode: 'oauth',
      createdAt: Date.now(),
    });

    const res = renderCallbackHtml({
      ok: true,
      message: 'Authentication complete. Returning to Tether...',
      sealedSession: sealed,
    });
    clearOAuthStateCookie(res);
    setGitHubSessionCookie(res, sealed);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected OAuth callback error.';
    const res = renderCallbackHtml({ ok: false, message: msg });
    clearOAuthStateCookie(res);
    return res;
  }
}
