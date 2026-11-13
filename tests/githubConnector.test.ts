import { describe, it, expect, beforeEach } from 'bun:test';
import {
  sealSessionPayload,
  unsealSessionPayload,
  sanitizeDeployPath,
} from '../src/lib/githubServer';
import { buildGitHubDeployManifest } from '../src/lib/githubClient';
import { useWorkspaceStore } from '../src/store/workspaceStore';
import {
  setForceInMemory,
  inMemoryStore,
  replaceWorkspaceStorage,
} from '../src/lib/storage';
import type { Block, Project, Tether } from '../src/types/model';

describe('GitHub Connector & Repository Deployment', () => {
  beforeEach(async () => {
    setForceInMemory(true);
    inMemoryStore.clear();
    await replaceWorkspaceStorage({
      projects: [],
      groups: [],
      blocks: [],
      tethers: [],
    });
    useWorkspaceStore.setState({
      projects: [],
      groups: [],
      blocks: [],
      tethers: [],
      activeProjectId: null,
      activeGroupId: null,
      selectedBlockId: null,
    });
  });

  it('seals and unseals GitHub session payloads with AES-256-GCM and rejects tampering', () => {
    const sealed = sealSessionPayload({
      token: 'ghp_example_secret_token_123456',
      mode: 'pat',
      createdAt: 1700000000000,
    });

    expect(sealed.split('.').length).toBe(3);
    expect(sealed).not.toContain('ghp_example_secret_token_123456');

    const unsealed = unsealSessionPayload(sealed);
    expect(unsealed).not.toBeNull();
    expect(unsealed?.token).toBe('ghp_example_secret_token_123456');
    expect(unsealed?.mode).toBe('pat');

    // Tamper with ciphertext
    const parts = sealed.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}AA`;
    expect(unsealSessionPayload(tampered)).toBeNull();
    expect(unsealSessionPayload('malformed')).toBeNull();
  });

  it('sanitizes deployment paths and excludes traversal, .git internals, and .env secrets', () => {
    expect(sanitizeDeployPath('/src/components/App.tsx')).toBe('src/components/App.tsx');
    expect(sanitizeDeployPath('docs\\guide.md')).toBe('docs/guide.md');
    expect(sanitizeDeployPath('.env.example')).toBe('.env.example');

    expect(sanitizeDeployPath('.env')).toBeNull();
    expect(sanitizeDeployPath('config/.env.local')).toBeNull();
    expect(sanitizeDeployPath('config/.env.production')).toBeNull();
    expect(sanitizeDeployPath('.git/config')).toBeNull();
    expect(sanitizeDeployPath('../secrets.txt')).toBeNull();
    expect(sanitizeDeployPath('src/../../etc/passwd')).toBeNull();
    expect(sanitizeDeployPath('   ')).toBeNull();
  });

  it('builds deployment manifests across source, web-html, and source-and-web modes including base64 binary assets', () => {
    const now = Date.now();
    const project: Project = {
      id: 'proj-gh',
      name: 'Landing Kit',
      createdAt: now,
      updatedAt: now,
    };

    const blocks: Block[] = [
      {
        id: 'b-code',
        projectId: 'proj-gh',
        groupId: 'grp-1',
        kind: 'code',
        title: 'app.ts',
        x: 0,
        y: 0,
        status: 'ready',
        data: {
          path: 'src/app.ts',
          language: 'typescript',
          currentContent: 'export const version = 1;\n',
          revisions: [],
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'b-note',
        projectId: 'proj-gh',
        groupId: 'grp-1',
        kind: 'text',
        title: 'Notes',
        x: 0,
        y: 0,
        status: 'ready',
        data: {
          content: '# Architecture Notes\nClean modular blocks.',
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'b-img',
        projectId: 'proj-gh',
        groupId: 'grp-2',
        kind: 'file',
        title: 'logo.png',
        x: 0,
        y: 0,
        status: 'ready',
        data: {
          path: 'assets/logo.png',
          mimeType: 'image/png',
          size: 4,
          binary: true,
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'b-missing-bin',
        projectId: 'proj-gh',
        groupId: 'grp-1',
        kind: 'file',
        title: 'archive.bin',
        x: 0,
        y: 0,
        status: 'ready',
        data: {
          path: 'dist/archive.bin',
          mimeType: 'application/octet-stream',
          size: 128,
          binary: true,
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'b-env',
        projectId: 'proj-gh',
        groupId: 'grp-1',
        kind: 'file',
        title: '.env',
        x: 0,
        y: 0,
        status: 'ready',
        data: {
          path: '.env',
          mimeType: 'text/plain',
          size: 24,
          binary: false,
          content: 'API_KEY=secret123',
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'b-upload',
        projectId: 'proj-gh',
        groupId: 'grp-1',
        kind: 'upload',
        title: 'bundle.zip',
        x: 0,
        y: 0,
        status: 'ready',
        data: {
          fileName: 'bundle.zip',
          size: 512,
          extractedBlockIds: [],
        },
        createdAt: now,
        updatedAt: now,
      },
    ];

    const tethers: Tether[] = [];

    // 1. Source mode across full project
    const sourceManifest = buildGitHubDeployManifest({
      project,
      blocks,
      tethers,
      deployMode: 'source',
    });

    const sourcePaths = sourceManifest.files.map((f) => f.path);
    expect(sourcePaths).toEqual(['assets/logo.png', 'Notes.md', 'src/app.ts']);
    const imgEntry = sourceManifest.files.find((f) => f.path === 'assets/logo.png');
    expect(imgEntry?.encoding).toBe('base64');
    expect(imgEntry?.content).toBe('iVBORw0KGgo=');
    expect(sourceManifest.skippedPaths.length).toBe(2); // .env + archive.bin without payload

    // 2. Web HTML mode adds index.html and .nojekyll
    const webManifest = buildGitHubDeployManifest({
      project,
      blocks,
      tethers,
      deployMode: 'web-html',
    });
    expect(webManifest.files.some((f) => f.path === 'index.html' && f.generated)).toBe(true);
    expect(webManifest.files.some((f) => f.path === '.nojekyll' && f.generated)).toBe(true);

    // 3. Group-scoped manifest excludes blocks outside target group
    const groupScoped = buildGitHubDeployManifest({
      project,
      blocks,
      tethers,
      deployMode: 'source',
      groupId: 'grp-1',
    });
    expect(groupScoped.files.map((f) => f.path)).toEqual(['Notes.md', 'src/app.ts']);
  });

  it('persists non-secret GitHub link metadata on a project without storing tokens', async () => {
    const store = useWorkspaceStore.getState();
    const project = await store.createProject('Deployable Workspace');

    await store.updateProjectGitHubLink(project.id, {
      owner: 'octocat',
      repo: 'tether-site',
      branch: 'gh-pages',
      deployMode: 'web-html',
      lastDeployedAt: 1700000123456,
      lastCommitSha: 'abcdef1234567890',
      lastCommitUrl: 'https://github.com/octocat/tether-site/commit/abcdef1234567890',
      lastDeployedBy: 'octocat',
    });

    const updated = useWorkspaceStore
      .getState()
      .projects.find((p) => p.id === project.id);

    expect(updated?.githubLink?.owner).toBe('octocat');
    expect(updated?.githubLink?.repo).toBe('tether-site');
    expect(updated?.githubLink?.branch).toBe('gh-pages');
    expect(updated?.githubLink?.lastCommitSha).toBe('abcdef1234567890');
    expect(JSON.stringify(updated)).not.toContain('ghp_');
  });
});
