'use client';

import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  Search,
  ShieldAlert,
} from 'lucide-react';
import type { FileTreeNode, TextFileEntry } from '../../types/pipeline';

interface FileTreeViewProps {
  nodes: FileTreeNode[];
  textFiles: Record<string, TextFileEntry>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function statusLabel(status?: FileTreeNode['analysisStatus']): string {
  switch (status) {
    case 'analyzable':
      return 'Readable';
    case 'ignored-dir':
      return 'Unwanted folder';
    case 'build-output':
      return 'Build output';
    case 'binary':
      return 'Binary file';
    case 'nested-archive':
      return 'Nested zip';
    case 'huge-file':
      return 'Huge file skipped';
    case 'text-capped':
      return 'Large text (capped)';
    default:
      return '';
  }
}

function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  const result: FileTreeNode[] = [];

  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.path.toLowerCase().includes(q)) {
        result.push(node);
      }
    } else {
      const filteredChildren = filterTree(node.children ?? [], q);
      if (filteredChildren.length > 0 || node.path.toLowerCase().includes(q)) {
        result.push({
          ...node,
          children: filteredChildren,
        });
      }
    }
  }
  return result;
}

export function FileTreeView({ nodes, textFiles }: FileTreeViewProps) {
  const [search, setSearch] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const node of nodes) {
      if (node.kind === 'directory') initial.add(node.path);
    }
    return initial;
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(() => {
    const firstKey = Object.keys(textFiles)[0];
    return firstKey ?? null;
  });

  const filteredNodes = useMemo(() => filterTree(nodes, search.trim()), [nodes, search]);
  const selectedText = selectedPath ? textFiles[selectedPath] : undefined;

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: FileTreeNode, depth: number): React.ReactNode => {
    const isDir = node.kind === 'directory';
    const isOpen = search.trim().length > 0 || expandedDirs.has(node.path);
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path}>
        <button
          type="button"
          onClick={() => {
            if (isDir) toggleDir(node.path);
            else setSelectedPath(node.path);
          }}
          style={{ paddingLeft: `${10 + Math.min(depth, 5) * 14}px` }}
          className={`flex w-full items-center justify-between gap-2 border-b border-slate-800/60 py-2 pr-3 text-left text-xs transition-colors ${
            isSelected
              ? 'bg-blue-600/15 text-slate-100'
              : 'text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {isDir ? (
              <>
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                )}
                {isOpen ? (
                  <FolderOpen className="h-3.5 w-3.5 text-slate-300 shrink-0" aria-hidden="true" />
                ) : (
                  <Folder className="h-3.5 w-3.5 text-slate-300 shrink-0" aria-hidden="true" />
                )}
              </>
            ) : (
              <>
                <span className="w-3.5 shrink-0" />
                <FileCode2 className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              </>
            )}
            <span className="truncate font-mono">{node.name}</span>
          </span>

          <span className="flex items-center gap-2 shrink-0 text-[11px]">
            {node.redactBeforeAi && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-300 whitespace-nowrap">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Hidden from AI</span>
              </span>
            )}
            {!isDir && node.analysisStatus && node.analysisStatus !== 'analyzable' && (
              <span className="text-slate-400 whitespace-nowrap hidden sm:inline">
                {statusLabel(node.analysisStatus)}
              </span>
            )}
            <span className="w-16 text-right font-mono tabular-nums text-slate-400">
              {formatBytes(node.size)}
            </span>
          </span>
        </button>

        {isDir && isOpen && node.children && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#111620]">
        <div className="border-b border-slate-800 px-3 py-2.5">
          <label className="relative flex items-center">
            <span className="sr-only">Filter files by path</span>
            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter files by path..."
              className="w-full rounded-md border border-slate-700 bg-[#0B0E14] py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-400"
            />
          </label>
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          {filteredNodes.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400">
              No files or folders match &ldquo;{search}&rdquo;.
            </div>
          ) : (
            filteredNodes.map((node) => renderNode(node, 0))
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#111620]">
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="text-xs font-medium text-slate-100 truncate font-mono">
            {selectedPath ?? 'Select a file above to preview its text'}
          </div>
          {selectedText ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span className="font-mono tabular-nums">{selectedText.lineCount} lines</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatBytes(selectedText.originalBytes)}</span>
              {selectedText.truncated && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-300">Large file preview capped</span>
                </>
              )}
              {selectedText.redactBeforeAi && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-300 font-medium">
                    Contains secrets ({selectedText.secretFindingCount}) — hidden from AI
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-slate-400">
              {selectedPath
                ? 'Skipped from text reading (unwanted folder, build output, binary, or nested archive). Its original bytes stay unchanged in the output zip.'
                : 'Choose a readable file above to view its contents.'}
            </div>
          )}
        </div>

        <div className="max-h-[320px] overflow-auto bg-[#0B0E14] p-4">
          {selectedText ? (
            selectedText.redactBeforeAi ? (
              <div className="space-y-2 text-xs">
                <div className="rounded-md border border-amber-500/40 bg-amber-950/20 px-3 py-2.5 text-amber-200">
                  This file contains {selectedText.secretFindingCount} secret(s) and is hidden from
                  preview and AI tools. Only the file name and line numbers are shown in the Secrets
                  tab.
                </div>
              </div>
            ) : (
              <pre className="font-mono text-xs leading-5 text-slate-200 whitespace-pre-wrap break-words">
                {selectedText.content || '(empty file)'}
              </pre>
            )
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              No text preview loaded for this entry.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
