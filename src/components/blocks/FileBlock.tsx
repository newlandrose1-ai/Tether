'use client';

import React, { memo, useMemo, useState } from 'react';
import type { Block, FileBlockData, TetherGroup } from '../../types/model';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { computeContentHash } from '../../lib/hash';
import { formatFileSize, getFileTypeInfo } from '../../lib/fileTypes';
import {
  FileText,
  FileCode,
  ArrowRight,
  Check,
  Ban,
  ChevronDown,
  ChevronRight,
  Binary,
  Download,
  Eye,
  EyeOff,
  Edit3,
  Copy,
  Scissors,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  Image as ImageIcon,
  Music,
  Film,
  Globe,
} from 'lucide-react';

interface FileBlockProps {
  block: Block<FileBlockData>;
  group?: TetherGroup;
  isSelected: boolean;
  isConnectingSource: boolean;
  isValidTarget: boolean;
  isInvalidTarget: boolean;
  onStartTether: (e: React.MouseEvent) => void;
  onCompleteTether: (e: React.MouseEvent) => void;
}

export const FileBlock = memo(function FileBlock({
  block,
  isSelected,
  isConnectingSource,
  isValidTarget,
  isInvalidTarget,
  onStartTether,
  onCompleteTether,
}: FileBlockProps) {
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const copyBlockForEdit = useWorkspaceStore((s) => s.copyBlockForEdit);
  const auditBlock = useWorkspaceStore((s) => s.auditBlock);
  const snipOldBlock = useWorkspaceStore((s) => s.snipOldBlock);

  const [isExpanded, setIsExpanded] = useState(false);
  const [showPdfEmbed, setShowPdfEmbed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const isCollapsed = Boolean(block.collapsed);
  const handleToggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateBlock(block.id, { collapsed: !isCollapsed });
  };

  const data = block.data as FileBlockData;
  const isBinary = data?.binary ?? false;
  const content = data?.content ?? '';
  const isPdf =
    data?.isPdf ||
    data?.mimeType === 'application/pdf' ||
    block.title.toLowerCase().endsWith('.pdf');

  const fileInfo = useMemo(
    () =>
      getFileTypeInfo({
        title: block.title,
        kind: block.kind,
        mimeType: data?.mimeType,
        binary: isBinary,
        isPdf,
      }),
    [block.title, block.kind, data?.mimeType, isBinary, isPdf]
  );

  const width = block.width ?? 320;
  const height = block.height;

  const currentHash = useMemo(() => computeContentHash(content), [content]);
  const isAuditFresh = Boolean(block.lastAuditHash && block.lastAuditHash === currentHash);
  const isAuditPassed = isAuditFresh && block.lastAuditStatus === 'passed';
  const isAuditFailed = isAuditFresh && block.lastAuditStatus === 'failed';
  const errorCount = (block.lastAuditFindings ?? []).filter((f) => f.severity === 'error').length;

  const formatSize = formatFileSize;

  const handleResizeStart = (e: React.MouseEvent, direction: 'e' | 's' | 'se') => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = block.width ?? 320;
    const startHeight = block.height ?? 240;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      let newWidth = startWidth;
      let newHeight = startHeight;

      if (direction === 'e' || direction === 'se') {
        newWidth = Math.max(280, Math.min(700, startWidth + (moveEvent.clientX - startX)));
      }
      if (direction === 's' || direction === 'se') {
        newHeight = Math.max(160, Math.min(600, startHeight + (moveEvent.clientY - startY)));
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
            title={isCollapsed ? 'Expand file' : 'Collapse file'}
            aria-label={isCollapsed ? 'Expand file' : 'Collapse file'}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-orange-400" />
            )}
          </button>
          {isPdf ? (
            <FileText className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : fileInfo.viewerKind === 'image' || fileInfo.viewerKind === 'svg' ? (
            <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : fileInfo.viewerKind === 'audio' ? (
            <Music className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          ) : fileInfo.viewerKind === 'video' ? (
            <Film className="w-3.5 h-3.5 text-pink-400 shrink-0" />
          ) : fileInfo.viewerKind === 'html' ? (
            <Globe className="w-3.5 h-3.5 text-orange-400 shrink-0" />
          ) : isBinary ? (
            <Binary className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          ) : (
            <FileCode className={`w-3.5 h-3.5 ${fileInfo.accentColorClass} shrink-0`} />
          )}
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
              {formatSize(data?.size || 0)}
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
            title={fileInfo.isTextEditable ? 'Open in pop-up editor / viewer' : 'Open file viewer'}
          >
            {fileInfo.isTextEditable ? (
              <Edit3 className="w-2.5 h-2.5 text-orange-400" />
            ) : (
              <Eye className="w-2.5 h-2.5 text-orange-400" />
            )}
            <span>{fileInfo.isTextEditable ? 'Edit' : 'View'}</span>
          </button>

          {fileInfo.isTextEditable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copyBlockForEdit(block.id);
              }}
              className="p-1 text-zinc-400 hover:text-orange-300 hover:bg-zinc-800/80 border border-transparent hover:border-zinc-700 rounded transition-colors cursor-pointer"
              title="Copy file block for editing & audit"
              aria-label="Copy file block"
            >
              <Copy className="w-3 h-3" />
            </button>
          )}

          {!isConnectingSource && !isValidTarget && !isInvalidTarget && (
            <button
              type="button"
              onClick={onStartTether}
              className="text-[10px] font-mono text-zinc-300 hover:text-orange-300 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/80 hover:border-orange-500/50 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Start tether from this file"
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
          <div className="flex-1 p-2.5 bg-[#090B0E]/85 overflow-y-auto space-y-2 select-text font-mono text-xs">
            <div className="text-[10px] font-mono text-zinc-400 truncate bg-zinc-900/70 border border-zinc-800 px-2 py-1 rounded flex items-center justify-between">
              <span className="truncate">{data?.path || block.title}</span>
              <span className="shrink-0 text-zinc-400 ml-2 tabular-nums">
                {formatSize(data?.size ?? 0)}
              </span>
            </div>

            {isPdf ? (
              <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-rose-300 text-[11px] font-semibold">
                    <FileText className="w-3.5 h-3.5 text-rose-400" />
                    <span>PDF Document</span>
                  </div>
                  {data?.dataUrl && (
                    <button
                      type="button"
                      onClick={() => setShowPdfEmbed(!showPdfEmbed)}
                      className="flex items-center gap-1 text-[10px] text-orange-400 hover:text-orange-300 cursor-pointer"
                    >
                      {showPdfEmbed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{showPdfEmbed ? 'Hide' : 'Preview'}</span>
                    </button>
                  )}
                </div>

                {showPdfEmbed && data?.dataUrl && (
                  <div className="rounded border border-zinc-800 overflow-hidden mt-1">
                    <object
                      data={data.dataUrl}
                      type="application/pdf"
                      className="w-full h-44 bg-zinc-900"
                    >
                      <p className="text-zinc-500 text-[10px] p-2">PDF viewer unavailable inline.</p>
                    </object>
                  </div>
                )}

                {data?.dataUrl && (
                  <div className="pt-1">
                    <a
                      href={data.dataUrl}
                      download={block.title}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[10px] border border-zinc-700 cursor-pointer transition"
                    >
                      <Download className="w-3 h-3 text-zinc-400" />
                      <span>Download PDF</span>
                    </a>
                  </div>
                )}
              </div>
            ) : fileInfo.viewerKind === 'image' ? (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  openBlockInEditor(block.id);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-2 bg-zinc-900/60 border border-zinc-800 hover:border-orange-500/50 rounded space-y-2 cursor-pointer transition-colors"
                title="Click to open full image viewer"
              >
                {data?.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={data.dataUrl}
                    alt={block.title}
                    className="w-full max-h-36 object-contain rounded bg-zinc-950/70"
                  />
                ) : (
                  <div className="py-4 text-center space-y-1">
                    <ImageIcon className="w-5 h-5 text-emerald-400 mx-auto" />
                    <div className="text-[11px] text-zinc-300">{fileInfo.label}</div>
                  </div>
                )}
              </div>
            ) : fileInfo.viewerKind === 'audio' || fileInfo.viewerKind === 'video' ? (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  openBlockInEditor(block.id);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-3 bg-zinc-900/60 border border-zinc-800 hover:border-orange-500/50 rounded text-center space-y-1.5 cursor-pointer transition-colors"
                title="Click to open media player"
              >
                {fileInfo.viewerKind === 'audio' ? (
                  <Music className="w-5 h-5 text-violet-400 mx-auto" />
                ) : (
                  <Film className="w-5 h-5 text-pink-400 mx-auto" />
                )}
                <div className="text-[11px] text-zinc-200 font-medium">{fileInfo.label}</div>
                <div className="text-[10px] text-orange-300">Click View to play</div>
              </div>
            ) : isBinary ? (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  openBlockInEditor(block.id);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-3 bg-zinc-900/60 border border-zinc-800 hover:border-orange-500/50 rounded text-center space-y-1 cursor-pointer transition-colors"
                title="Click to inspect file details"
              >
                <Binary className="w-4 h-4 text-zinc-400 mx-auto" />
                <div className="text-[11px] text-zinc-300">{fileInfo.label}</div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {data?.mimeType || 'application/octet-stream'}
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
                  <span>
                    {fileInfo.label} ({content.length} chars)
                  </span>
                  {content.length > 100 && (
                    <button
                      type="button"
                      onClick={() => setIsExpanded(!isExpanded)}
                      className="flex items-center gap-0.5 text-zinc-400 hover:text-orange-300 cursor-pointer"
                    >
                      <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>

                <pre
                  onClick={(e) => {
                    e.stopPropagation();
                    openBlockInEditor(block.id);
                  }}
                  className={`p-2 bg-zinc-950/75 border border-zinc-800/90 hover:border-orange-500/40 rounded text-[11px] text-zinc-300 overflow-x-auto whitespace-pre-wrap select-text leading-relaxed cursor-pointer transition-colors ${
                    isExpanded ? 'max-h-56' : 'max-h-24'
                  } overflow-y-auto`}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {content || <span className="text-zinc-600 italic">Empty file</span>}
                </pre>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between h-[26px] px-3 bg-zinc-950/60 border-t border-zinc-800/90 text-[10px] text-zinc-500 font-mono shrink-0">
            <span className="truncate">{data?.parentFolderPath || fileInfo.label}</span>
            <span className="tabular-nums shrink-0 text-zinc-400">{formatSize(data?.size ?? 0)}</span>
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
