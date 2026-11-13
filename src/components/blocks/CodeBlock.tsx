'use client';

import React, { memo, useMemo, useState } from 'react';
import type { Block, CodeBlockData, TetherGroup } from '../../types/model';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { computeContentHash } from '../../lib/hash';
import { getFileTypeInfo } from '../../lib/fileTypes';
import {
  Code2,
  ArrowRight,
  Check,
  Ban,
  ChevronDown,
  ChevronRight,
  Edit3,
  Copy,
  Scissors,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';

interface CodeBlockProps {
  block: Block<CodeBlockData>;
  group?: TetherGroup;
  isSelected: boolean;
  isConnectingSource: boolean;
  isValidTarget: boolean;
  isInvalidTarget: boolean;
  onStartTether: (e: React.MouseEvent) => void;
  onCompleteTether: (e: React.MouseEvent) => void;
}

const PREVIEW_MAX_LINES = 10;

export const CodeBlock = memo(function CodeBlock({
  block,
  isSelected,
  isConnectingSource,
  isValidTarget,
  isInvalidTarget,
  onStartTether,
  onCompleteTether,
}: CodeBlockProps) {
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const copyBlockForEdit = useWorkspaceStore((s) => s.copyBlockForEdit);
  const auditBlock = useWorkspaceStore((s) => s.auditBlock);
  const snipOldBlock = useWorkspaceStore((s) => s.snipOldBlock);

  const data = block.data as CodeBlockData;
  const currentContent = data?.currentContent ?? '';
  const language = data?.language ?? 'javascript';

  const [isResizing, setIsResizing] = useState(false);

  const isCollapsed = Boolean(block.collapsed);
  const handleToggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateBlock(block.id, { collapsed: !isCollapsed });
  };

  const fileInfo = useMemo(
    () =>
      getFileTypeInfo({
        title: block.title,
        kind: block.kind,
        language,
      }),
    [block.title, block.kind, language]
  );

  const width = block.width ?? 340;
  const height = block.height;

  const currentHash = useMemo(() => computeContentHash(currentContent), [currentContent]);
  const isAuditFresh = Boolean(block.lastAuditHash && block.lastAuditHash === currentHash);
  const isAuditPassed = isAuditFresh && block.lastAuditStatus === 'passed';
  const isAuditFailed = isAuditFresh && block.lastAuditStatus === 'failed';
  const errorCount = (block.lastAuditFindings ?? []).filter((f) => f.severity === 'error').length;

  const { previewLines, totalLines, hiddenLines } = useMemo(() => {
    const all = currentContent.split('\n');
    return {
      previewLines: all.slice(0, PREVIEW_MAX_LINES),
      totalLines: all.length,
      hiddenLines: Math.max(0, all.length - PREVIEW_MAX_LINES),
    };
  }, [currentContent]);

  const handleResizeStart = (e: React.MouseEvent, direction: 'e' | 's' | 'se') => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = block.width ?? 340;
    const startHeight = block.height ?? 250;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      let newWidth = startWidth;
      let newHeight = startHeight;

      if (direction === 'e' || direction === 'se') {
        newWidth = Math.max(300, Math.min(800, startWidth + (moveEvent.clientX - startX)));
      }
      if (direction === 's' || direction === 'se') {
        newHeight = Math.max(180, Math.min(700, startHeight + (moveEvent.clientY - startY)));
      }

      updateBlock(block.id, { width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      style={{
        width: `${width}px`,
        height: isCollapsed ? 'auto' : height ? `${height}px` : undefined,
      }}
      className={`group/box relative flex flex-col glass-card border rounded-lg overflow-hidden transition-[border-color,box-shadow] duration-150 select-none ${
        isResizing ? 'ring-1 ring-orange-500/40' : ''
      } ${
        isSelected
          ? 'border-orange-500 ring-2 ring-orange-500/25 shadow-[0_0_24px_rgba(249,115,22,0.16)]'
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
      {/* Top 2px Accent Bar */}
      <div
        className={`h-0.5 w-full shrink-0 transition-colors ${
          isSelected ? 'bg-orange-500' : 'bg-zinc-600/80 group-hover/box:bg-orange-500/80'
        }`}
      />

      {/* Header Bar */}
      <div
        onDoubleClick={(e) => {
          e.stopPropagation();
          openBlockInEditor(block.id);
        }}
        className="h-9 px-2.5 bg-gradient-to-b from-zinc-800/45 to-zinc-900/60 border-b border-zinc-700/70 flex items-center justify-between shrink-0 cursor-default gap-1.5"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={handleToggleCollapse}
            className="text-zinc-400 hover:text-orange-400 p-1 rounded transition-colors cursor-pointer"
            title={isCollapsed ? 'Expand code block' : 'Collapse code block'}
            aria-label={isCollapsed ? 'Expand code block' : 'Collapse code block'}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-orange-400" />
            )}
          </button>
          <Code2 className={`w-3.5 h-3.5 ${fileInfo.accentColorClass} shrink-0`} />
          <span
            className="font-mono text-xs font-semibold text-zinc-100 truncate tracking-tight"
            title={block.title}
          >
            {block.title}
          </span>
          <span
            className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border shrink-0 ${fileInfo.badgeClass}`}
            title={fileInfo.label}
          >
            {fileInfo.badge}
          </span>
          {isCollapsed && (
            <span className="text-[10px] font-mono text-zinc-400 shrink-0 tabular-nums">
              {totalLines}L
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

          {!isConnectingSource && !isValidTarget && !isInvalidTarget && (
            <button
              type="button"
              onClick={onStartTether}
              className="text-[10px] font-mono text-zinc-300 hover:text-orange-300 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/80 hover:border-orange-500/50 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Start tether from this block"
            >
              <ArrowRight className="w-2.5 h-2.5" />
              <span>Tether</span>
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
          className={`px-2.5 py-1.5 border-b border-zinc-700/70 flex items-center justify-between gap-2 text-[10px] font-mono ${
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
          {/* Fast Lightweight Line-Numbered Preview (Full CodeMirror mounts inside Pop-up Editor) */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              openBlockInEditor(block.id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full bg-[#090B0E]/90 px-2.5 py-2 overflow-hidden cursor-pointer hover:bg-[#0C0F14] transition-colors flex-1"
            title="Click to edit in pop-up CodeMirror editor"
          >
            <div className="font-mono text-[11px] leading-[1.45] space-y-0 overflow-hidden">
              {previewLines.map((line, i) => (
                <div key={i} className="flex items-baseline gap-2.5 min-w-0">
                  <span className="w-5 text-right text-[10px] text-zinc-600 select-none shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="text-zinc-300 truncate whitespace-pre">
                    {line || ' '}
                  </span>
                </div>
              ))}
              {hiddenLines > 0 && (
                <div className="pt-1 pl-7 text-[10px] text-orange-400/85 font-medium">
                  +{hiddenLines} more lines — click to edit
                </div>
              )}
            </div>
          </div>

          {/* Footer Bar */}
          <div className="h-[26px] px-3 border-t border-zinc-800/90 bg-zinc-950/60 flex items-center justify-between text-[10px] font-mono text-zinc-500 shrink-0">
            <span className="truncate">{data?.path || block.title}</span>
            <span className="tabular-nums shrink-0 text-zinc-400">
              {fileInfo.label} · {totalLines}L
            </span>
          </div>

          {/* Interactive Resize Borders */}
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
