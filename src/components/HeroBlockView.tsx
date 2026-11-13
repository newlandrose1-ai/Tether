'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type {
  Block,
  TextBlockData,
  FileBlockData,
  CodeBlockData,
  CodeRevision,
} from '../types/model';
import {
  FileText,
  Binary,
  Code,
  Minimize2,
  Save,
  Camera,
  History,
  RotateCcw,
  Clock,
  FileCode,
  Download,
  Sidebar,
  Eye,
  FileArchive,
} from 'lucide-react';
import { exportSingleBlock } from '../lib/exportImport';
import { formatFileSize, getFileTypeInfo } from '../lib/fileTypes';
import { UniversalBlockViewer } from './viewer/UniversalBlockViewer';

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

const SUPPORTED_LANGUAGES = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'markdown', label: 'Markdown' },
];

function getLanguageExtension(lang: string) {
  switch (lang.toLowerCase()) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'html':
      return html();
    case 'css':
      return css();
    case 'json':
      return json();
    case 'markdown':
      return markdown();
    default:
      return javascript();
  }
}

interface HeroBlockViewProps {
  onToggleInspector?: () => void;
  isInspectorOpen?: boolean;
}

export function HeroBlockView({
  onToggleInspector,
  isInspectorOpen = false,
}: HeroBlockViewProps) {
  const focusedBlockId = useWorkspaceStore((s) => s.focusedBlockId);
  const setFocusedBlockId = useWorkspaceStore((s) => s.setFocusedBlockId);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const groups = useWorkspaceStore((s) => s.groups);
  const tethers = useWorkspaceStore((s) => s.tethers);
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const updateBlockData = useWorkspaceStore((s) => s.updateBlockData);
  const saveCodeDraft = useWorkspaceStore((s) => s.saveCodeDraft);
  const createCodeSnapshot = useWorkspaceStore((s) => s.createCodeSnapshot);
  const rollbackCodeRevision = useWorkspaceStore((s) => s.rollbackCodeRevision);

  const block = blocks.find((b) => b.id === focusedBlockId);

  // Keyboard shortcut: Escape exits focus mode when focus is not inside input/textarea/codemirror
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const activeEl = document.activeElement;
        const isEditingInField =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl?.closest('.cm-content');

        if (!isEditingInField) {
          e.preventDefault();
          setFocusedBlockId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setFocusedBlockId]);

  if (!block) return null;

  const group = groups.find((g) => g.id === block.groupId);
  const accentColor = group?.color || '#f97316';
  const fileInfo = getFileTypeInfo({
    title: block.title,
    kind: block.kind,
    mimeType: block.kind === 'file' ? (block.data as FileBlockData)?.mimeType : undefined,
    binary: block.kind === 'file' ? (block.data as FileBlockData)?.binary : undefined,
    isPdf: block.kind === 'file' ? (block.data as FileBlockData)?.isPdf : undefined,
    language: block.kind === 'code' ? (block.data as CodeBlockData)?.language : undefined,
  });

  return (
    <div
      className="absolute inset-0 z-30 bg-zinc-950 flex flex-col overflow-hidden animate-in fade-in duration-150"
      role="region"
      aria-label="Focus mode hero view"
    >
      {/* Top Accent Line */}
      <div className="h-1 w-full flex-shrink-0" style={{ backgroundColor: accentColor }} />

      {/* Hero Header */}
      <div className="h-14 px-4 sm:px-6 border-b border-zinc-800/80 glass-header flex items-center justify-between select-none flex-shrink-0">
        {/* Left: Title & Badges */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1.5 bg-zinc-800 rounded border border-zinc-700/80">
            {block.kind === 'upload' && <FileArchive className="w-4 h-4 text-orange-400" />}
            {block.kind === 'text' && <FileText className="w-4 h-4 text-zinc-300" />}
            {block.kind === 'file' &&
              ((block.data as FileBlockData)?.binary ? (
                <Binary className="w-4 h-4 text-zinc-300" />
              ) : (
                <FileText className="w-4 h-4 text-zinc-300" />
              ))}
            {block.kind === 'code' && <Code className="w-4 h-4 text-orange-400" />}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold text-zinc-100 truncate max-w-md" title={block.title}>
                {block.title}
              </h2>
              <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border shrink-0 ${fileInfo.badgeClass}`}>
                {fileInfo.badge}
              </span>
            </div>

            {group && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: group.color }}
                />
                <span className="text-[11px] font-mono text-zinc-400 truncate">{group.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions & Exit Focus */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {/* Export Single Block */}
          {block.kind !== 'upload' && !(block.kind === 'file' && (block.data as FileBlockData)?.binary) && (
            <button
              type="button"
              onClick={() => exportSingleBlock(block)}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 min-h-[36px] sm:min-h-0 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 border border-zinc-700/80 rounded text-xs font-mono transition cursor-pointer"
              title="Export block content"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}

          {/* Toggle Inspector */}
          {onToggleInspector && (
            <button
              type="button"
              onClick={onToggleInspector}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[36px] sm:min-h-0 rounded text-xs font-mono transition cursor-pointer border ${
                isInspectorOpen
                  ? 'bg-zinc-800 text-zinc-100 border-zinc-600'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-zinc-800'
              }`}
              title="Toggle block inspector"
            >
              <Sidebar className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Inspector</span>
            </button>
          )}

          {/* Primary Exit Focus Action */}
          <button
            type="button"
            onClick={() => setFocusedBlockId(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] sm:min-h-0 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-600 rounded text-xs font-mono font-medium shadow transition cursor-pointer"
            title="Exit focus mode (Esc)"
          >
            <Minimize2 className="w-3.5 h-3.5 text-zinc-300" />
            <span>Exit Focus</span>
            <kbd className="hidden sm:inline text-[10px] bg-zinc-900 border border-zinc-700 px-1 py-0.2 rounded text-zinc-400 ml-1">
              Esc
            </kbd>
          </button>
        </div>
      </div>

      {/* Main Focus Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 p-2 sm:p-6 pb-16 md:pb-6 overflow-hidden">
          {block.kind === 'upload' && (
            <div className="flex-1 flex flex-col h-full max-w-5xl mx-auto w-full bg-zinc-900/50 border border-zinc-800/80 rounded-lg overflow-hidden shadow-2xl">
              <UniversalBlockViewer
                block={block}
                allBlocks={blocks}
                onOpenBlock={(targetId) => setFocusedBlockId(targetId)}
              />
            </div>
          )}

          {block.kind === 'text' && (
            <HeroTextBlock block={block as Block<TextBlockData>} onUpdateData={updateBlockData} />
          )}

          {block.kind === 'file' && (
            <HeroFileBlock
              block={block as Block<FileBlockData>}
              allBlocks={blocks}
              onOpenBlock={(targetId) => setFocusedBlockId(targetId)}
            />
          )}

          {block.kind === 'code' && (
            <HeroCodeBlock
              block={block as Block<CodeBlockData>}
              tethers={tethers}
              blocks={blocks}
              onUpdateData={updateBlockData}
              onSaveDraft={saveCodeDraft}
              onCreateSnapshot={createCodeSnapshot}
              onRollback={rollbackCodeRevision}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// HERO TEXT BLOCK
// -------------------------------------------------------------
interface HeroTextBlockProps {
  block: Block<TextBlockData>;
  onUpdateData: (id: string, patch: Record<string, unknown>) => Promise<void>;
}

function HeroTextBlock({ block, onUpdateData }: HeroTextBlockProps) {
  const content = (block.data as TextBlockData)?.content ?? '';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const wordCount = useMemo(() => {
    return content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;
  }, [content]);

  const lineCount = useMemo(() => {
    return content.length === 0 ? 0 : content.split('\n').length;
  }, [content]);

  return (
    <div className="flex-1 flex flex-col h-full max-w-5xl mx-auto w-full bg-zinc-900/50 border border-zinc-800/80 rounded-lg overflow-hidden shadow-2xl">
      {/* Subheader Toolbar */}
      <div className="px-4 py-2 border-b border-zinc-800/80 bg-zinc-900/80 flex items-center justify-between text-xs font-mono text-zinc-400">
        <span>Plain Text Editor</span>
        <div className="flex items-center gap-3 text-[11px]">
          <span>{lineCount} lines</span>
          <span>•</span>
          <span>{wordCount} words</span>
          <span>•</span>
          <span>{content.length} characters</span>
        </div>
      </div>

      {/* Spacious Writing Area */}
      <div className="flex-1 p-4 bg-zinc-950 overflow-hidden flex flex-col">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onUpdateData(block.id, { content: e.target.value })}
          placeholder="Start typing or paste notes, requirements, or documentation..."
          autoFocus
          className="flex-1 w-full bg-transparent text-sm font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none resize-none leading-relaxed select-text"
        />
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-zinc-800/80 bg-zinc-900/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
        <span>Changes persist locally in IndexedDB</span>
        <span>Markdown or plain text</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// HERO FILE BLOCK
// -------------------------------------------------------------
interface HeroFileBlockProps {
  block: Block<FileBlockData>;
  allBlocks: Block[];
  onOpenBlock: (id: string) => void;
}

function HeroFileBlock({ block, allBlocks, onOpenBlock }: HeroFileBlockProps) {
  const data = block.data as FileBlockData;
  const content = data?.content ?? '';
  const info = getFileTypeInfo({
    title: block.title,
    kind: block.kind,
    mimeType: data?.mimeType,
    binary: data?.binary,
    isPdf: data?.isPdf,
  });
  const [viewSource, setViewSource] = useState(false);

  return (
    <div className="flex-1 flex flex-col h-full max-w-5xl mx-auto w-full bg-zinc-900/50 border border-zinc-800/80 rounded-lg overflow-hidden shadow-2xl">
      {/* Compact Metadata Header */}
      <div className="px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-900/80 flex items-center justify-between text-xs font-mono gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-zinc-400">Path:</span>
          <span className="text-zinc-200 truncate">{data?.path || block.title}</span>
        </div>
        <div className="flex items-center gap-3 text-zinc-400 text-[11px] flex-shrink-0">
          {info.isTextEditable && info.hasRenderedPreview && (
            <button
              type="button"
              onClick={() => setViewSource((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 cursor-pointer"
            >
              <Eye className="w-3 h-3 text-orange-400" />
              <span>{viewSource ? 'Rendered' : 'Source'}</span>
            </button>
          )}
          <span>{formatFileSize(data?.size ?? 0)}</span>
          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${info.badgeClass}`}>
            {info.badge}
          </span>
        </div>
      </div>

      {/* Universal Body */}
      {info.isTextEditable && viewSource ? (
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          <div className="px-4 py-1.5 border-b border-zinc-800/60 bg-zinc-900/40 text-[11px] font-mono text-zinc-400 flex items-center justify-between">
            <span>File Source (Read-Only)</span>
            <span>{content.length} characters</span>
          </div>
          <pre className="flex-1 p-4 text-xs font-mono text-zinc-200 overflow-auto whitespace-pre-wrap select-text leading-relaxed">
            {content || <span className="text-zinc-400 italic">Empty file</span>}
          </pre>
        </div>
      ) : (
        <UniversalBlockViewer
          block={block}
          allBlocks={allBlocks}
          onOpenBlock={onOpenBlock}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// HERO CODE BLOCK
// -------------------------------------------------------------
interface HeroCodeBlockProps {
  block: Block<CodeBlockData>;
  tethers: { sourceBlockId: string; targetBlockId: string; projectId: string; groupId: string }[];
  blocks: Block[];
  onUpdateData: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onSaveDraft: (id: string, content: string) => Promise<void>;
  onCreateSnapshot: (id: string, label: string) => Promise<void>;
  onRollback: (id: string, revisionId: string) => Promise<void>;
}

function HeroCodeBlock({
  block,
  tethers,
  blocks,
  onUpdateData,
  onSaveDraft,
  onCreateSnapshot,
  onRollback,
}: HeroCodeBlockProps) {
  const data = block.data as CodeBlockData;
  const currentContent = data?.currentContent ?? '';
  const revisions = data?.revisions ?? [];
  const language = data?.language ?? 'javascript';

  const [draftContent, setDraftContent] = useState(currentContent);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [isPromptingSnapshot, setIsPromptingSnapshot] = useState(false);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());

  // Incoming tethered File blocks
  const incomingFileSources = useMemo(() => {
    const incomingTethers = tethers.filter(
      (t) =>
        t.targetBlockId === block.id &&
        t.projectId === block.projectId &&
        t.groupId === block.groupId
    );
    return incomingTethers
      .map((t) => {
        const sourceBlock = blocks.find((b) => b.id === t.sourceBlockId);
        return sourceBlock?.kind === 'file' ? sourceBlock : null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
  }, [tethers, blocks, block.id, block.projectId, block.groupId]);

  // Sync draftContent if currentContent changes externally (e.g. from rollback)
  useEffect(() => {
    if (editorViewRef.current) {
      const editorText = editorViewRef.current.state.doc.toString();
      if (editorText !== currentContent) {
        editorViewRef.current.dispatch({
          changes: { from: 0, to: editorText.length, insert: currentContent },
        });
        setDraftContent(currentContent);
      }
    }
  }, [currentContent]);

  // Initialize CodeMirror 6 in Hero View
  useEffect(() => {
    if (!editorContainerRef.current) return;

    const startState = EditorState.create({
      doc: currentContent,
      extensions: [
        basicSetup,
        oneDark,
        languageCompartment.current.of(getLanguageExtension(language)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setDraftContent(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '13px',
            fontFamily: 'monospace',
            backgroundColor: '#09090b',
          },
          '.cm-scroller': { overflow: 'auto', minHeight: '100%' },
          '.cm-gutters': {
            backgroundColor: '#09090b',
            color: '#71717a',
            borderRight: '1px solid #27272a',
          },
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: editorContainerRef.current,
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLanguageChange = (newLang: string) => {
    onUpdateData(block.id, { language: newLang });
    if (editorViewRef.current) {
      editorViewRef.current.dispatch({
        effects: languageCompartment.current.reconfigure(getLanguageExtension(newLang)),
      });
    }
  };

  const isDirty = draftContent !== currentContent;

  const handleSave = async () => {
    await onSaveDraft(block.id, draftContent);
  };

  const handleCreateSnapshot = async () => {
    const finalLabel = snapshotLabel.trim() || 'snapshot';
    await onCreateSnapshot(block.id, finalLabel);
    setSnapshotLabel('');
    setIsPromptingSnapshot(false);
  };

  const handleRollbackRevision = async (rev: CodeRevision) => {
    await onRollback(block.id, rev.id);
    setDraftContent(rev.content);
    if (editorViewRef.current) {
      const len = editorViewRef.current.state.doc.length;
      editorViewRef.current.dispatch({
        changes: { from: 0, to: len, insert: rev.content },
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full max-w-6xl mx-auto w-full bg-zinc-900/50 border border-zinc-800/80 rounded-lg overflow-hidden shadow-2xl">
      {/* Code Toolbar */}
      <div className="px-4 py-2 border-b border-zinc-800/80 bg-zinc-900/80 flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="text-xs font-mono uppercase bg-zinc-800/90 text-zinc-200 border border-zinc-700 rounded px-2 py-1 outline-none cursor-pointer"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono transition cursor-pointer ${
              isDirty
                ? 'bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700 font-semibold'
                : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/60 cursor-not-allowed opacity-60'
            }`}
            title="Save draft (creates 'before edit' snapshot)"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>

          {/* Snapshot Button */}
          <button
            type="button"
            onClick={() => setIsPromptingSnapshot(!isPromptingSnapshot)}
            className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 rounded text-xs font-mono transition cursor-pointer"
            title="Create labeled snapshot"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Snapshot</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Tethered Source Files Button */}
          {incomingFileSources.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSources(!showSources)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition cursor-pointer border ${
                showSources
                  ? 'bg-zinc-800 text-zinc-200 border-zinc-600'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-zinc-800'
              }`}
            >
              <FileCode className="w-3 h-3 text-zinc-400" />
              <span>Tethered Files ({incomingFileSources.length})</span>
            </button>
          )}

          {/* Revisions Button */}
          <button
            type="button"
            onClick={() => setShowRevisions(!showRevisions)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition cursor-pointer border ${
              showRevisions
                ? 'bg-zinc-800 text-zinc-100 border-zinc-600'
                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-zinc-800'
            }`}
            title="Toggle revisions history"
          >
            <History className="w-3.5 h-3.5" />
            <span>Revisions ({revisions.length})</span>
          </button>
        </div>
      </div>

      {/* Snapshot Label Prompt Banner */}
      {isPromptingSnapshot && (
        <div className="p-2.5 bg-zinc-950 border-b border-zinc-800 flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs font-mono">
          <span className="text-zinc-400 text-xs sm:text-xs">Snapshot label:</span>
          <input
            type="text"
            autoFocus
            placeholder="e.g. checkpoint-1, before-refactor..."
            value={snapshotLabel}
            onChange={(e) => setSnapshotLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSnapshot();
              if (e.key === 'Escape') setIsPromptingSnapshot(false);
            }}
            className="flex-1 min-w-[200px] bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-base sm:text-xs text-zinc-200 outline-none focus:border-sky-500"
          />
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleCreateSnapshot}
              className="flex-1 sm:flex-none px-3 py-1.5 min-h-[38px] sm:min-h-0 bg-sky-900 hover:bg-sky-800 text-sky-200 rounded font-semibold transition cursor-pointer text-xs"
            >
              Take Snapshot
            </button>
            <button
              type="button"
              onClick={() => setIsPromptingSnapshot(false)}
              className="px-2.5 py-1.5 min-h-[38px] sm:min-h-0 text-zinc-400 hover:text-zinc-200 cursor-pointer text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tethered Source Files Panel */}
      {showSources && incomingFileSources.length > 0 && (
        <div className="p-3 bg-zinc-950 border-b border-zinc-800 text-xs font-mono">
          <div className="text-zinc-400 mb-2 font-medium">Tethered Source Files:</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-36 overflow-y-auto">
            {incomingFileSources.map((source) => (
              <div
                key={source.id}
                className="p-2 bg-zinc-900 border border-zinc-800 rounded flex items-center justify-between"
              >
                <span className="text-zinc-200 truncate">{source.title}</span>
                <span className="text-[10px] text-zinc-400 uppercase">
                  {(source.data as { mimeType?: string })?.mimeType || 'file'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revisions History Drawer */}
      {showRevisions && (
        <div className="p-3 bg-zinc-950/95 border-b border-zinc-800 max-h-56 overflow-y-auto space-y-1.5 text-xs font-mono">
          <div className="flex items-center justify-between text-zinc-400 mb-1 font-semibold uppercase text-[10px]">
            <span>Saved Revisions ({revisions.length})</span>
            <span>Max 50 local snapshots</span>
          </div>
          {revisions.length === 0 ? (
            <div className="text-zinc-400 italic py-2 text-center">
              No revisions recorded yet. Save a draft or take a snapshot.
            </div>
          ) : (
            revisions
              .slice()
              .reverse()
              .map((rev) => (
                <div
                  key={rev.id}
                  className="flex items-center justify-between p-2 bg-zinc-900/80 border border-zinc-800 rounded"
                >
                  <div className="min-w-0 pr-3">
                    <div className="text-zinc-200 font-medium truncate">{rev.label || 'Revision'}</div>
                    <div className="text-[10px] text-zinc-400 flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-2.5 h-2.5 text-zinc-400" />
                      <span>{new Date(rev.createdAt).toLocaleTimeString()}</span>
                      <span>•</span>
                      <span>{rev.content.length} characters</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRollbackRevision(rev)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700 cursor-pointer flex-shrink-0 transition"
                    title="Roll back to this revision"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Rollback</span>
                  </button>
                </div>
              ))
          )}
        </div>
      )}

      {/* CodeMirror 6 Editor Full Height Container */}
      <div
        ref={editorContainerRef}
        className="flex-1 w-full bg-zinc-950 overflow-hidden flex flex-col"
      />

      {/* Code Footer */}
      <div className="px-4 py-2 border-t border-zinc-800/80 bg-zinc-900/60 flex items-center justify-between text-xs font-mono text-zinc-400">
        <div className="flex items-center gap-2">
          <span>{draftContent.length} characters</span>
          {isDirty && <strong className="text-amber-400">*unsaved changes</strong>}
        </div>
        <div className="flex items-center gap-3">
          <span>Syntax: {language}</span>
          <span>•</span>
          <span>{revisions.length} stored revisions</span>
        </div>
      </div>
    </div>
  );
}
