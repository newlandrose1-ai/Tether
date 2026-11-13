import { NextRequest, NextResponse } from 'next/server';
import {
  GitHubApiError,
  deployFilesToGitHub,
  extractGitHubSession,
  type GitHubDeployFileInput,
} from '../../../../src/lib/githubServer';

export async function POST(req: NextRequest) {
  const session = extractGitHubSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Not connected to GitHub. Connect an account or token first.' },
      { status: 401 }
    );
  }

  let body: {
    owner?: string;
    repo?: string;
    branch?: string;
    commitMessage?: string;
    replaceTree?: boolean;
    files?: GitHubDeployFileInput[];
  } = {};

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON deployment payload.' }, { status: 400 });
  }

  if (!body.owner || !body.repo || !body.branch) {
    return NextResponse.json(
      { error: 'Target owner, repository, and branch are required.' },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return NextResponse.json(
      { error: 'Deployment manifest must include at least one file.' },
      { status: 400 }
    );
  }

  try {
    const result = await deployFilesToGitHub({
      token: session.token,
      owner: body.owner,
      repo: body.repo,
      branch: body.branch,
      commitMessage: body.commitMessage || 'Deploy Tether workspace',
      files: body.files,
      replaceTree: Boolean(body.replaceTree),
    });

    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof GitHubApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : 'GitHub deployment failed.';
    return NextResponse.json({ error: message }, { status });
  }
}
