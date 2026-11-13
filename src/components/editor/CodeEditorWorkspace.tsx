'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { EditorTabs } from './EditorTabs';
import { ModularCodeSection } from './ModularCodeSection';
import { FindReplaceBar } from './FindReplaceBar';
import { analyzeCodeStructure } from '../../lib/codeStructure';
import { computeContentHash } from '../../lib/hash';
import { getFileTypeInfo } from '../../lib/fileTypes';
import { UniversalBlockViewer } from '../viewer/UniversalBlockViewer';
import {
  createAuditHighlightExtension,
  setAuditFindingsEffect,
} from '../../lib/cmAuditExtension';
import type {
  AuditFinding,
  CodeBlockData,
  FileBlockData,
  TextBlockData,
} from '../../types/model';
import {
  Save,
  Camera,
  Search,
  FileCode,
  LayoutList,
  AlignLeft,
  Eye,
  MoreHorizontal,
  ChevronsDown,
  ChevronsUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  Scissors,
  X,
  PanelRight,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

function getLanguageExtension(lang: string, path?: string) {
  const ext = path?.split('.').pop()?.toLowerCase();
  const resolved = ext || lang.toLowerCase();
  switch (resolved) {
    case 'jsx':
      return javascript({ jsx: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'typescript':
    case 'ts':
      return javascript({ typescript: true });
    case 'javascript':
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'html':
    case 'htm':
      return html();
    case 'css':
      return css();
    case 'json':
      return json();
    case 'markdown':
    case 'md':
      return markdown();
    default:
      return javascript();
  }
}

interface CodeEditorWorkspaceProps {
  onClose?: () => void;
}

export function CodeEditorWorkspace({ onClose }: CodeEditorWorkspaceProps) {
  const blocks = useWorkspaceStore((s) => s.blocks);
  const projects = useWorkspaceStore((s) => s.projects);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeEditorBlockId = useWorkspaceStore((s) => s.activeEditorBlockId);
  const openBlockIds = useWorkspaceStore((s) => s.openBlockIds);
  const setActiveEditorBlockId = useWorkspaceStore((s) => s.setActiveEditorBlockId);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const closeBlockTab = useWorkspaceStore((s) => s.closeBlockTab);
  const closeOtherTabs = useWorkspaceStore((s) => s.closeOtherTabs);
  const closeEditorModal = useWorkspaceStore((s) => s.closeEditorModal);
  const saveCodeDraft = useWorkspaceStore((s) => s.saveCodeDraft);
  const createCodeSnapshot = useWorkspaceStore((s) => s.createCodeSnapshot);
  const updateBlockData = useWorkspaceStore((s) => s.updateBlockData);
  const auditBlock = useWorkspaceStore((s) => s.auditBlock);
  const snipOldBlock = useWorkspaceStore((s) => s.snipOldBlock);
  const isInspectorCollapsed = useWorkspaceStore((s) => s.isInspectorCollapsed);
  const toggleInspector = useWorkspaceStore((s) => s.toggleInspector);

  const activeBlock = blocks.find((b) => b.id === activeEditorBlockId);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const sourceBlock = activeBlock?.copiedFromBlockId
    ? blocks.find((b) => b.id === activeBlock.copiedFromBlockId)
    : undefined;

  // Editor mode: 'modular' (modular collapsible sections), 'unified' (raw CodeMirror), or 'preview' (rendered HTML/MD/SVG/CSV)
  const [editorMode, setEditorMode] = useState<'modular' | 'unified' | 'preview'>('modular');

  // Buffer state per block ID
  const [draftByBlockId, setDraftByBlockId] = useState<Record<string, string>>({});
  const [dirtyBlockIds, setDirtyBlockIds] = useState<Set<string>>(new Set());
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set());
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [isPromptingSnapshot, setIsPromptingSnapshot] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isSnipping, setIsSnipping] = useState(false);
  const [snipMessage, setSnipMessage] = useState<{
    blockId: string;
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [showFindingsPanel, setShowFindingsPanel] = useState(false);
  const [isFindingsCollapsed, setIsFindingsCollapsed] = useState(false);
  const [jumpToLineRequest, setJumpToLineRequest] = useState<{ line: number; token: number } | null>(
    null
  );
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    if (isMoreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMoreMenuOpen]);

  // CodeMirror refs for unified view
  const unifiedContainerRef = useRef<HTMLDivElement>(null);
  const unifiedViewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());

  // Current block content and language
  const originalContent = useMemo(() => {
    if (!activeBlock) return '';
    if (activeBlock.kind === 'code') {
      return (activeBlock.data as CodeBlockData)?.currentContent || '';
    }
    if (activeBlock.kind === 'text') {
      return (activeBlock.data as TextBlockData)?.content || '';
    }
    if (activeBlock.kind === 'file') {
      return (activeBlock.data as FileBlockData)?.content || '';
    }
    return '';
  }, [activeBlock]);

  const draftContent = activeBlock ? (draftByBlockId[activeBlock.id] ?? originalContent) : '';

  const blockPath = useMemo(() => {
    if (!activeBlock) return '';
    return (
      activeBlock.sourcePath ||
      (activeBlock.data as { path?: string })?.path ||
      activeBlock.title
    );
  }, [activeBlock]);

  const language = useMemo(() => {
    if (!activeBlock) return 'javascript';
    if (activeBlock.kind === 'code') {
      return (activeBlock.data as CodeBlockData)?.language || 'javascript';
    }
    const ext = activeBlock.title.split('.').pop()?.toLowerCase();
    if (ext === 'json') return 'json';
    if (ext === 'ts' || ext === 'tsx') return 'typescript';
    if (ext === 'html' || ext === 'htm') return 'html';
    if (ext === 'css') return 'css';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    return 'javascript';
  }, [activeBlock]);

  const fileInfo = useMemo(() => {
    if (!activeBlock) return null;
    const fData = activeBlock.kind === 'file' ? (activeBlock.data as FileBlockData) : undefined;
    const cData = activeBlock.kind === 'code' ? (activeBlock.data as CodeBlockData) : undefined;
    return getFileTypeInfo({
      title: activeBlock.title,
      kind: activeBlock.kind,
      mimeType: fData?.mimeType,
      binary: fData?.binary,
      isPdf: fData?.isPdf,
      language: cData?.language,
    });
  }, [activeBlock]);

  const isTextEditable = fileInfo?.isTextEditable ?? true;
  const effectiveMode =
    !isTextEditable
      ? 'preview'
      : editorMode === 'preview' && !fileInfo?.hasRenderedPreview
      ? 'modular'
      : editorMode;

  // Audit status computation bound to exact current draft hash
  const currentHash = useMemo(() => computeContentHash(draftContent), [draftContent]);
  const findings: AuditFinding[] = useMemo(
    () => activeBlock?.lastAuditFindings ?? [],
    [activeBlock?.lastAuditFindings]
  );
  const isAuditFresh = Boolean(
    activeBlock?.lastAuditHash && activeBlock.lastAuditHash === currentHash
  );
  const isAuditPassed = isAuditFresh && activeBlock?.lastAuditStatus === 'passed';
  const isAuditFailed = isAuditFresh && activeBlock?.lastAuditStatus === 'failed';
  const isAuditStale = Boolean(activeBlock?.lastAuditHash && !isAuditFresh);

  const errorCount = useMemo(
    () => findings.filter((f) => f.severity === 'error').length,
    [findings]
  );
  const warningCount = useMemo(
    () => findings.filter((f) => f.severity === 'warning').length,
    [findings]
  );

  // Detect modular code sections
  const { sections } = useMemo(() => {
    return analyzeCodeStructure(draftContent, language);
  }, [draftContent, language]);

  // Handle section content edit from a modular section
  const handleSectionContentChange = useCallback(
    (sectionId: string, newContent: string) => {
      if (!activeBlock) return;
      const updated = sections.map((s) => (s.id === sectionId ? { ...s, content: newContent } : s));
      const combined = updated.map((s) => s.content).join('\n');
      setDraftByBlockId((prev) => ({ ...prev, [activeBlock.id]: combined }));
      setDirtyBlockIds((prev) => {
        const next = new Set(prev);
        if (combined !== originalContent) next.add(activeBlock.id);
        else next.delete(activeBlock.id);
        return next;
      });
    },
    [activeBlock, sections, originalContent]
  );

  // Initialize unified CodeMirror when unified mode is active
  useEffect(() => {
    if (effectiveMode !== 'unified' || !unifiedContainerRef.current || !activeBlock || !isTextEditable) return;

    if (unifiedViewRef.current) {
      unifiedViewRef.current.destroy();
      unifiedViewRef.current = null;
    }

    const initialText = draftByBlockId[activeBlock.id] ?? originalContent;

    const startState = EditorState.create({
      doc: initialText,
      extensions: [
        basicSetup,
        oneDark,
        languageCompartment.current.of(getLanguageExtension(language, blockPath)),
        createAuditHighlightExtension(findings),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const nextText = update.state.doc.toString();
            setDraftByBlockId((prev) => ({ ...prev, [activeBlock.id]: nextText }));
            setDirtyBlockIds((prev) => {
              const next = new Set(prev);
              if (nextText !== originalContent) {
                next.add(activeBlock.id);
              } else {
                next.delete(activeBlock.id);
              }
              return next;
            });
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '13px',
            fontFamily: 'monospace',
            backgroundColor: '#0B0D0E',
          },
          '.cm-scroller': { overflow: 'auto', minHeight: '100%' },
          '.cm-gutters': {
            backgroundColor: '#0E1013',
            color: '#52525b',
            borderRight: '1px solid #1f242d',
          },
          '.cm-activeLine': {
            backgroundColor: '#161922',
          },
          '.cm-activeLineGutter': {
            backgroundColor: '#1a1e28',
            color: '#93c5fd',
          },
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: unifiedContainerRef.current,
    });

    unifiedViewRef.current = view;

    return () => {
      view.destroy();
      unifiedViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMode, activeBlock?.id, isTextEditable]);

  // Synchronize unified view if draft changed while in modular mode
  useEffect(() => {
    if (effectiveMode === 'unified' && unifiedViewRef.current) {
      const cur = unifiedViewRef.current.state.doc.toString();
      if (cur !== draftContent) {
        unifiedViewRef.current.dispatch({
          changes: { from: 0, to: cur.length, insert: draftContent },
        });
      }
    }
  }, [draftContent, effectiveMode]);

  // Sync audit findings highlights into unified CodeMirror view
  useEffect(() => {
    if (effectiveMode === 'unified' && unifiedViewRef.current) {
      unifiedViewRef.current.dispatch({
        effects: setAuditFindingsEffect.of(findings),
      });
    }
  }, [findings, effectiveMode]);

  // Jump to line inside unified CodeMirror view
  useEffect(() => {
    if (effectiveMode === 'unified' && unifiedViewRef.current && jumpToLineRequest) {
      const doc = unifiedViewRef.current.state.doc;
      const clampedLine = Math.max(1, Math.min(doc.lines, jumpToLineRequest.line));
      const lineObj = doc.line(clampedLine);
      unifiedViewRef.current.dispatch({
        selection: { anchor: lineObj.from },
        effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
      });
      unifiedViewRef.current.focus();
    }
  }, [jumpToLineRequest, effectiveMode]);

  // Save handler supporting code, text, and file blocks
  const handleSave = useCallback(async () => {
    if (!activeBlock) return;
    const contentToSave = draftByBlockId[activeBlock.id] ?? originalContent;
    if (activeBlock.kind === 'code') {
      await saveCodeDraft(activeBlock.id, contentToSave);
    } else if (activeBlock.kind === 'text' || activeBlock.kind === 'file') {
      await updateBlockData(activeBlock.id, { content: contentToSave });
    }
    setDirtyBlockIds((prev) => {
      const next = new Set(prev);
      next.delete(activeBlock.id);
      return next;
    });
  }, [activeBlock, draftByBlockId, originalContent, saveCodeDraft, updateBlockData]);

  // Run code audit on active block
  const handleRunAudit = useCallback(async () => {
    if (!activeBlock || isAuditing) return;
    setIsAuditing(true);
    setSnipMessage(null);
    try {
      const result = await auditBlock(activeBlock.id, draftContent);
      setDirtyBlockIds((prev) => {
        const next = new Set(prev);
        next.delete(activeBlock.id);
        return next;
      });
      if (result.findings.length > 0) {
        setShowFindingsPanel(true);
        setIsFindingsCollapsed(false);
        // Auto-expand any collapsed modular sections that contain errors/warnings
        setCollapsedSectionIds((prev) => {
          const next = new Set(prev);
          for (const f of result.findings) {
            const line = f.line ?? 0;
            const targetSec = sections.find((s) => line >= s.startLine && line <= s.endLine);
            if (targetSec) next.delete(targetSec.id);
          }
          return next;
        });
        const firstFinding = result.findings[0];
        if (firstFinding?.line) {
          setJumpToLineRequest({ line: firstFinding.line, token: Date.now() });
        }
      } else {
        setShowFindingsPanel(false);
      }
    } finally {
      setIsAuditing(false);
    }
  }, [activeBlock, isAuditing, auditBlock, draftContent, sections]);

  const handleJumpToFinding = useCallback(
    (finding: AuditFinding) => {
      const targetLine = finding.line ?? 1;
      const targetSec = sections.find(
        (s) => targetLine >= s.startLine && targetLine <= s.endLine
      );
      if (targetSec) {
        setCollapsedSectionIds((prev) => {
          if (!prev.has(targetSec.id)) return prev;
          const next = new Set(prev);
          next.delete(targetSec.id);
          return next;
        });
      }
      setJumpToLineRequest({ line: targetLine, token: Date.now() });
    },
    [sections]
  );

  const handleSnipOldBlock = useCallback(async () => {
    if (!activeBlock || isSnipping) return;
    setIsSnipping(true);
    setSnipMessage(null);
    try {
      const res = await snipOldBlock(activeBlock.id);
      if (!res.success) {
        setSnipMessage({
          blockId: activeBlock.id,
          type: 'error',
          text: res.error || 'Audit must pass with 0 errors before snipping the old block.',
        });
      } else {
        setSnipMessage({
          blockId: activeBlock.id,
          type: 'success',
          text: `Snipped old block and tethered new block (${res.transferredTetherCount} tether${
            res.transferredTetherCount === 1 ? '' : 's'
          } transferred).`,
        });
      }
    } finally {
      setIsSnipping(false);
    }
  }, [activeBlock, isSnipping, snipOldBlock]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowFindReplace((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  const handleCreateSnapshot = async () => {
    if (!activeBlock || activeBlock.kind !== 'code') return;
    const finalLabel = snapshotLabel.trim() || 'snapshot';
    await createCodeSnapshot(activeBlock.id, finalLabel);
    setSnapshotLabel('');
    setIsPromptingSnapshot(false);
  };

  // Section toggle handlers
  const handleToggleSection = (sectionId: string) => {
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const handleExpandAll = () => setCollapsedSectionIds(new Set());
  const handleCollapseAll = () => {
    setCollapsedSectionIds(new Set(sections.map((s) => s.id)));
  };

  // Breadcrumbs calculation
  const breadcrumbSegments = useMemo(() => {
    const list: string[] = [activeProject ? activeProject.name : 'Workspace'];
    if (activeBlock) {
      const rawPath = blockPath || activeBlock.title;
      const parts = rawPath.replace(/^\/+/, '').split('/');
      list.push(...parts);
    }
    return list;
  }, [activeProject, activeBlock, blockPath]);

  const handleCloseEditor = () => {
    if (onClose) onClose();
    else closeEditorModal();
  };

  if (!activeBlock) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0B0D0E] text-zinc-500 font-mono text-xs select-none p-6">
        <FileCode className="w-12 h-12 text-zinc-700 mb-3" />
        <p className="text-zinc-300 font-medium">No block open in editor</p>
        <p className="text-zinc-600 mt-1 text-center">
          Select any block on the canvas or hierarchy to edit.
        </p>
        <button
          type="button"
          onClick={handleCloseEditor}
          className="mt-4 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 rounded transition cursor-pointer"
        >
          Back to Canvas
        </button>
      </div>
    );
  }

  const isDirty = dirtyBlockIds.has(activeBlock.id);
  const isCopiedDraft = Boolean(activeBlock.copiedFromBlockId);
  const activeSnipMessage =
    snipMessage && snipMessage.blockId === activeBlock.id ? snipMessage : null;

  return (
    <div
      className="flex-1 flex flex-col min-w-0 h-full bg-[#090B0E]/90 overflow-hidden"
      role="region"
      aria-label="Block Editor"
    >
      {/* 1. File Tabs */}
      <EditorTabs
        openBlockIds={openBlockIds}
        activeId={activeEditorBlockId}
        dirtyBlockIds={dirtyBlockIds}
        onSelectTab={setActiveEditorBlockId}
        onCloseTab={closeBlockTab}
        onCloseOthers={closeOtherTabs}
      />

      {/* 2. Breadcrumb & Action Toolbar */}
      <div className="border-b border-zinc-700/75 glass-header select-none flex-shrink-0 text-xs font-mono">
        <div className="flex items-center justify-between px-3 h-11 sm:h-10 gap-2">
          {/* File Name & Path */}
          <div className="flex items-center gap-1.5 text-zinc-400 min-w-0 truncate">
            <div className="hidden sm:flex items-center gap-1.5 truncate">
              {breadcrumbSegments.map((seg, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-zinc-600">/</span>}
                  <span
                    className={
                      idx === breadcrumbSegments.length - 1
                        ? 'text-zinc-100 font-semibold truncate'
                        : 'text-zinc-400 hover:text-zinc-200 transition truncate'
                    }
                  >
                    {seg}
                  </span>
                </React.Fragment>
              ))}
            </div>

            <div className="sm:hidden flex items-center gap-1 font-semibold text-zinc-100 truncate text-xs">
              <span className="truncate">{activeBlock.title}</span>
            </div>

            {isDirty && (
              <span className="text-orange-400 font-semibold text-[11px] ml-1 flex-shrink-0 flex items-center gap-1 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                <span className="hidden sm:inline">unsaved</span>
              </span>
            )}
          </div>

          {/* Toolbar Controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {fileInfo && !isTextEditable && (
              <span
                className={`text-[10px] font-mono font-semibold px-2 py-1 rounded border ${fileInfo.badgeClass}`}
              >
                {fileInfo.label}
              </span>
            )}

            {/* View Mode Toggle: Sections / Raw / Rendered Preview */}
            {isTextEditable && (
              <div className="flex items-center bg-zinc-950/80 border border-zinc-700/80 rounded p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setEditorMode('modular')}
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded transition cursor-pointer whitespace-nowrap shrink-0 border ${
                    effectiveMode === 'modular'
                      ? 'bg-orange-500/15 border-orange-500/40 text-zinc-100 font-semibold'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Modular Collapsible Sections View"
                >
                  <LayoutList className={`w-3.5 h-3.5 ${effectiveMode === 'modular' ? 'text-orange-400' : 'text-zinc-400'}`} />
                  <span className="hidden sm:inline">Sections</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditorMode('unified')}
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded transition cursor-pointer whitespace-nowrap shrink-0 border ${
                    effectiveMode === 'unified'
                      ? 'bg-orange-500/15 border-orange-500/40 text-zinc-100 font-semibold'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Continuous Raw Code View"
                >
                  <AlignLeft className={`w-3.5 h-3.5 ${effectiveMode === 'unified' ? 'text-orange-400' : 'text-zinc-400'}`} />
                  <span className="hidden sm:inline">Raw</span>
                </button>
                {fileInfo?.hasRenderedPreview && (
                  <button
                    type="button"
                    onClick={() => setEditorMode('preview')}
                    className={`flex items-center gap-1 px-2.5 py-0.5 rounded transition cursor-pointer whitespace-nowrap shrink-0 border ${
                      effectiveMode === 'preview'
                        ? 'bg-orange-500/15 border-orange-500/40 text-zinc-100 font-semibold'
                        : 'border-transparent text-zinc-400 hover:text-zinc-200'
                    }`}
                    title={`Rendered ${fileInfo.label} preview`}
                  >
                    <Eye className={`w-3.5 h-3.5 ${effectiveMode === 'preview' ? 'text-orange-400' : 'text-zinc-400'}`} />
                    <span className="hidden sm:inline">Preview</span>
                  </button>
                )}
              </div>
            )}

            {/* Run Audit Button */}
            {isTextEditable && (
              <button
                type="button"
                onClick={handleRunAudit}
                disabled={isAuditing}
                className={`flex items-center gap-1.5 px-2.5 py-1 min-h-[30px] rounded text-xs transition cursor-pointer whitespace-nowrap shrink-0 border font-medium ${
                  isAuditPassed
                    ? 'bg-emerald-950/60 border-emerald-700/80 text-emerald-300 hover:bg-emerald-900/60'
                    : isAuditFailed
                    ? 'bg-red-950/70 border-red-700/80 text-red-200 hover:bg-red-900/70'
                    : 'bg-orange-500/20 border-orange-500/70 text-orange-100 hover:bg-orange-500/30'
                }`}
                title="Run code audit and highlight errors"
              >
                {isAuditing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )}
                <span>{isAuditing ? 'Auditing...' : 'Audit'}</span>
                {findings.length > 0 && (
                  <span className="tabular-nums text-[10px] font-semibold opacity-90">
                    ({errorCount > 0 ? `${errorCount}E` : `${warningCount}W`})
                  </span>
                )}
              </button>
            )}

            {/* Find & Replace Toggle */}
            {isTextEditable && (
              <button
                type="button"
                onClick={() => setShowFindReplace(!showFindReplace)}
                className={`w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer ${
                  showFindReplace ? 'bg-zinc-800 text-zinc-100' : ''
                }`}
                title="Find & Replace (Ctrl+F)"
                aria-label="Find and replace"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Inspector Toggle inside modal */}
            <button
              type="button"
              onClick={toggleInspector}
              className={`hidden md:flex w-7 h-7 items-center justify-center rounded transition cursor-pointer ${
                !isInspectorCollapsed
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`}
              title={isInspectorCollapsed ? 'Show structure & history' : 'Hide inspector'}
              aria-label={isInspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
            >
              <PanelRight className="w-3.5 h-3.5" />
            </button>

            {/* More Options Expandable Menu */}
            <div className="relative" ref={moreMenuRef}>
              <button
                type="button"
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className={`w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer ${
                  isMoreMenuOpen ? 'bg-zinc-800 text-zinc-100' : ''
                }`}
                title="More file actions and section controls"
                aria-label="More file actions"
                aria-expanded={isMoreMenuOpen}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>

              {isMoreMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-52 glass-menu border border-zinc-600/80 rounded-lg p-1.5 font-mono text-xs space-y-1 z-30 animate-panel-in">
                  {editorMode === 'modular' && (
                    <>
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                        Code Sections
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          handleExpandAll();
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                      >
                        <ChevronsDown className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Expand All Sections</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          handleCollapseAll();
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                      >
                        <ChevronsUp className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Collapse All Sections</span>
                      </button>
                      <div className="border-t border-zinc-700/70 my-1" />
                    </>
                  )}

                  {activeBlock.kind === 'code' && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        setIsPromptingSnapshot(true);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-orange-500/15 rounded transition cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-orange-400" />
                      <span>Create Snapshot</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const fullPath = blockPath || activeBlock.title;
                      navigator.clipboard.writeText(fullPath);
                      setCopiedPath(true);
                      setTimeout(() => setCopiedPath(false), 1500);
                      setIsMoreMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                  >
                    {copiedPath ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                    <span>{copiedPath ? 'Path Copied!' : 'Copy File Path'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Primary Save Button */}
            {isTextEditable && (
              <button
                type="button"
                onClick={handleSave}
                disabled={!isDirty}
                className={`flex items-center gap-1.5 px-3 py-1 min-h-[30px] rounded text-xs transition cursor-pointer whitespace-nowrap shrink-0 ${
                  isDirty
                    ? 'bg-emerald-900 hover:bg-emerald-800 text-emerald-100 border border-emerald-600 font-semibold shadow-xs'
                    : 'bg-zinc-900/60 text-zinc-500 border border-zinc-800/60 cursor-not-allowed opacity-60'
                }`}
                title="Save changes (Ctrl+S)"
              >
                <Save className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Save</span>
              </button>
            )}

            {/* Close Editor Pop-up Button */}
            <button
              type="button"
              onClick={handleCloseEditor}
              className="flex items-center gap-1 px-2.5 py-1 min-h-[30px] bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-300 hover:text-white rounded text-xs transition cursor-pointer whitespace-nowrap shrink-0"
              title="Close editor & return to canvas"
              aria-label="Close editor"
            >
              <X className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Done</span>
            </button>
          </div>
        </div>
      </div>

      {/* Copied Block Audit & Snip Gate Banner */}
      {(isCopiedDraft || activeSnipMessage) && (
        <div
          className={`px-3 py-2 border-b text-xs font-mono flex flex-col sm:flex-row sm:items-center justify-between gap-2 flex-shrink-0 ${
            activeSnipMessage?.type === 'success'
              ? 'bg-emerald-950/35 border-emerald-900/70 text-emerald-200'
              : isAuditPassed
              ? 'bg-emerald-950/25 border-emerald-900/60 text-emerald-200'
              : isAuditFailed
              ? 'bg-red-950/30 border-red-900/70 text-red-200'
              : 'bg-amber-950/25 border-amber-900/60 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {activeSnipMessage?.type === 'success' || isAuditPassed ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : isAuditFailed ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            )}

            <div className="min-w-0">
              {activeSnipMessage ? (
                <span>{activeSnipMessage.text}</span>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold">
                    Copied from {sourceBlock?.title || 'original block'}
                  </span>
                  <span className="text-zinc-500">·</span>
                  {isAuditPassed ? (
                    <span className="text-emerald-300">
                      Audit passed ({warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : '0 errors'}) — ready to snip old block
                    </span>
                  ) : isAuditFailed ? (
                    <span className="text-red-300">
                      {errorCount} error{errorCount === 1 ? '' : 's'} detected — fix highlighted lines and re-audit before snipping
                    </span>
                  ) : isAuditStale ? (
                    <span className="text-amber-300">
                      Code modified since last audit — run Audit before snipping
                    </span>
                  ) : (
                    <span className="text-amber-300">
                      Run Audit to verify code before snipping old block
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {isCopiedDraft && (
            <div className="flex items-center gap-2 shrink-0">
              {!isAuditPassed && (
                <button
                  type="button"
                  onClick={handleRunAudit}
                  disabled={isAuditing}
                  className="px-3 py-1.5 min-h-[32px] bg-orange-500/20 hover:bg-orange-500/30 text-orange-100 border border-orange-500/70 rounded text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-orange-400" />
                  <span>{isAuditing ? 'Auditing...' : 'Run Audit'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSnipOldBlock}
                disabled={!isAuditPassed || isSnipping}
                title={
                  isAuditPassed
                    ? 'Delete old block, transfer all tethers here, and keep this block in its folder'
                    : 'Blocked until Audit passes with 0 errors on the current code'
                }
                className={`px-3 py-1.5 min-h-[32px] rounded text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap shrink-0 border ${
                  isAuditPassed && !isSnipping
                    ? 'bg-emerald-800 hover:bg-emerald-700 text-white border-emerald-500 cursor-pointer shadow-xs'
                    : 'bg-zinc-900/70 text-zinc-500 border-zinc-800 cursor-not-allowed'
                }`}
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>{isSnipping ? 'Snipping...' : 'Snip Old Block'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Snapshot Prompt Banner */}
      {isPromptingSnapshot && (
        <div className="p-3 glass-panel border-b border-zinc-700/80 flex flex-col sm:flex-row sm:items-center gap-2 text-xs font-mono z-20">
          <span className="text-zinc-400 flex-shrink-0">Snapshot label:</span>
          <input
            type="text"
            autoFocus
            placeholder="e.g. before-refactoring, checkpoint-1..."
            value={snapshotLabel}
            onChange={(e) => setSnapshotLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSnapshot();
              if (e.key === 'Escape') setIsPromptingSnapshot(false);
            }}
            className="flex-1 bg-zinc-950 border border-zinc-700 focus:border-orange-500/75 rounded px-2.5 py-1.5 text-base sm:text-xs text-zinc-200 outline-none min-h-[38px] sm:min-h-0"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreateSnapshot}
              className="flex-1 sm:flex-initial px-4 py-2 min-h-[40px] sm:min-h-0 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/70 text-orange-100 rounded font-semibold transition cursor-pointer"
            >
              Take Snapshot
            </button>
            <button
              type="button"
              onClick={() => setIsPromptingSnapshot(false)}
              className="px-3 py-2 min-h-[40px] sm:min-h-0 text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Find & Replace Inline Panel */}
      {showFindReplace && (
        <FindReplaceBar
          onFind={() => {}}
          onReplace={() => {}}
          onReplaceAll={() => {}}
          onNextMatch={() => {}}
          onPrevMatch={() => {}}
          onClose={() => setShowFindReplace(false)}
        />
      )}

      {/* 3. Primary Editor / Universal Viewer Surface */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#0B0D0E] flex flex-col">
        {effectiveMode === 'preview' ? (
          <UniversalBlockViewer
            block={activeBlock}
            contentOverride={isTextEditable ? draftContent : undefined}
            allBlocks={blocks}
            onOpenBlock={(targetId) => openBlockInEditor(targetId)}
          />
        ) : effectiveMode === 'modular' ? (
          <div className="space-y-1 max-w-5xl w-full mx-auto p-2 sm:p-3 pb-6">
            {sections.map((section) => (
              <ModularCodeSection
                key={section.id}
                section={section}
                language={language}
                isCollapsed={collapsedSectionIds.has(section.id)}
                onToggleCollapse={() => handleToggleSection(section.id)}
                onSectionContentChange={handleSectionContentChange}
                findings={findings}
                jumpToLineRequest={jumpToLineRequest}
              />
            ))}
          </div>
        ) : (
          <div
            ref={unifiedContainerRef}
            className="flex-1 w-full h-full bg-[#0B0D0E] overflow-hidden flex flex-col"
          />
        )}
      </div>

      {/* 4. Collapsible Audit Findings Drawer (Bottom) */}
      {(showFindingsPanel || findings.length > 0) && (
        <div
          className={`border-t border-zinc-700/80 glass-panel flex flex-col flex-shrink-0 font-mono text-xs ${
            isFindingsCollapsed ? '' : 'max-h-44'
          }`}
        >
          <div className="px-3 py-1.5 border-b border-zinc-700/70 flex items-center justify-between text-[11px] bg-zinc-950/40">
            <button
              type="button"
              onClick={() => setIsFindingsCollapsed((prev) => !prev)}
              className="flex items-center gap-2.5 text-left cursor-pointer hover:text-white transition"
            >
              {isFindingsCollapsed ? (
                <ChevronUp className="w-3.5 h-3.5 text-orange-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-orange-400" />
              )}
              <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[10px]">
                Audit Findings
              </span>
              <span className={`tabular-nums ${errorCount > 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                {errorCount} error{errorCount === 1 ? '' : 's'}
              </span>
              <span className={`tabular-nums ${warningCount > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
                {warningCount} warning{warningCount === 1 ? '' : 's'}
              </span>
              {isAuditStale && (
                <span className="text-amber-300 text-[10px]">
                  Stale (re-run Audit)
                </span>
              )}
            </button>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsFindingsCollapsed((prev) => !prev)}
                className="text-zinc-400 hover:text-zinc-200 p-0.5 cursor-pointer"
                title={isFindingsCollapsed ? 'Expand findings' : 'Collapse findings'}
                aria-label={isFindingsCollapsed ? 'Expand findings' : 'Collapse findings'}
              >
                {isFindingsCollapsed ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
              {findings.length === 0 && (
                <button
                  type="button"
                  onClick={() => setShowFindingsPanel(false)}
                  className="text-zinc-400 hover:text-zinc-200 p-0.5 cursor-pointer"
                  aria-label="Hide findings"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {!isFindingsCollapsed && (
            <div className="overflow-y-auto divide-y divide-zinc-800/50">
              {findings.length === 0 ? (
                <div className="px-3 py-2 text-emerald-400 flex items-center gap-2 text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>No errors or warnings found in current code.</span>
                </div>
              ) : (
                findings.map((finding) => {
                  const isErr = finding.severity === 'error';
                  return (
                    <button
                      key={finding.id}
                      type="button"
                      onClick={() => handleJumpToFinding(finding)}
                      className="w-full px-3 py-1.5 flex items-center justify-between gap-3 text-left hover:bg-zinc-900/80 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isErr ? (
                          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        )}
                        <span className="text-zinc-400 tabular-nums shrink-0 text-[11px]">
                          L{finding.line ?? 1}:{finding.column ?? 1}
                        </span>
                        <span className="text-zinc-200 truncate">{finding.message}</span>
                      </div>
                      <span className="text-[10px] text-zinc-500 shrink-0">{finding.ruleId}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
