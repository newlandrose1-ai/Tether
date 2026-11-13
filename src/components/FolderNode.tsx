'use client';

import React, { memo } from 'react';
import type { NodeProps } from 'reactflow';
import { Folder, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';

export interface FolderNodeData {
  folderPath: string;
  isExpanded: boolean;
  fileCount: number;
  uploadBlockId?: string;
  onToggleFolder?: (folderPath: string) => void;
}

export const FolderNode = memo(function FolderNode({
  data,
}: NodeProps<FolderNodeData>) {
  const updateBlockData = useWorkspaceStore((s) => s.updateBlockData);
  const blocks = useWorkspaceStore((s) => s.blocks);

  const { folderPath, isExpanded, fileCount, uploadBlockId, onToggleFolder } = data;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (onToggleFolder) {
      onToggleFolder(folderPath);
      return;
    }

    if (uploadBlockId) {
      const uploadBlock = blocks.find((b) => b.id === uploadBlockId);
      if (!uploadBlock || uploadBlock.kind !== 'upload') return;

      const uploadData = uploadBlock.data as {
        expandedFolderPaths?: string[];
      };

      const currentExpanded = uploadData.expandedFolderPaths ?? [];
      let nextExpanded: string[];

      if (isExpanded) {
        nextExpanded = currentExpanded.filter(
          (p) => p !== folderPath && !p.startsWith(`${folderPath}/`)
        );
      } else {
        // Ensure parent segments and this folder are expanded cleanly
        const segments = folderPath.split('/');
        const parentsToExpand: string[] = [];
        let curr = '';
        for (const seg of segments) {
          curr = curr ? `${curr}/${seg}` : seg;
          parentsToExpand.push(curr);
        }
        nextExpanded = Array.from(new Set([...currentExpanded, ...parentsToExpand]));
      }

      updateBlockData(uploadBlockId, {
        expandedFolderPaths: nextExpanded,
      });
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggle(e as unknown as React.MouseEvent);
        }
      }}
      className={`w-72 glass-menu border rounded-lg px-3 py-2 flex items-center justify-between cursor-pointer select-none transition-[border-color,box-shadow,transform] duration-150 group text-xs font-mono ${
        isExpanded
          ? 'border-zinc-600/75 hover:border-orange-500/70'
          : 'border-orange-500/70 ring-1 ring-orange-500/20 shadow-[0_0_18px_rgba(249,115,22,0.14)]'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800/70 border border-zinc-700/70 text-zinc-300 group-hover:text-orange-400 group-hover:border-orange-500/50 transition-colors shrink-0">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-orange-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-orange-400" />
          )}
        </span>

        {isExpanded ? (
          <FolderOpen className="w-4 h-4 text-orange-400 shrink-0" />
        ) : (
          <Folder className="w-4 h-4 text-orange-400/90 shrink-0" />
        )}

        <span className="font-semibold text-zinc-100 truncate" title={folderPath}>
          {folderPath}/
        </span>
      </div>

      <span
        className={`text-[10px] px-2 py-0.5 rounded border shrink-0 font-semibold tabular-nums transition-colors ${
          isExpanded
            ? 'text-zinc-300 bg-zinc-900/80 border-zinc-700/80'
            : 'text-orange-300 bg-orange-500/15 border-orange-500/45'
        }`}
      >
        {isExpanded ? `${fileCount} open` : `${fileCount} hidden`}
      </span>
    </div>
  );
});
