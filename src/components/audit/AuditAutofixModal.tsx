'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { auditTarget } from '../../lib/projectAudit';
import {
  defaultDeepVerify,
  defaultGeminiAudit,
  defaultWebResolve,
  runAutofixLoop,
} from '../../lib/auditAutofix';
import { exportProjectToZip } from '../../lib/projectZipExport';
import type {
  AuditFinding,
  AuditTargetType,
  AuditVerificationProof,
  AutofixSessionResult,
  AutofixStepLog,
  AutofixWebSource,
  Block,
  CodeBlockData,
  FileBlockData,
  TargetAuditReport,
} from '../../types/model';
import {
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  StopCircle,
  Globe,
  ExternalLink,
  FileCode,
  Folder,
  FolderArchive,
  RefreshCw,
  X,
  BookOpen,
  Download,
  Sparkles,
  CheckSquare,
  Cpu,
} from 'lucide-react';

function getBlockText(b: Block): string {
  if (b.kind === 'code') return (b.data as CodeBlockData)?.currentContent || '';
  if (b.kind === 'file') return (b.data as FileBlockData)?.content || '';
  return (b.data as { content?: string })?.content || '';
}

export function AuditAutofixModal() {
  const auditModalRequest = useWorkspaceStore((s) => s.auditModalRequest);
  const closeAuditModal = useWorkspaceStore((s) => s.closeAuditModal);
  const openAuditModal = useWorkspaceStore((s) => s.openAuditModal);
  const projects = useWorkspaceStore((s) => s.projects);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const selectedBlockId = useWorkspaceStore((s) => s.selectedBlockId);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const applyAuditedBlockContent = useWorkspaceStore((s) => s.applyAuditedBlockContent);
  const auditTargetScope = useWorkspaceStore((s) => s.auditTargetScope);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const isOpen = Boolean(auditModalRequest?.isOpen && activeProject);

  const [includeUntethered, setIncludeUntethered] = useState(true);
  const [useWebGrounding, setUseWebGrounding] = useState(true);
  const [useDeepCompilerVerify, setUseDeepCompilerVerify] = useState(true);
  const [useGeminiAudit, setUseGeminiAudit] = useState(true);

  const [geminiStatus, setGeminiStatus] = useState<{
    checked: boolean;
    connected: boolean;
    model: string;
  }>({ checked: false, connected: false, model: 'gemini-4-hydrogen' });

  const [isRunningDeepScan, setIsRunningDeepScan] = useState(false);
  const [deepScanResult, setDeepScanResult] = useState<{
    token: number;
    extraFindings: AuditFinding[];
    verification: AuditVerificationProof;
    note?: string;
  } | null>(null);

  const [isRunningLoop, setIsRunningLoop] = useState(false);
  const [loopToken, setLoopToken] = useState<number>(0);
  const [liveSteps, setLiveSteps] = useState<AutofixStepLog[]>([]);
  const [sessionResult, setSessionResult] = useState<AutofixSessionResult | null>(null);
  const [userDeclinedToken, setUserDeclinedToken] = useState<number | null>(null);

  const stopRequestedRef = useRef(false);

  // Check Gemini API server connectivity cleanly on mount/open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/audit/gemini')
      .then((res) => res.json())
      .then((data: { connected?: boolean; model?: string }) => {
        if (cancelled) return;
        setGeminiStatus({
          checked: true,
          connected: Boolean(data?.connected),
          model: data?.model || 'gemini-4-hydrogen',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setGeminiStatus({
          checked: true,
          connected: false,
          model: 'gemini-4-hydrogen',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRunningLoop) {
        e.preventDefault();
        closeAuditModal();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, isRunningLoop, closeAuditModal]);

  const targetType: AuditTargetType = auditModalRequest?.targetType ?? 'project';
  const targetBlockId = auditModalRequest?.blockId ?? selectedBlockId ?? undefined;
  const targetFolderPath = auditModalRequest?.folderPath;
  const targetSelectedBlockIds = useMemo(
    () =>
      auditModalRequest?.selectedBlockIds ??
      (targetBlockId ? [targetBlockId] : []),
    [auditModalRequest?.selectedBlockIds, targetBlockId]
  );
  const requestToken = auditModalRequest?.token ?? 0;

  // Deterministic live report synced to current store state (Single Source of Truth)
  const baseLiveReport: TargetAuditReport | null = useMemo(() => {
    if (!isOpen || !activeProject) return null;
    return auditTarget({
      targetType,
      project: activeProject,
      blocks,
      blockId: targetBlockId,
      folderPath: targetFolderPath,
      selectedBlockIds: targetSelectedBlockIds,
      includeUntethered,
    });
  }, [
    isOpen,
    activeProject,
    targetType,
    blocks,
    targetBlockId,
    targetFolderPath,
    targetSelectedBlockIds,
    includeUntethered,
  ]);

  // Project blocks eligible for multi-selection portion auditing
  const selectableBlocks = useMemo(() => {
    if (!activeProject) return [];
    return blocks
      .filter(
        (b) =>
          b.projectId === activeProject.id &&
          b.kind !== 'upload' &&
          (includeUntethered || b.isInFolderStructure)
      )
      .sort((a, b) =>
        (a.sourcePath || a.title).localeCompare(b.sourcePath || b.title)
      );
  }, [activeProject, blocks, includeUntethered]);

  // Available folders from current project blocks for quick scope switching
  const availableFolders = useMemo(() => {
    if (!activeProject) return [];
    const folders = new Set<string>();
    for (const b of blocks) {
      if (b.projectId !== activeProject.id || b.kind === 'upload') continue;
      if (!includeUntethered && !b.isInFolderStructure) continue;
      const p = (b.sourcePath || (b.data as { path?: string })?.path || b.title).replace(
        /^\/+/,
        ''
      );
      const parts = p.split('/');
      let curr = '';
      for (let i = 0; i < parts.length - 1; i++) {
        curr = curr ? `${curr}/${parts[i]}` : parts[i];
        folders.add(curr);
      }
    }
    return Array.from(folders).sort((a, b) => a.localeCompare(b));
  }, [activeProject, blocks, includeUntethered]);

  const activeDeepScan =
    deepScanResult && deepScanResult.token === requestToken ? deepScanResult : null;

  const liveReport: TargetAuditReport | null = useMemo(() => {
    if (!baseLiveReport) return null;
    if (!activeDeepScan || activeDeepScan.extraFindings.length === 0) {
      return activeDeepScan
        ? { ...baseLiveReport, verification: activeDeepScan.verification }
        : baseLiveReport;
    }
    const extraErrors = activeDeepScan.extraFindings.filter((f) => f.severity === 'error').length;
    const extraWarnings = activeDeepScan.extraFindings.filter((f) => f.severity === 'warning').length;
    const totalErrors = baseLiveReport.errorCount + extraErrors;
    return {
      ...baseLiveReport,
      errorCount: totalErrors,
      warningCount: baseLiveReport.warningCount + extraWarnings,
      passed: totalErrors === 0,
      testable: totalErrors === 0 && activeDeepScan.verification.compiledCleanly,
      findings: [...baseLiveReport.findings, ...activeDeepScan.extraFindings],
      verification: activeDeepScan.verification,
    };
  }, [baseLiveReport, activeDeepScan]);

  if (!isOpen || !activeProject || !liveReport) return null;

  const isActiveSessionForRequest =
    sessionResult !== null && loopToken === requestToken;
  const isDeclinedForRequest = userDeclinedToken === requestToken;

  const activeSteps = loopToken === requestToken ? liveSteps : [];
  const allWebSources: AutofixWebSource[] = isActiveSessionForRequest
    ? sessionResult.webSources
    : [];

  const displayVerification: AuditVerificationProof | undefined =
    (isActiveSessionForRequest ? sessionResult?.verification : undefined) ||
    liveReport.verification;

  const handleRunDeepAuditAndVerify = async () => {
    if (isRunningLoop || isRunningDeepScan) return;
    setUserDeclinedToken(null);
    setIsRunningDeepScan(true);
    try {
      const latestReport = await auditTargetScope({
        targetType,
        projectId: activeProject.id,
        blockId: targetBlockId,
        folderPath: targetFolderPath,
        selectedBlockIds: targetSelectedBlockIds,
        includeUntethered,
      });

      const currentBlocks = useWorkspaceStore.getState().blocks;
      const blockById = new Map(currentBlocks.map((b) => [b.id, b]));
      const allProjectFiles = currentBlocks
        .filter((b) => b.projectId === activeProject.id && b.kind !== 'upload')
        .map((b) => ({
          blockId: b.id,
          path: (b.sourcePath || (b.data as { path?: string })?.path || b.title).replace(/^\/+/, ''),
          language: (b.data as { language?: string })?.language || 'javascript',
          content: getBlockText(b),
        }));

      const targetFiles = latestReport.fileReports.map((fr) => {
        const blk = blockById.get(fr.blockId);
        return {
          blockId: fr.blockId,
          path: fr.path,
          language: fr.language,
          content: blk ? getBlockText(blk) : '',
        };
      });

      const collectedFindings: AuditFinding[] = [];
      let verification: AuditVerificationProof = latestReport.verification || {
        compiledCleanly: latestReport.passed,
        typeCheckedCleanly: latestReport.passed,
        runtimeVerified: latestReport.passed,
        geminiAudited: false,
        checksRun: [],
        summary: '',
      };

      if (useDeepCompilerVerify && targetFiles.length > 0) {
        try {
          const vRes = await defaultDeepVerify({ targetFiles, allProjectFiles });
          if (vRes.available) {
            collectedFindings.push(...(vRes.diagnostics || []));
            if (vRes.verification) {
              verification = {
                ...verification,
                compiledCleanly:
                  verification.compiledCleanly && vRes.verification.compiledCleanly,
                typeCheckedCleanly:
                  verification.typeCheckedCleanly && vRes.verification.typeCheckedCleanly,
                runtimeVerified: vRes.verification.runtimeVerified,
                checksRun: Array.from(
                  new Set([...verification.checksRun, ...vRes.verification.checksRun])
                ),
                summary: vRes.verification.summary,
              };
            }
          }
        } catch {
          // Non-fatal fallback
        }
      }

      let note: string | undefined;
      if (useGeminiAudit && targetFiles.length > 0) {
        try {
          const gRes = await defaultGeminiAudit({
            files: targetFiles.slice(0, 6).map((tf) => ({
              blockId: tf.blockId,
              filePath: tf.path,
              language: tf.language,
              content: tf.content,
            })),
            projectPaths: allProjectFiles.map((f) => f.path),
          });
          if (gRes.available) {
            collectedFindings.push(...(gRes.findings || []));
            verification = {
              ...verification,
              geminiAudited: true,
              checksRun: Array.from(
                new Set([...verification.checksRun, 'Gemini AI Deep Semantic Audit'])
              ),
              summary: gRes.summary || verification.summary,
            };
          } else if (gRes.reason) {
            note = gRes.reason;
          }
        } catch (err) {
          note = err instanceof Error ? err.message : 'Gemini audit unavailable.';
        }
      }

      setDeepScanResult({
        token: requestToken,
        extraFindings: collectedFindings,
        verification,
        note,
      });
    } finally {
      setIsRunningDeepScan(false);
    }
  };

  const handleConsentAndRunAutofix = async () => {
    if (isRunningLoop) return;
    stopRequestedRef.current = false;
    setUserDeclinedToken(null);
    setDeepScanResult(null);
    setSessionResult(null);
    setLiveSteps([]);
    setLoopToken(requestToken);
    setIsRunningLoop(true);

    try {
      const result = await runAutofixLoop({
        confirmedByUser: true,
        targetType,
        projectId: activeProject.id,
        blockId: targetBlockId,
        folderPath: targetFolderPath,
        selectedBlockIds: targetSelectedBlockIds,
        includeUntethered,
        getProject: () =>
          useWorkspaceStore
            .getState()
            .projects.find((p) => p.id === activeProject.id),
        getBlocks: () => useWorkspaceStore.getState().blocks,
        updateBlockContent: async (bId, nextContent) => {
          await applyAuditedBlockContent(bId, nextContent);
        },
        webResolveFn: useWebGrounding || useGeminiAudit ? defaultWebResolve : undefined,
        deepVerifyFn: useDeepCompilerVerify ? defaultDeepVerify : undefined,
        geminiAuditFn: useGeminiAudit ? defaultGeminiAudit : undefined,
        shouldStop: () => stopRequestedRef.current,
        onProgress: (step) => {
          setLiveSteps((prev) => [...prev, step]);
        },
      });
      setSessionResult(result);

      await auditTargetScope({
        targetType,
        projectId: activeProject.id,
        blockId: targetBlockId,
        folderPath: targetFolderPath,
        selectedBlockIds: targetSelectedBlockIds,
        includeUntethered,
      });
    } finally {
      setIsRunningLoop(false);
    }
  };

  const handleStopLoop = () => {
    stopRequestedRef.current = true;
  };

  const handleDeclineAutofix = () => {
    setUserDeclinedToken(requestToken);
  };

  const toggleBlockInSelection = (id: string) => {
    const exists = targetSelectedBlockIds.includes(id);
    const nextIds = exists
      ? targetSelectedBlockIds.filter((item) => item !== id)
      : [...targetSelectedBlockIds, id];
    openAuditModal({
      targetType: 'selection',
      selectedBlockIds: nextIds,
    });
  };

  const showChoiceGate =
    !isRunningLoop &&
    !liveReport.passed &&
    !isDeclinedForRequest &&
    (!isActiveSessionForRequest || sessionResult?.status !== 'clean');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
        onClick={() => {
          if (!isRunningLoop) closeAuditModal();
        }}
        aria-label="Close audit dialog"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Project Audit & Autofix Loop"
        className="relative z-50 w-full max-w-3xl glass-menu border border-zinc-600/80 border-t-orange-500/80 rounded-xl overflow-hidden font-mono text-xs text-zinc-200 animate-panel-in flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="h-12 px-4 border-b border-zinc-700/75 glass-header flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-4 h-4 text-orange-400 shrink-0" />
            <span className="font-semibold text-zinc-100 text-sm tracking-wide truncate">
              Audit &amp; Iterative Autofix
            </span>
            <span className="text-zinc-500">/</span>
            <span className="text-orange-300 truncate">{liveReport.targetLabel}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {geminiStatus.checked && (
              <span
                className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] ${
                  geminiStatus.connected
                    ? 'bg-emerald-950/50 border-emerald-700/70 text-emerald-300'
                    : 'bg-zinc-900/80 border-zinc-700 text-zinc-400'
                }`}
                title={
                  geminiStatus.connected
                    ? `Connected to ${geminiStatus.model} via server API`
                    : 'Server GEMINI_API_KEY not set — local deterministic + compiler verification active'
                }
              >
                <Sparkles className="w-3 h-3 text-orange-400" />
                <span>
                  {geminiStatus.connected ? 'Gemini Connected' : 'Local Engine'}
                </span>
              </span>
            )}

            <button
              type="button"
              onClick={handleRunDeepAuditAndVerify}
              disabled={isRunningLoop || isRunningDeepScan}
              className="px-2.5 py-1 min-h-[30px] bg-zinc-900/80 hover:bg-zinc-800 disabled:opacity-50 border border-zinc-700 hover:border-orange-500/60 text-zinc-200 rounded transition cursor-pointer flex items-center gap-1.5"
              title="Run full syntax, compiler/VM verification, and Gemini semantic audit"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-orange-400 ${isRunningDeepScan ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">
                {isRunningDeepScan ? 'Verifying...' : 'Deep Audit'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isRunningLoop) closeAuditModal();
              }}
              disabled={isRunningLoop}
              className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-100 disabled:opacity-40 rounded hover:bg-zinc-800/80 transition cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scope Selector Bar */}
        <div className="px-4 py-2.5 border-b border-zinc-700/65 bg-zinc-950/60 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1 bg-zinc-900/90 border border-zinc-700/75 rounded-lg p-0.5">
            <button
              type="button"
              disabled={isRunningLoop}
              onClick={() => {
                setSessionResult(null);
                setLiveSteps([]);
                openAuditModal({ targetType: 'project' });
              }}
              className={`px-2.5 py-1 rounded text-[11px] transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                targetType === 'project'
                  ? 'bg-orange-500/20 text-orange-100 border border-orange-500/50 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <FolderArchive className="w-3.5 h-3.5 text-orange-400" />
              <span>Entire Project</span>
            </button>

            <button
              type="button"
              disabled={isRunningLoop || availableFolders.length === 0}
              onClick={() => {
                const folder = targetFolderPath || availableFolders[0];
                if (!folder) return;
                setSessionResult(null);
                setLiveSteps([]);
                openAuditModal({ targetType: 'folder', folderPath: folder });
              }}
              className={`px-2.5 py-1 rounded text-[11px] transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 ${
                targetType === 'folder'
                  ? 'bg-orange-500/20 text-orange-100 border border-orange-500/50 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <Folder className="w-3.5 h-3.5 text-orange-400" />
              <span>Folder</span>
            </button>

            <button
              type="button"
              disabled={isRunningLoop || selectableBlocks.length === 0}
              onClick={() => {
                setSessionResult(null);
                setLiveSteps([]);
                openAuditModal({
                  targetType: 'selection',
                  selectedBlockIds:
                    targetSelectedBlockIds.length > 0
                      ? targetSelectedBlockIds
                      : selectableBlocks.slice(0, 2).map((b) => b.id),
                });
              }}
              className={`px-2.5 py-1 rounded text-[11px] transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 ${
                targetType === 'selection'
                  ? 'bg-orange-500/20 text-orange-100 border border-orange-500/50 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5 text-orange-400" />
              <span>Selected Portion</span>
            </button>

            <button
              type="button"
              disabled={isRunningLoop || !targetBlockId}
              onClick={() => {
                if (!targetBlockId) return;
                setSessionResult(null);
                setLiveSteps([]);
                openAuditModal({ targetType: 'block', blockId: targetBlockId });
              }}
              className={`px-2.5 py-1 rounded text-[11px] transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 ${
                targetType === 'block' || targetType === 'file'
                  ? 'bg-orange-500/20 text-orange-100 border border-orange-500/50 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <FileCode className="w-3.5 h-3.5 text-orange-400" />
              <span>Single Block / File</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            {targetType === 'folder' && availableFolders.length > 0 && (
              <select
                value={targetFolderPath || availableFolders[0]}
                disabled={isRunningLoop}
                onChange={(e) =>
                  openAuditModal({ targetType: 'folder', folderPath: e.target.value })
                }
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 outline-none cursor-pointer"
                aria-label="Select folder to audit"
              >
                {availableFolders.map((fp) => (
                  <option key={fp} value={fp}>
                    {fp}/
                  </option>
                ))}
              </select>
            )}

            <label className="flex items-center gap-1.5 text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeUntethered}
                disabled={isRunningLoop}
                onChange={(e) => setIncludeUntethered(e.target.checked)}
                className="accent-orange-500 cursor-pointer"
              />
              <span>Include untethered</span>
            </label>
          </div>
        </div>

        {/* Multi-Block Selection Picker when scope === 'selection' */}
        {targetType === 'selection' && selectableBlocks.length > 0 && (
          <div className="px-4 py-2 border-b border-zinc-800/80 bg-zinc-950/75 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto shrink-0">
            {selectableBlocks.map((blk) => {
              const checked = targetSelectedBlockIds.includes(blk.id);
              return (
                <button
                  key={blk.id}
                  type="button"
                  disabled={isRunningLoop}
                  onClick={() => toggleBlockInSelection(blk.id)}
                  className={`px-2 py-0.5 rounded border text-[10px] transition cursor-pointer ${
                    checked
                      ? 'bg-orange-500/20 border-orange-500/60 text-orange-100'
                      : 'bg-zinc-900/70 border-zinc-700/70 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {checked ? '✓ ' : ''}
                  {blk.sourcePath || blk.title}
                </button>
              );
            })}
          </div>
        )}

        {/* Main Scrollable Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Status Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-zinc-950/75 p-2.5 rounded-lg border border-zinc-700/75">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                Files Audited
              </div>
              <div className="text-base font-bold text-zinc-100 mt-0.5 tabular-nums">
                {liveReport.filesAudited}
              </div>
            </div>

            <div className="bg-zinc-950/75 p-2.5 rounded-lg border border-zinc-700/75">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                Errors
              </div>
              <div
                className={`text-base font-bold mt-0.5 tabular-nums ${
                  liveReport.errorCount > 0 ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {liveReport.errorCount}
              </div>
            </div>

            <div className="bg-zinc-950/75 p-2.5 rounded-lg border border-zinc-700/75">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                Warnings
              </div>
              <div
                className={`text-base font-bold mt-0.5 tabular-nums ${
                  liveReport.warningCount > 0 ? 'text-amber-400' : 'text-zinc-300'
                }`}
              >
                {liveReport.warningCount}
              </div>
            </div>

            <div className="bg-zinc-950/75 p-2.5 rounded-lg border border-zinc-700/75">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                Testability
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
                {liveReport.testable ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-emerald-300">Provably Sound</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="text-red-300">Blocked</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Compiler, Runtime & Gemini Verification Proof Strip */}
          {displayVerification && (
            <div className="p-2.5 rounded-lg bg-zinc-950/70 border border-zinc-700/75 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1 text-zinc-300">
                  <Cpu className="w-3.5 h-3.5 text-orange-400" />
                  <span>
                    Compile: {displayVerification.compiledCleanly ? 'Pass' : 'Fail'}
                  </span>
                </span>
                <span className="text-zinc-400">
                  Types: {displayVerification.typeCheckedCleanly ? 'Pass' : 'Fail'}
                </span>
                <span className="text-zinc-400">
                  Runtime: {displayVerification.runtimeVerified ? 'Verified' : 'Pending'}
                </span>
                {displayVerification.geminiAudited && (
                  <span className="text-emerald-300 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-orange-400" />
                    <span>Gemini Verified</span>
                  </span>
                )}
              </div>
              {displayVerification.checksRun.length > 0 && (
                <span className="text-[10px] text-zinc-500 truncate max-w-full">
                  Checks: {displayVerification.checksRun.join(' · ')}
                </span>
              )}
            </div>
          )}

          {activeDeepScan?.note && (
            <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-700/60 text-[11px] text-amber-200">
              {activeDeepScan.note}
            </div>
          )}

          {/* Engine Verification & Autofix Controls */}
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-300 px-1">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useDeepCompilerVerify}
                disabled={isRunningLoop}
                onChange={(e) => setUseDeepCompilerVerify(e.target.checked)}
                className="accent-orange-500 cursor-pointer"
              />
              <span>TS Compiler &amp; VM Execution Proof</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useGeminiAudit}
                disabled={isRunningLoop}
                onChange={(e) => setUseGeminiAudit(e.target.checked)}
                className="accent-orange-500 cursor-pointer"
              />
              <span>Gemini AI Semantic Audit &amp; Repair</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useWebGrounding}
                disabled={isRunningLoop}
                onChange={(e) => setUseWebGrounding(e.target.checked)}
                className="accent-orange-500 cursor-pointer"
              />
              <Globe className="w-3 h-3 text-orange-400" />
              <span>Web Grounding for Knowledge Gaps</span>
            </label>
          </div>

          {/* Explicit User Choice Gate */}
          {showChoiceGate && (
            <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-orange-500/60 space-y-2.5">
              <div className="space-y-1">
                <div className="font-semibold text-orange-200 flex items-center gap-1.5">
                  <Wrench className="w-4 h-4 text-orange-400 shrink-0" />
                  <span>Start continuous Autofix &amp; Re-audit Loop?</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Applies minimal, intent-preserving edits one batch at a time and re-audits after
                  every fix until zero errors remain and compiler/runtime verification confirms the
                  code is testable.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={handleDeclineAutofix}
                  className="px-3 py-1.5 min-h-[34px] bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition cursor-pointer"
                >
                  Keep Code Unchanged
                </button>
                <button
                  type="button"
                  onClick={handleConsentAndRunAutofix}
                  className="px-3.5 py-1.5 min-h-[34px] bg-orange-500/25 hover:bg-orange-500/35 border border-orange-500/80 text-orange-100 hover:text-white rounded font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Wrench className="w-3.5 h-3.5 text-orange-400" />
                  <span>Apply Autofix &amp; Re-audit Loop</span>
                </button>
              </div>
            </div>
          )}

          {isDeclinedForRequest && !liveReport.passed && (
            <div className="p-3 rounded-lg bg-zinc-950/75 border border-zinc-700/80 flex items-center justify-between gap-3 text-[11px] text-zinc-300">
              <span>Auto-correction declined for this session. Existing code was left unchanged.</span>
              <button
                type="button"
                onClick={() => setUserDeclinedToken(null)}
                className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-zinc-200 cursor-pointer shrink-0"
              >
                Re-consider Autofix
              </button>
            </div>
          )}

          {/* Active Running Progress / Stop Bar */}
          {isRunningLoop && (
            <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-orange-200">
                <RefreshCw className="w-4 h-4 text-orange-400 animate-spin shrink-0" />
                <span>
                  Running Audit → Fix → Verify → Re-audit loop ({liveSteps.length} step
                  {liveSteps.length === 1 ? '' : 's'})...
                </span>
              </div>
              <button
                type="button"
                onClick={handleStopLoop}
                className="px-3 py-1.5 bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-200 rounded font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Stop Loop</span>
              </button>
            </div>
          )}

          {/* Clean Success Callout */}
          {liveReport.passed && liveReport.filesAudited > 0 && (
            <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-700/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Target parses, compiles cleanly with 0 errors, and is ready for testing or export.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  void exportProjectToZip(activeProject, blocks, { includeUntethered });
                }}
                className="px-3 py-1.5 bg-emerald-900/70 hover:bg-emerald-800 border border-emerald-600 text-emerald-100 rounded font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Clean .zip</span>
              </button>
            </div>
          )}

          {/* Explicit Knowledge Gaps Section */}
          {liveReport.knowledgeGaps.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-orange-400" />
                <span>Recognized Knowledge Gaps ({liveReport.knowledgeGaps.length})</span>
              </div>
              <div className="bg-zinc-950/75 border border-zinc-700/75 rounded-lg divide-y divide-zinc-800/80">
                {liveReport.knowledgeGaps.map((gap) => (
                  <div key={gap.id} className="p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-zinc-200 font-semibold">
                      <span className="truncate">{gap.file}</span>
                      <span className="text-[10px] text-orange-300 shrink-0">
                        {gap.language}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">{gap.reason}</p>
                    <div className="text-[10px] text-zinc-500">
                      Search focus: {gap.suggestedQuery}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Findings List Grouped by File */}
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400 flex items-center justify-between">
              <span>Structured Audit Findings ({liveReport.findings.length})</span>
              <span className="text-zinc-500">Click Edit to inspect line in editor</span>
            </div>

            {liveReport.findings.length === 0 ? (
              <div className="p-4 bg-zinc-950/70 border border-zinc-800 rounded-lg text-center text-zinc-400">
                {liveReport.filesAudited === 0
                  ? 'No text or code files found in the selected target.'
                  : 'No syntax, logical, type, import, or structural errors detected.'}
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto bg-zinc-950/75 border border-zinc-700/75 rounded-lg divide-y divide-zinc-800/80">
                {liveReport.findings.map((finding) => {
                  const isErr = finding.severity === 'error';
                  return (
                    <div
                      key={finding.id}
                      className="px-3 py-2 flex items-start justify-between gap-3 hover:bg-zinc-900/70 transition"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {isErr ? (
                          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                            <span className="text-zinc-100 font-semibold">
                              {finding.file || 'Untitled'}
                            </span>
                            <span className="text-zinc-500 tabular-nums">
                              L{finding.line ?? 1}:{finding.column ?? 1}
                            </span>
                            <span className="text-zinc-500">{finding.ruleId}</span>
                            {finding.category && (
                              <span className="text-zinc-400">[{finding.category}]</span>
                            )}
                            {finding.fixable && (
                              <span className="text-orange-300">auto-fixable</span>
                            )}
                          </div>
                          <div className="text-zinc-300">{finding.message}</div>
                          {finding.suggestion && (
                            <div className="text-[10px] text-zinc-500">
                              Suggestion: {finding.suggestion}
                            </div>
                          )}
                        </div>
                      </div>

                      {finding.blockId && (
                        <button
                          type="button"
                          onClick={() => {
                            closeAuditModal();
                            openBlockInEditor(finding.blockId!);
                          }}
                          className="px-2 py-1 text-[10px] bg-zinc-900 hover:bg-orange-500/20 border border-zinc-700 hover:border-orange-500/60 text-zinc-300 hover:text-white rounded transition cursor-pointer shrink-0"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Iteration Progress Log & Web Grounding Citations */}
          {activeSteps.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400">
                Autofix &amp; Re-audit Loop Log ({activeSteps.length} step{activeSteps.length === 1 ? '' : 's'})
              </div>
              <div className="max-h-44 overflow-y-auto bg-zinc-950/80 border border-zinc-700/75 rounded-lg p-2.5 space-y-1.5">
                {activeSteps.map((step) => (
                  <div
                    key={step.id}
                    className="flex items-start gap-2 text-[11px] leading-snug"
                  >
                    <span className="text-zinc-500 tabular-nums shrink-0">
                      #{step.iteration}
                    </span>
                    <span
                      className={`uppercase text-[10px] font-semibold shrink-0 w-24 ${
                        step.phase === 'clean'
                          ? 'text-emerald-400'
                          : step.phase === 'fix'
                          ? 'text-orange-300'
                          : step.phase === 'web-search' || step.phase === 'gemini-audit'
                          ? 'text-sky-300'
                          : step.phase === 'verify'
                          ? 'text-emerald-300'
                          : step.phase === 'unresolved' || step.phase === 'stopped'
                          ? 'text-amber-300'
                          : 'text-zinc-400'
                      }`}
                    >
                      {step.phase}
                    </span>
                    <span className="text-zinc-200">{step.message}</span>
                  </div>
                ))}
              </div>

              {allWebSources.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                    <Globe className="w-3 h-3 text-orange-400" />
                    <span>Authoritative Web References Consulted</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allWebSources.map((src) => (
                      <a
                        key={src.uri}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-orange-500/60 rounded text-[11px] text-orange-200 hover:text-white transition"
                      >
                        <ExternalLink className="w-3 h-3 text-orange-400 shrink-0" />
                        <span className="truncate max-w-[220px]">{src.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-11 px-4 border-t border-zinc-700/75 glass-header flex items-center justify-between text-zinc-400 text-[11px] shrink-0">
          <span>Audits live seed structure · Gemini + Compiler/VM verification</span>
          <button
            type="button"
            disabled={isRunningLoop}
            onClick={closeAuditModal}
            className="px-3 py-1 bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-600/70 text-zinc-200 rounded transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
