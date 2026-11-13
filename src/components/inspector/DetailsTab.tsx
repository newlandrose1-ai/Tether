'use client';

import React from 'react';
import type { Block, CodeBlockData, FileBlockData, TextBlockData } from '../../types/model';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  Clock,
  HardDrive,
  FileCode,
  Tag,
  GitCommit,
  Download,
  ArrowRight,
  ArrowLeft,
  Trash2,
} from 'lucide-react';
import { exportSingleBlock } from '../../lib/exportImport';

interface DetailsTabProps {
  block: Block;
}

export function DetailsTab({ block }: DetailsTabProps) {
  const tethers = useWorkspaceStore((s) => s.tethers);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const deleteTether = useWorkspaceStore((s) => s.deleteTether);

  const incomingTethers = tethers.filter((t) => t.targetBlockId === block.id);
  const outgoingTethers = tethers.filter((t) => t.sourceBlockId === block.id);

  const content =
    block.kind === 'code'
      ? (block.data as CodeBlockData)?.currentContent || ''
      : block.kind === 'text'
      ? (block.data as TextBlockData)?.content || ''
      : (block.data as FileBlockData)?.content || '';

  const path = (block.data as { path?: string })?.path || block.title;
  const language = (block.data as { language?: string })?.language || 'text';

  // Extract import dependencies
  const detectedImports = React.useMemo(() => {
    if (!content) return [];
    const importRegex = /(?:import\s+(?:[\w*\s{},]*)\s+from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
    const list: string[] = [];
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const dep = match[1] || match[2];
      if (dep && !list.includes(dep)) list.push(dep);
    }
    return list;
  }, [content]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-3 space-y-4 overflow-y-auto text-xs font-mono select-none">
      {/* File Metadata Card */}
      <div className="space-y-2 bg-[#0E1013] border border-zinc-800/80 rounded-md p-3">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">
          File Properties
        </div>

        <div className="flex justify-between items-center text-zinc-400">
          <span>Path</span>
          <span className="text-zinc-200 truncate max-w-[160px]" title={path}>
            {path}
          </span>
        </div>

        <div className="flex justify-between items-center text-zinc-400">
          <span>Language</span>
          <span className="uppercase text-sky-400 font-semibold">{language}</span>
        </div>

        <div className="flex justify-between items-center text-zinc-400">
          <span>Size</span>
          <span className="text-zinc-200">{formatSize(new Blob([content]).size)}</span>
        </div>

        <div className="flex justify-between items-center text-zinc-400">
          <span>Lines</span>
          <span className="text-zinc-200">{content.split('\n').length} lines</span>
        </div>

        <div className="flex justify-between items-center text-zinc-400">
          <span>Characters</span>
          <span className="text-zinc-200">{content.length} chars</span>
        </div>

        <div className="flex justify-between items-center text-zinc-400">
          <span>Last modified</span>
          <span className="text-zinc-300">{formatDate(block.updatedAt)}</span>
        </div>
      </div>

      {/* Detected Dependencies */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
          Imports & Dependencies ({detectedImports.length})
        </div>
        {detectedImports.length === 0 ? (
          <div className="text-[11px] text-zinc-400 p-2.5 border border-dashed border-zinc-800 rounded text-center">
            No external module imports found.
          </div>
        ) : (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {detectedImports.map((dep, idx) => (
              <div
                key={idx}
                className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[11px] text-zinc-300 truncate"
              >
                {dep}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connected Tethers */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5">
          <GitCommit className="w-3 h-3 text-zinc-400" />
          <span>Connected Tethers ({incomingTethers.length + outgoingTethers.length})</span>
        </div>

        {incomingTethers.length === 0 && outgoingTethers.length === 0 ? (
          <div className="text-[11px] text-zinc-400 p-2.5 border border-dashed border-zinc-800 rounded text-center">
            No tethers connected to this block.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {outgoingTethers.map((t) => {
              const target = blocks.find((b) => b.id === t.targetBlockId);
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-2 bg-zinc-900 border border-zinc-800 rounded text-[11px]"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ArrowRight className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                    <span className="truncate text-zinc-200">{target?.title || 'Unknown'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteTether(t.id)}
                    className="p-1 hover:text-red-400 text-zinc-400 rounded"
                    title="Remove tether"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

            {incomingTethers.map((t) => {
              const source = blocks.find((b) => b.id === t.sourceBlockId);
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-2 bg-zinc-900 border border-zinc-800 rounded text-[11px]"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ArrowLeft className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                    <span className="truncate text-zinc-200">{source?.title || 'Unknown'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteTether(t.id)}
                    className="p-1 hover:text-red-400 text-zinc-400 rounded"
                    title="Remove tether"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Export Action */}
      <div className="pt-2 border-t border-zinc-800">
        <button
          type="button"
          onClick={() => exportSingleBlock(block)}
          className="w-full flex items-center justify-center gap-2 py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded text-xs transition cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-zinc-400" />
          <span>Export This File</span>
        </button>
      </div>
    </div>
  );
}
