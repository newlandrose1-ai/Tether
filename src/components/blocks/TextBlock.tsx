'use client';

import React, { memo, useCallback, useMemo } from 'react';
import type { Block, TextBlockData, TetherGroup } from '../../types/model';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { computeContentHash } from '../../lib/hash';
import { getFileTypeInfo } from '../../lib/fileTypes';
import { isBlockPreviewTabCollapsed } from '../../lib/tetherFolderSync';
import { useBlockResize } from '../../lib/useBlockResize';
import {
  FileText,
  ArrowRight,
  Check,
  Ban,
  Edit3,
  Copy,
  Scissors,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Link2,
} from 'lucide-react';

interface TextBlockProps {
  block: Block<TextBlockData>;
  group?: TetherGroup;
  isSelected: boolean;
  isConnectingSource: boolean;
  isValidTarget: boolean;
  isInvalidTarget: boolean;
  isTetheredChild?: boolean;
  tetherCount?: number;
  tetherParentTitle?: string;
  onStartTether: (e: React.MouseEvent) => void;
  onCompleteTether: (e: React.MouseEvent) => void;
}

export const TextBlock = memo(function TextBlock({
  block,
  isSelected,
  isConnectingSource,
  isValidTarget,
  isInvalidTarget,
  isTetheredChild = false,
  tetherCount = 0,
  tetherParentTitle,
  onStartTether,
  onCompleteTether,
}: TextBlockProps) {
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const copyBlockForEdit = useWorkspaceStore((s) => s.copyBlockForEdit);
  const auditBlock = useWorkspaceStore((s) => s.auditBlock);
  const snipOldBlock = useWorkspaceStore((s) => s.snipOldBlock);

  const isCollapsed = isBlockPreviewTabCollapsed(block, isTetheredChild);
  const handleToggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateBlock(block.id, { collapsed: !isCollapsed });
  };

  const handleCommitResize = useCallback(
    (id: string, size: { width: number; height: number }) => {
      updateBlock(id, size);
    },
    [updateBlock]
  );

  const { liveWidth, liveHeight, isResizing, handleResizeStart } = useBlockResize({
    blockId: block.id,
    width: block.width,
    height: block.height,
    defaultWidth: 320,
    defaultHeight: 220,
    minWidth: 260,
    maxWidth: 700,
    minHeight: 160,
    maxHeight: 600,
    onCommit: handleCommitResize,
  });

  const content = (block.data as TextBlockData)?.content ?? '';
  const fileInfo = useMemo(
    () =>
      getFileTypeInfo({
        title: block.title,
        kind: block.kind,
      }),
    [block.title, block.kind]
  );

  const currentHash = useMemo(
    () => (block.copiedFromBlockId ? computeContentHash(content) : ''),
    [block.copiedFromBlockId, content]
  );
  const isAuditFresh = Boolean(
    block.copiedFromBlockId && block.lastAuditHash && block.lastAuditHash === currentHash
  );
  const isAuditPassed = isAuditFresh && block.lastAuditStatus === 'passed';
  const isAuditFailed = isAuditFresh && block.lastAuditStatus === 'failed';
  const errorCount = block.copiedFromBlockId
    ? (block.lastAuditFindings ?? []).filter((f) => f.severity === 'error').length
    : 0;

  const wordCount = useMemo(() => {
    if (isCollapsed) return 0;
    const trimmed = content.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [content, isCollapsed]);

  const cardWidth = isCollapsed ? Math.min(liveWidth, 310) : liveWidth;

  return (
    <div
      style={{
        width: `${cardWidth}px`,
        height: isCollapsed ? 'auto' : liveHeight ? `${liveHeight}px` : undefined,
        contain: 'layout style',
      }}
      className={`group/box relative flex flex-col glass-card border rounded-lg overflow-hidden transition-[border-color,box-shadow] duration-150 select-none ${
        isResizing ? 'ring-1 ring-orange-500/40' : ''
      } ${
        isSelected
          ? 'border-orange-500 ring-2 ring-orange-500/25 shadow-[0_0_24px_rgba(249,115,22,0.16)]'
          : isCollapsed && isTetheredChild
          ? 'border-zinc-700/80 hover:border-orange-500/70'
          : 'border-zinc-700/75 hover:border-orange-500/60'
      } ${
        isConnectingSource
          ? 'ring-2 ring-orange-400 border-orange-400'
          : isValidTarget
          ? 'ring-2 ring-emerald-500 border-emerald-500 cursor-pointer'
          : isInvalidTarget
          ? 'opacity-40 grayscale cursor-not-allowed'
          : ''
      }`}
    >
      <div
        className={`h-0.5 w-full shrink-0 transition-colors ${
          isSelected
            ? 'bg-orange-500'
            : isTetheredChild
            ? 'bg-orange-500/45 group-hover/box:bg-orange-500/85'
            : 'bg-zinc-600/80 group-hover/box:bg-orange-500/80'
        }`}
      />

      {/* Header / Preview Tab Bar */}
      <div
        onDoubleClick={(e) => {
          e.stopPropagation();
          openBlockInEditor(block.id);
        }}
        className={`px-2.5 bg-gradient-to-b from-zinc-800/45 to-zinc-900/60 flex items-center justify-between shrink-0 cursor-default gap-1.5 ${
          isCollapsed ? 'min-h-[40px] py-1' : 'h-9 border-b border-zinc-700/70'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={handleToggleCollapse}
            className="text-zinc-400 hover:text-orange-400 p-1 rounded transition-colors cursor-pointer shrink-0"
            title={isCollapsed ? 'Expand preview tab' : 'Collapse to preview tab'}
            aria-label={isCollapsed ? 'Expand preview tab' : 'Collapse to preview tab'}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 text-orange-400/90" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-orange-400" />
            )}
          </button>
          <FileText className={`w-3.5 h-3.5 ${fileInfo.accentColorClass} shrink-0`} />
          <div className="min-w-0 flex flex-col">
            <span
              className="font-mono text-xs font-semibold text-zinc-100 truncate tracking-tight leading-tight"
              title={block.title}
            >
              {block.title}
            </span>
            {isCollapsed && (tetherParentTitle || tetherCount > 0) && (
              <span className="text-[9px] font-mono text-zinc-400 truncate flex items-center gap-1 leading-tight">
                <Link2 className="w-2.5 h-2.5 text-orange-400/80 shrink-0" />
                <span className="truncate">
                  {tetherParentTitle ? `in ${tetherParentTitle}` : `${tetherCount} tether${tetherCount === 1 ? '' : 's'}`}
                </span>
              </span>
            )}
          </div>
          <span
            className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border shrink-0 ${fileInfo.badgeClass}`}
            title={fileInfo.label}
          >
            {fileInfo.badge}
          </span>
          {isCollapsed && (
            <span className="text-[10px] font-mono text-zinc-400 shrink-0 tabular-nums">
              {content.length}c
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openBlockInEditor(block.id);
            }}
            className="text-[10px] font-mono text-zinc-100 hover:text-white bg-zinc-800/90 hover:bg-orange-500/20 border border-zinc-700 hover:border-orange-500/60 px-2 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Open pop-up editor"
          >
            <Edit3 className="w-2.5 h-2.5 text-orange-400" />
            <span>Edit</span>
          </button>

          {!isCollapsed && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copyBlockForEdit(block.id);
              }}
              className="p-1 text-zinc-400 hover:text-orange-300 hover:bg-zinc-800/80 border border-transparent hover:border-zinc-700 rounded transition-colors cursor-pointer"
              title="Copy block for editing & audit"
              aria-label="Copy block"
            >
              <Copy className="w-3 h-3" />
            </button>
          )}

          {!isConnectingSource && !isValidTarget && !isInvalidTarget && (
            <button
              type="button"
              onClick={onStartTether}
              className="text-[10px] font-mono text-zinc-300 hover:text-orange-300 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/80 hover:border-orange-500/50 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Start tether from this note"
            >
              <ArrowRight className="w-2.5 h-2.5" />
              {!isCollapsed && <span>Tether</span>}
            </button>
          )}

          {isValidTarget && (
            <button
              type="button"
              onClick={onCompleteTether}
              className="text-[10px] font-mono text-emerald-200 bg-emerald-950/80 border border-emerald-700 px-1.5 py-0.5 rounded flex items-center gap-1 font-semibold hover:bg-emerald-900 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Click to complete tether"
            >
              <Check className="w-2.5 h-2.5" />
              <span>Connect</span>
            </button>
          )}

          {isInvalidTarget && (
            <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-0.5">
              <Ban className="w-2.5 h-2.5" />
              <span>Invalid</span>
            </div>
          )}
        </div>
      </div>

      {/* Copied-block Audit & Snip Row */}
      {block.copiedFromBlockId && (
        <div
          className={`px-2.5 py-1.5 border-t border-zinc-700/70 flex items-center justify-between gap-2 text-[10px] font-mono ${
            isAuditPassed
              ? 'bg-emerald-950/35 text-emerald-300'
              : isAuditFailed
              ? 'bg-red-950/40 text-red-300'
              : 'bg-orange-950/30 text-orange-300'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            {isAuditPassed ? (
              <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
            ) : isAuditFailed ? (
              <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-3 h-3 text-orange-400 shrink-0" />
            )}
            <span className="truncate">
              {isAuditPassed
                ? 'Audit passed · Ready'
                : isAuditFailed
                ? `${errorCount} audit error${errorCount === 1 ? '' : 's'}`
                : 'Audit required'}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!isAuditPassed ? (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  await auditBlock(block.id);
                  openBlockInEditor(block.id);
                }}
                className="px-2 py-0.5 bg-orange-600/90 hover:bg-orange-500 text-white rounded border border-orange-400/60 cursor-pointer whitespace-nowrap font-semibold"
              >
                Audit
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  snipOldBlock(block.id);
                }}
                className="px-2 py-0.5 bg-emerald-800 hover:bg-emerald-700 text-white rounded border border-emerald-500 flex items-center gap-1 cursor-pointer whitespace-nowrap font-semibold"
                title="Snip old block & transfer tethers"
              >
                <Scissors className="w-2.5 h-2.5" />
                <span>Snip Old</span>
              </button>
            )}
          </div>
        </div>
      )}

      {!isCollapsed && (
        <>
          <div
            onClick={(e) => {
              e.stopPropagation();
              openBlockInEditor(block.id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex-1 p-2.5 bg-[#090B0E]/85 overflow-hidden flex flex-col cursor-pointer hover:bg-[#0C0F14] transition-colors"
            title="Click to edit in pop-up editor"
          >
            <div className="flex-1 overflow-auto p-2 text-xs font-mono text-zinc-300 whitespace-pre-wrap select-text leading-relaxed bg-zinc-950/70 border border-zinc-800/80 rounded max-h-36">
              {content || <span className="text-zinc-600 italic">Empty note. Click Edit to write.</span>}
            </div>
          </div>

          <div className="flex items-center justify-between h-[26px] px-3 bg-zinc-950/60 border-t border-zinc-800/90 text-[10px] text-zinc-400 font-mono shrink-0">
            <span className="tabular-nums">{fileInfo.label} · {wordCount} words</span>
            <span className="tabular-nums text-zinc-300">{content.length} chars</span>
          </div>

          <div
            onMouseDown={(e) => handleResizeStart(e, 'e')}
            className="absolute -right-1 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-orange-500/35 transition-colors z-20"
            title="Resize width"
          />
          <div
            onMouseDown={(e) => handleResizeStart(e, 's')}
            className="absolute left-0 -bottom-1 right-0 h-2 cursor-ns-resize hover:bg-orange-500/35 transition-colors z-20"
            title="Resize height"
          />
          <div
            onMouseDown={(e) => handleResizeStart(e, 'se')}
            className="absolute -right-1 -bottom-1 w-3.5 h-3.5 cursor-nwse-resize z-30 hover:bg-orange-500/50 rounded-br transition-colors"
            title="Resize card"
          />
        </>
      )}
    </div>
  );
});
