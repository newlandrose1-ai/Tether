'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { GitHubDeployMode, Project } from '../../types/model';
import {
  buildGitHubDeployManifest,
  connectGitHubWithToken,
  createGitHubRepo,
  deployManifestToGitHub,
  disconnectGitHub,
  fetchGitHubOAuthUrl,
  fetchGitHubRepoBranches,
  fetchGitHubRepos,
  fetchGitHubSession,
  saveClientSealedSession,
  type GitHubBranchSummary,
  type GitHubDeployReceipt,
  type GitHubRepoSummary,
  type GitHubSessionInfo,
} from '../../lib/githubClient';
import { formatFileSize } from '../../lib/fileTypes';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  FolderGit2,
  GitBranch,
  GitCommit,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';

interface GitHubDeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionChange?: (session: GitHubSessionInfo | null) => void;
}

export function GitHubDeployModal({
  isOpen,
  onClose,
  onSessionChange,
}: GitHubDeployModalProps) {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const projects = useWorkspaceStore((s) => s.projects);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  if (!isOpen || !activeProject) return null;

  return (
    <GitHubDeployModalContent
      key={activeProject.id}
      activeProject={activeProject}
      onClose={onClose}
      onSessionChange={onSessionChange}
    />
  );
}

interface GitHubDeployModalContentProps {
  activeProject: Project;
  onClose: () => void;
  onSessionChange?: (session: GitHubSessionInfo | null) => void;
}

function GitHubDeployModalContent({
  activeProject,
  onClose,
  onSessionChange,
}: GitHubDeployModalContentProps) {
  const activeGroupId = useWorkspaceStore((s) => s.activeGroupId);
  const groups = useWorkspaceStore((s) => s.groups);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const tethers = useWorkspaceStore((s) => s.tethers);
  const updateProjectGitHubLink = useWorkspaceStore((s) => s.updateProjectGitHubLink);

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const savedLink = activeProject.githubLink;
  const defaultSlug =
    activeProject.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tether-project';

  // Session & Connection state
  const [session, setSession] = useState<GitHubSessionInfo | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isConnectingOAuth, setIsConnectingOAuth] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [showPat, setShowPat] = useState(false);
  const [isConnectingPat, setIsConnectingPat] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showOAuthSetupHelp, setShowOAuthSetupHelp] = useState(false);
  const [copiedCallback, setCopiedCallback] = useState(false);

  // Repositories & Branches state
  const [repos, setRepos] = useState<GitHubRepoSummary[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepoFullName, setSelectedRepoFullName] = useState<string>(() =>
    savedLink ? `${savedLink.owner}/${savedLink.repo}` : ''
  );
  const [branches, setBranches] = useState<GitHubBranchSummary[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string>('main');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [targetBranch, setTargetBranch] = useState<string>(savedLink?.branch || 'main');
  const [isCustomBranch, setIsCustomBranch] = useState(false);

  // Create New Repo inline form
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState(defaultSlug);
  const [newRepoDesc, setNewRepoDesc] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [isSubmittingNewRepo, setIsSubmittingNewRepo] = useState(false);

  // Deployment configuration
  const [deployMode, setDeployMode] = useState<GitHubDeployMode>(
    savedLink?.deployMode || 'source-and-web'
  );
  const [scopeToActiveGroup, setScopeToActiveGroup] = useState(false);
  const [commitMessage, setCommitMessage] = useState(
    `Deploy ${activeProject.name} from Tether`
  );
  const [replaceTree, setReplaceTree] = useState(false);
  const [isManifestOpen, setIsManifestOpen] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStage, setDeployStage] = useState('');
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployReceipt, setDeployReceipt] = useState<GitHubDeployReceipt | null>(null);

  const loadRepos = useCallback(async () => {
    setIsLoadingRepos(true);
    setDeployError(null);
    try {
      const list = await fetchGitHubRepos();
      setRepos(list);
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Unable to load repositories.');
    } finally {
      setIsLoadingRepos(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    setIsCheckingSession(true);
    setAuthError(null);
    try {
      const info = await fetchGitHubSession();
      setSession(info);
      onSessionChange?.(info);
      if (info.connected) {
        await loadRepos();
      } else {
        setRepos([]);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to check GitHub session.');
    } finally {
      setIsCheckingSession(false);
    }
  }, [loadRepos, onSessionChange]);

  // Load initial GitHub session on mount
  useEffect(() => {
    let cancelled = false;
    fetchGitHubSession()
      .then(async (info) => {
        if (cancelled) return;
        setSession(info);
        onSessionChange?.(info);
        if (info.connected) {
          setIsLoadingRepos(true);
          try {
            const list = await fetchGitHubRepos();
            if (!cancelled) setRepos(list);
          } catch (err) {
            if (!cancelled) {
              setDeployError(err instanceof Error ? err.message : 'Unable to load repositories.');
            }
          } finally {
            if (!cancelled) setIsLoadingRepos(false);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : 'Unable to check GitHub session.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onSessionChange]);

  // Load branches when selected repo changes
  useEffect(() => {
    if (!session?.connected || !selectedRepoFullName.includes('/')) {
      return;
    }

    const [owner, repo] = selectedRepoFullName.split('/');
    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetchGitHubRepoBranches(owner, repo);
        if (cancelled) return;
        setBranches(res.branches);
        setDefaultBranch(res.defaultBranch);

        const saved = activeProject.githubLink;
        const matchesSaved =
          saved && saved.owner === owner && saved.repo === repo && saved.branch;
        if (matchesSaved) {
          setTargetBranch(saved.branch);
          setIsCustomBranch(!res.branches.some((b) => b.name === saved.branch));
        } else if (res.branches.some((b) => b.name === res.defaultBranch)) {
          setTargetBranch(res.defaultBranch);
          setIsCustomBranch(false);
        } else if (res.branches.length > 0) {
          setTargetBranch(res.branches[0].name);
          setIsCustomBranch(false);
        } else {
          setTargetBranch(res.defaultBranch || 'main');
          setIsCustomBranch(false);
        }
      } catch {
        if (!cancelled) {
          setBranches([]);
          setTargetBranch('main');
        }
      } finally {
        if (!cancelled) setIsLoadingBranches(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [session?.connected, selectedRepoFullName, activeProject.githubLink]);

  // Listen for postMessage from OAuth popup window
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      const sameOrigin = typeof window !== 'undefined' && origin === window.location.origin;
      const allowedHost =
        sameOrigin || origin.endsWith('.run.app') || origin.includes('localhost');
      if (!allowedHost) return;

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'github') {
        if (typeof event.data.sealedSession === 'string' && event.data.sealedSession) {
          saveClientSealedSession(event.data.sealedSession);
        }
        setIsConnectingOAuth(false);
        setAuthError(null);
        refreshSession();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR' && event.data?.provider === 'github') {
        setIsConnectingOAuth(false);
        setAuthError(event.data.error || 'GitHub OAuth authorization was cancelled.');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshSession]);

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
    );
  }, [repos, repoSearch]);

  const selectedRepoObj = useMemo(
    () => repos.find((r) => r.fullName === selectedRepoFullName) || null,
    [repos, selectedRepoFullName]
  );

  const manifest = useMemo(() => {
    return buildGitHubDeployManifest({
      project: activeProject,
      blocks,
      tethers,
      deployMode,
      groupId: scopeToActiveGroup ? activeGroupId : null,
    });
  }, [activeProject, blocks, tethers, deployMode, scopeToActiveGroup, activeGroupId]);

  const handleOAuthConnect = async () => {
    setAuthError(null);
    setIsConnectingOAuth(true);
    try {
      const data = await fetchGitHubOAuthUrl();
      if (!data.configured || !data.url) {
        setIsConnectingOAuth(false);
        setShowOAuthSetupHelp(true);
        setAuthError(
          'Server OAuth App credentials are not set. Connect immediately below using a Personal Access Token.'
        );
        return;
      }

      const popup = window.open(
        data.url,
        'tether_github_oauth',
        'width=620,height=740,noopener=false'
      );

      if (!popup) {
        setIsConnectingOAuth(false);
        setAuthError(
          'Browser blocked the GitHub sign-in popup. Allow popups for this site or connect with a Personal Access Token below.'
        );
        return;
      }

      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          setIsConnectingOAuth(false);
        }
      }, 600);
    } catch (err) {
      setIsConnectingOAuth(false);
      setAuthError(err instanceof Error ? err.message : 'Unable to start GitHub OAuth flow.');
    }
  };

  const handleTokenConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patInput.trim()) return;
    setAuthError(null);
    setIsConnectingPat(true);
    try {
      const info = await connectGitHubWithToken(patInput.trim());
      setSession(info);
      onSessionChange?.(info);
      setPatInput('');
      await loadRepos();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to verify GitHub token.');
    } finally {
      setIsConnectingPat(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectGitHub();
    const empty: GitHubSessionInfo = {
      connected: false,
      mode: null,
      user: null,
      scopes: [],
      oauthConfigured: Boolean(session?.oauthConfigured),
      callbackUrl: session?.callbackUrl || '',
    };
    setSession(empty);
    onSessionChange?.(empty);
    setRepos([]);
    setBranches([]);
    setDeployReceipt(null);
  };

  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepoName.trim()) return;
    setDeployError(null);
    setIsSubmittingNewRepo(true);
    try {
      const created = await createGitHubRepo({
        name: newRepoName.trim(),
        description: newRepoDesc.trim() || `${activeProject.name} — built in Tether`,
        isPrivate: newRepoPrivate,
      });
      setRepos((prev) => [created, ...prev]);
      setSelectedRepoFullName(created.fullName);
      setTargetBranch(created.defaultBranch || 'main');
      setIsCustomBranch(false);
      setIsCreatingRepo(false);
      setNewRepoDesc('');
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Could not create GitHub repository.');
    } finally {
      setIsSubmittingNewRepo(false);
    }
  };

  const handleDeploy = async () => {
    if (!selectedRepoFullName.includes('/') || !targetBranch.trim() || manifest.files.length === 0) {
      return;
    }

    const [owner, repo] = selectedRepoFullName.split('/');
    const branch = targetBranch.trim();

    setIsDeploying(true);
    setDeployError(null);
    setDeployReceipt(null);
    setDeployStage(`Pushing ${manifest.files.length} files to ${owner}/${repo}@${branch}...`);

    try {
      const receipt = await deployManifestToGitHub({
        owner,
        repo,
        branch,
        commitMessage: commitMessage.trim() || `Deploy ${activeProject.name} from Tether`,
        replaceTree: deployMode === 'web-html' && replaceTree,
        files: manifest.files.map((f) => ({
          path: f.path,
          content: f.content,
          encoding: f.encoding,
        })),
      });

      setDeployReceipt(receipt);
      await updateProjectGitHubLink(activeProject.id, {
        owner: receipt.owner,
        repo: receipt.repo,
        branch: receipt.branch,
        deployMode,
        lastDeployedAt: Date.now(),
        lastCommitSha: receipt.commitSha,
        lastCommitUrl: receipt.commitUrl,
        lastDeployedBy: session?.user?.login,
      });
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Deployment failed.');
    } finally {
      setIsDeploying(false);
      setDeployStage('');
    }
  };

  const handleCopyCallback = async () => {
    if (!session?.callbackUrl) return;
    await navigator.clipboard.writeText(session.callbackUrl);
    setCopiedCallback(true);
    setTimeout(() => setCopiedCallback(false), 1800);
  };

  const branchExists = branches.some((b) => b.name === targetBranch.trim());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="GitHub Connection and Deployment"
    >
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs"
        onClick={onClose}
        aria-label="Close modal"
      />

      <div className="relative z-50 w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-2xl glass-menu border-0 sm:border sm:border-zinc-600/80 sm:border-t-orange-500/80 sm:rounded-xl flex flex-col overflow-hidden text-zinc-200 animate-panel-in">
        {/* Modal Header */}
        <div className="h-13 px-4 border-b border-zinc-700/75 glass-header flex items-center justify-between gap-3 shrink-0 safe-top">
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderGit2 className="w-4 h-4 text-orange-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-100 truncate">
                GitHub Connection &amp; Deploy
              </h2>
              <p className="text-[11px] font-mono text-zinc-400 truncate">
                {activeProject.name}
                {activeProject.githubLink
                  ? ` · Linked to ${activeProject.githubLink.owner}/${activeProject.githubLink.repo}`
                  : ' · Not yet linked'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded-md transition cursor-pointer shrink-0"
            aria-label="Close GitHub modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 text-xs">
          {/* 1. ACCOUNT CONNECTION SECTION */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-zinc-300 uppercase font-mono">
                1. GitHub Account
              </h3>
              {session?.connected && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 hover:text-red-300 transition cursor-pointer"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Disconnect</span>
                </button>
              )}
            </div>

            {isCheckingSession && !session ? (
              <div className="p-4 border border-zinc-700/75 rounded-lg bg-zinc-900/50 flex items-center gap-2.5 text-zinc-400 font-mono">
                <RefreshCw className="w-4 h-4 text-orange-400 animate-spin" />
                <span>Checking GitHub connection...</span>
              </div>
            ) : session?.connected && session.user ? (
              <div className="p-3.5 glass-card border border-zinc-700/80 rounded-lg flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {session.user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={session.user.avatarUrl}
                      alt={session.user.login}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-full border border-zinc-600/80 object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-orange-500/20 border border-orange-500/50 flex items-center justify-center text-orange-300 font-bold shrink-0">
                      {session.user.login.slice(0, 2).toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-zinc-100 font-medium truncate">
                      <span>{session.user.name || session.user.login}</span>
                      <span className="text-zinc-400 font-mono text-[11px]">
                        @{session.user.login}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 flex items-center gap-2 mt-0.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>
                        Connected via{' '}
                        {session.mode === 'oauth' ? 'GitHub OAuth' : 'Personal Access Token'}
                      </span>
                      {session.scopes.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-zinc-400 truncate">
                            {session.scopes.join(', ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <a
                  href={session.user.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white rounded text-[11px] font-mono flex items-center gap-1 shrink-0 whitespace-nowrap"
                >
                  <span>Profile</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ) : (
              <div className="space-y-3 border border-zinc-700/80 rounded-lg p-4 bg-zinc-950/45">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Connect any GitHub account to push your Tether folders or interactive web explorer
                  straight into a repository. Nothing is tied to a specific device.
                </p>

                {authError && (
                  <div className="p-2.5 bg-red-950/40 border border-red-800/70 rounded text-xs text-red-200 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{authError}</span>
                  </div>
                )}

                {/* Option A: 1-Click OAuth Popup */}
                {session?.oauthConfigured && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleOAuthConnect}
                      disabled={isConnectingOAuth}
                      className="w-full py-2.5 px-4 min-h-[44px] bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/75 text-orange-100 hover:text-white rounded-lg font-mono font-semibold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-60"
                    >
                      <FolderGit2 className="w-4 h-4 text-orange-400" />
                      <span>
                        {isConnectingOAuth ? 'Waiting for GitHub Sign-In...' : 'Sign in with GitHub (OAuth)'}
                      </span>
                    </button>
                    <div className="flex items-center gap-3 py-1 text-[11px] font-mono text-zinc-500">
                      <div className="flex-1 h-px bg-zinc-800" />
                      <span>or use a personal token</span>
                      <div className="flex-1 h-px bg-zinc-800" />
                    </div>
                  </div>
                )}

                {/* Option B: Dependable Universal Token Connector */}
                <form onSubmit={handleTokenConnect} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="tether-gh-pat"
                      className="text-xs font-medium text-zinc-200 flex items-center gap-1.5"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-orange-400" />
                      <span>GitHub Personal Access Token</span>
                    </label>
                    <div className="flex items-center gap-3 text-[11px]">
                      <a
                        href="https://github.com/settings/personal-access-tokens/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-400 hover:text-orange-300 underline underline-offset-2 inline-flex items-center gap-1"
                      >
                        <span>Fine-grained token</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href="https://github.com/settings/tokens/new?scopes=repo,read:user&description=Tether%20Workspace"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2 inline-flex items-center gap-1"
                      >
                        <span>Classic (repo)</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-400">
                    For fine-grained tokens, grant <strong className="text-zinc-200">Contents: Read &amp; Write</strong> on the repositories you want to deploy to. Your token is sealed in an encrypted server session cookie and never exported with project files.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1 flex items-center">
                      <input
                        id="tether-gh-pat"
                        type={showPat ? 'text' : 'password'}
                        value={patInput}
                        onChange={(e) => setPatInput(e.target.value)}
                        placeholder="github_pat_... or ghp_..."
                        autoComplete="off"
                        className="w-full bg-zinc-900/90 border border-zinc-700/80 focus:border-orange-500/80 rounded-lg px-3 py-2.5 pr-10 text-base sm:text-xs font-mono text-zinc-100 placeholder:text-zinc-600 outline-none transition min-h-[44px] sm:min-h-[38px]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPat((p) => !p)}
                        className="absolute right-2 text-zinc-400 hover:text-zinc-200 p-1.5 cursor-pointer"
                        aria-label={showPat ? 'Hide token' : 'Show token'}
                      >
                        {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={isConnectingPat || !patInput.trim()}
                      className="px-4 py-2.5 min-h-[44px] sm:min-h-[38px] bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/75 text-orange-100 hover:text-white rounded-lg font-mono font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                    >
                      {isConnectingPat ? 'Connecting...' : 'Connect Account'}
                    </button>
                  </div>
                </form>

                {/* Optional App Owner OAuth Setup Disclosure */}
                {!session?.oauthConfigured && (
                  <div className="pt-1 border-t border-zinc-800/80">
                    <button
                      type="button"
                      onClick={() => setShowOAuthSetupHelp((p) => !p)}
                      className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    >
                      {showOAuthSetupHelp ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      <span>App Owner: Enable 1-Click OAuth for all visitors</span>
                    </button>

                    {showOAuthSetupHelp && (
                      <div className="mt-2 p-3 bg-zinc-900/70 border border-zinc-800 rounded text-[11px] text-zinc-300 space-y-2">
                        <p>
                          Register a GitHub OAuth App with this Authorization Callback URL and set{' '}
                          <code className="text-orange-300">GITHUB_CLIENT_ID</code> &amp;{' '}
                          <code className="text-orange-300">GITHUB_CLIENT_SECRET</code> in your deployment environment:
                        </p>
                        <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 font-mono">
                          <span className="truncate flex-1 text-zinc-200">
                            {session?.callbackUrl || '/auth/callback'}
                          </span>
                          <button
                            type="button"
                            onClick={handleCopyCallback}
                            className="text-orange-400 hover:text-orange-300 shrink-0 flex items-center gap-1 cursor-pointer"
                          >
                            {copiedCallback ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedCallback ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 2. TARGET REPOSITORY & BRANCH */}
          {session?.connected && (
            <section className="space-y-3 pt-1 border-t border-zinc-800/80">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-zinc-300 uppercase font-mono">
                  2. Repository &amp; Branch
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadRepos}
                    disabled={isLoadingRepos}
                    className="px-2 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-100 bg-zinc-900/80 border border-zinc-700/80 rounded flex items-center gap-1 cursor-pointer"
                    title="Refresh repository list"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingRepos ? 'animate-spin text-orange-400' : ''}`} />
                    <span>Refresh</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingRepo((p) => !p)}
                    className={`px-2.5 py-1 text-[11px] font-mono rounded border flex items-center gap-1 cursor-pointer transition ${
                      isCreatingRepo
                        ? 'bg-orange-500/20 border-orange-500/70 text-orange-100'
                        : 'bg-zinc-900/80 border-zinc-700/80 hover:border-orange-500/60 text-zinc-200'
                    }`}
                  >
                    <Plus className="w-3 h-3 text-orange-400" />
                    <span>New Repo</span>
                  </button>
                </div>
              </div>

              {/* Inline Create Repository Form */}
              {isCreatingRepo && (
                <form
                  onSubmit={handleCreateRepo}
                  className="p-3.5 bg-zinc-950/75 border border-orange-500/45 rounded-lg space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] font-mono text-zinc-400 block mb-1">
                        Repository Name
                      </label>
                      <input
                        type="text"
                        required
                        value={newRepoName}
                        onChange={(e) => setNewRepoName(e.target.value)}
                        placeholder="my-tether-site"
                        className="w-full bg-zinc-900 border border-zinc-700 focus:border-orange-500/75 rounded px-2.5 py-2 text-base sm:text-xs font-mono text-zinc-100 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-mono text-zinc-400 block mb-1">
                        Description (optional)
                      </label>
                      <input
                        type="text"
                        value={newRepoDesc}
                        onChange={(e) => setNewRepoDesc(e.target.value)}
                        placeholder="Deployed from Tether"
                        className="w-full bg-zinc-900 border border-zinc-700 focus:border-orange-500/75 rounded px-2.5 py-2 text-base sm:text-xs font-mono text-zinc-100 outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1 p-0.5 bg-zinc-900 border border-zinc-700/80 rounded-md font-mono text-[11px]">
                      <button
                        type="button"
                        onClick={() => setNewRepoPrivate(false)}
                        className={`px-2.5 py-1 rounded flex items-center gap-1 cursor-pointer transition ${
                          !newRepoPrivate
                            ? 'bg-orange-500/20 text-orange-100'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <Globe className="w-3 h-3" />
                        <span>Public</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewRepoPrivate(true)}
                        className={`px-2.5 py-1 rounded flex items-center gap-1 cursor-pointer transition ${
                          newRepoPrivate
                            ? 'bg-orange-500/20 text-orange-100'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <Lock className="w-3 h-3" />
                        <span>Private</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsCreatingRepo(false)}
                        className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 text-xs font-mono cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmittingNewRepo || !newRepoName.trim()}
                        className="px-3.5 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/75 text-orange-100 rounded text-xs font-mono font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {isSubmittingNewRepo ? 'Creating...' : 'Create Repository'}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Search & Repository Selector */}
              <div className="space-y-2">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 pointer-events-none" />
                  <input
                    type="search"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Filter your GitHub repositories..."
                    className="w-full bg-zinc-950/70 border border-zinc-700/80 focus:border-orange-500/75 rounded-lg pl-8 pr-3 py-2 text-base sm:text-xs font-mono text-zinc-100 placeholder:text-zinc-500 outline-none"
                  />
                </div>

                <div className="max-h-44 overflow-y-auto border border-zinc-700/75 rounded-lg bg-zinc-950/55 divide-y divide-zinc-800/80">
                  {isLoadingRepos && repos.length === 0 ? (
                    <div className="p-4 text-center text-zinc-400 font-mono">
                      Loading repositories...
                    </div>
                  ) : filteredRepos.length === 0 ? (
                    <div className="p-4 text-center text-zinc-400 font-mono space-y-2">
                      <p>
                        {repoSearch
                          ? 'No matching repositories found.'
                          : 'No push-enabled repositories found for this token.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsCreatingRepo(true)}
                        className="px-3 py-1.5 bg-orange-500/15 border border-orange-500/50 text-orange-200 rounded cursor-pointer"
                      >
                        + Create New Repository
                      </button>
                    </div>
                  ) : (
                    filteredRepos.map((repo) => {
                      const isSelected = repo.fullName === selectedRepoFullName;
                      return (
                        <button
                          key={repo.id}
                          type="button"
                          onClick={() => {
                            if (repo.fullName !== selectedRepoFullName) {
                              setIsLoadingBranches(true);
                              setSelectedRepoFullName(repo.fullName);
                            }
                          }}
                          className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 transition cursor-pointer min-h-[44px] ${
                            isSelected
                              ? 'bg-orange-500/14 text-white'
                              : 'hover:bg-zinc-800/60 text-zinc-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-mono font-medium truncate ${
                                  isSelected ? 'text-orange-200' : 'text-zinc-100'
                                }`}
                              >
                                {repo.fullName}
                              </span>
                              <span className="text-[11px] text-zinc-400 shrink-0">
                                {repo.isPrivate ? 'Private' : 'Public'}
                              </span>
                            </div>
                            {repo.description && (
                              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                                {repo.description}
                              </p>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-zinc-400 shrink-0">
                            {repo.defaultBranch}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Branch + Scope Controls */}
              {selectedRepoFullName && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-mono text-zinc-400 flex items-center gap-1">
                        <GitBranch className="w-3 h-3 text-orange-400" />
                        <span>Target Branch</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsCustomBranch((p) => !p)}
                        className="text-[11px] font-mono text-orange-400 hover:text-orange-300 cursor-pointer"
                      >
                        {isCustomBranch ? 'Choose existing' : '+ New / custom branch'}
                      </button>
                    </div>

                    {isCustomBranch || branches.length === 0 ? (
                      <input
                        type="text"
                        value={targetBranch}
                        onChange={(e) => setTargetBranch(e.target.value)}
                        placeholder="main or gh-pages"
                        className="w-full bg-zinc-900 border border-zinc-700 focus:border-orange-500/75 rounded-md px-2.5 py-2 text-base sm:text-xs font-mono text-zinc-100 outline-none"
                      />
                    ) : (
                      <select
                        value={targetBranch}
                        onChange={(e) => setTargetBranch(e.target.value)}
                        disabled={isLoadingBranches}
                        className="w-full bg-zinc-900 border border-zinc-700 focus:border-orange-500/75 rounded-md px-2.5 py-2 text-base sm:text-xs font-mono text-zinc-100 outline-none"
                      >
                        {branches.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                            {b.name === defaultBranch ? ' (default)' : ''}
                          </option>
                        ))}
                      </select>
                    )}

                    {targetBranch.trim() && !branchExists && !isLoadingBranches && (
                      <p className="text-[11px] text-zinc-400 mt-1">
                        Branch <span className="font-mono text-orange-300">{targetBranch.trim()}</span>{' '}
                        will be created automatically from <span className="font-mono">{defaultBranch}</span>.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-[11px] font-mono text-zinc-400 block mb-1">
                      Deployment Scope
                    </label>
                    <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-700/80 rounded-md font-mono text-[11px]">
                      <button
                        type="button"
                        onClick={() => setScopeToActiveGroup(false)}
                        className={`flex-1 py-1.5 px-2 rounded transition cursor-pointer ${
                          !scopeToActiveGroup
                            ? 'bg-orange-500/20 text-orange-100 font-semibold'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        Entire Project
                      </button>
                      <button
                        type="button"
                        disabled={!activeGroup}
                        onClick={() => setScopeToActiveGroup(true)}
                        className={`flex-1 py-1.5 px-2 rounded transition cursor-pointer truncate disabled:opacity-40 ${
                          scopeToActiveGroup
                            ? 'bg-orange-500/20 text-orange-100 font-semibold'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                        title={activeGroup ? `Only ${activeGroup.name}` : 'No group selected'}
                      >
                        {activeGroup ? activeGroup.name : 'Group'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 3. DEPLOYMENT PACKAGE & PRE-FLIGHT MANIFEST */}
          {session?.connected && selectedRepoFullName && (
            <section className="space-y-3 pt-1 border-t border-zinc-800/80">
              <h3 className="text-xs font-semibold tracking-wide text-zinc-300 uppercase font-mono">
                3. Deploy Package
              </h3>

              {/* Mode selector */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono">
                {(
                  [
                    {
                      id: 'source',
                      title: 'Source Files',
                      desc: 'Raw project code, notes & assets in folders',
                    },
                    {
                      id: 'web-html',
                      title: 'Web Site (Pages)',
                      desc: 'Generates root index.html explorer + source files',
                    },
                    {
                      id: 'source-and-web',
                      title: 'Source + Explorer',
                      desc: 'Keeps your index.html, adds tether-explorer.html',
                    },
                  ] as const
                ).map((opt) => {
                  const active = deployMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDeployMode(opt.id)}
                      className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                        active
                          ? 'bg-orange-500/14 border-orange-500/75 text-zinc-100'
                          : 'bg-zinc-900/60 border-zinc-700/75 hover:border-zinc-500 text-zinc-300'
                      }`}
                    >
                      <div className="font-semibold text-xs text-zinc-100">{opt.title}</div>
                      <div className="text-[11px] font-sans text-zinc-400 mt-0.5 leading-snug">
                        {opt.desc}
                      </div>
                    </button>
                  );
                })}
              </div>

              {deployMode === 'web-html' && (
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={replaceTree}
                    onChange={(e) => setReplaceTree(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-900 accent-orange-500"
                  />
                  <span>Replace existing files on target branch (clean static publish)</span>
                </label>
              )}

              <div>
                <label
                  htmlFor="tether-gh-commit-msg"
                  className="text-[11px] font-mono text-zinc-400 block mb-1"
                >
                  Commit Message
                </label>
                <input
                  id="tether-gh-commit-msg"
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Deploy project from Tether"
                  className="w-full bg-zinc-900/80 border border-zinc-700/80 focus:border-orange-500/75 rounded-md px-3 py-2 text-base sm:text-xs font-mono text-zinc-100 outline-none"
                />
              </div>

              {/* Pre-flight Manifest Disclosure */}
              <div className="border border-zinc-700/75 rounded-lg bg-zinc-950/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsManifestOpen((p) => !p)}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-xs font-mono text-zinc-200 hover:bg-zinc-900/60 cursor-pointer"
                  aria-expanded={isManifestOpen}
                >
                  <span className="flex items-center gap-2">
                    {isManifestOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                    <span>Deployment Manifest</span>
                  </span>
                  <span className="text-[11px] text-zinc-400 tabular-nums">
                    {manifest.files.length} files · {formatFileSize(manifest.totalBytes)}
                  </span>
                </button>

                {isManifestOpen && (
                  <div className="border-t border-zinc-800 max-h-40 overflow-y-auto divide-y divide-zinc-800/70 px-3 py-1 font-mono text-[11px]">
                    {manifest.files.map((f) => (
                      <div key={f.path} className="py-1.5 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0 text-zinc-200">
                          <FileCode className="w-3 h-3 text-zinc-400 shrink-0" />
                          <span className="truncate">{f.path}</span>
                          {f.generated && (
                            <span className="text-[10px] text-orange-300 shrink-0">generated</span>
                          )}
                        </span>
                        <span className="text-zinc-500 shrink-0 tabular-nums">
                          {formatFileSize(f.byteSize)}
                        </span>
                      </div>
                    ))}
                    {manifest.skippedPaths.map((skip, idx) => (
                      <div
                        key={`${skip.path}-${idx}`}
                        className="py-1.5 flex items-center justify-between gap-2 text-amber-300/80"
                      >
                        <span className="truncate">{skip.path} (skipped)</span>
                        <span className="text-[10px] shrink-0">{skip.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Error Banner */}
          {deployError && (
            <div className="p-3 bg-red-950/45 border border-red-800/75 rounded-lg text-xs text-red-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{deployError}</span>
            </div>
          )}

          {/* Success Receipt */}
          {deployReceipt && (
            <div className="p-4 bg-emerald-950/25 border border-emerald-500/45 rounded-lg space-y-2.5">
              <div className="flex items-center gap-2 text-emerald-300 font-semibold text-xs">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Deployed {deployReceipt.filesCommitted} files to {deployReceipt.owner}/
                  {deployReceipt.repo} ({deployReceipt.branch})
                </span>
              </div>

              <div className="text-[11px] font-mono text-zinc-300 flex items-center gap-2">
                <GitCommit className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Commit {deployReceipt.commitSha.slice(0, 7)}</span>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={deployReceipt.commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-100 rounded text-[11px] font-mono inline-flex items-center gap-1.5"
                >
                  <span>View Commit</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={deployReceipt.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-100 rounded text-[11px] font-mono inline-flex items-center gap-1.5"
                >
                  <span>Open Repository</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                {deployReceipt.pagesUrl && (
                  <a
                    href={deployReceipt.pagesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/70 text-orange-100 rounded text-[11px] font-mono inline-flex items-center gap-1.5"
                  >
                    <Globe className="w-3 h-3 text-orange-400" />
                    <span>GitHub Pages</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sticky Modal Footer */}
        <div className="px-4 py-3 border-t border-zinc-700/75 glass-header flex items-center justify-between gap-3 shrink-0 safe-bottom">
          <div className="text-[11px] font-mono text-zinc-400 truncate">
            {isDeploying
              ? deployStage
              : selectedRepoObj
              ? `Target: ${selectedRepoObj.fullName}@${targetBranch || defaultBranch}`
              : session?.connected
              ? 'Select or create a repository above'
              : 'Connect GitHub to enable deployment'}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 min-h-[40px] sm:min-h-[36px] bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-md text-xs font-mono cursor-pointer"
            >
              Close
            </button>

            {session?.connected && (
              <button
                type="button"
                onClick={handleDeploy}
                disabled={
                  isDeploying ||
                  !selectedRepoFullName ||
                  !targetBranch.trim() ||
                  manifest.files.length === 0
                }
                className="px-4 py-2 min-h-[40px] sm:min-h-[36px] bg-orange-500/25 hover:bg-orange-500/35 border border-orange-500/80 text-orange-50 hover:text-white rounded-md text-xs font-mono font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                {isDeploying ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-orange-300" />
                ) : (
                  <Send className="w-3.5 h-3.5 text-orange-400" />
                )}
                <span>{isDeploying ? 'Deploying...' : 'Deploy to GitHub'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
