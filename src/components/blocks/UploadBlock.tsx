'use client';

import React, { memo, useCallback, useRef, useState } from 'react';
import type { Block, UploadBlockData, TetherGroup } from '../../types/model';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { extractZipArchive } from '../../lib/zip';
import { formatFileSize } from '../../lib/fileTypes';
import { isBlockPreviewTabCollapsed } from '../../lib/tetherFolderSync';
import { useBlockResize } from '../../lib/useBlockResize';
import {
  FileArchive,
  Upload,
  ArrowRight,
  Check,
  Ban,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Eye,
  Link2,
} from 'lucide-react';

interface UploadBlockProps {
  block: Block<UploadBlockData>;
  group?: TetherGroup;
  isSelected: boolean;
  isConnectingSource: boolean;
  isValidTarget: boolean;
  isInvalidTarget: boolean;
  isTetheredChild?: boolean;
  tetherCount?: number;
  tetherParentTitle?: string;
  extractedFolderPaths?: string[];
  onStartTether: (e: React.MouseEvent) => void;
  onCompleteTether: (e: React.MouseEvent) => void;
}

export const UploadBlock = memo(function UploadBlock({
  block,
  isSelected,
  isConnectingSource,
  isValidTarget,
  isInvalidTarget,
  isTetheredChild = false,
  tetherCount = 0,
  tetherParentTitle,
  extractedFolderPaths = [],
  onStartTether,
  onCompleteTether,
}: UploadBlockProps) {
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const updateBlockData = useWorkspaceStore((s) => s.updateBlockData);
  const createBlock = useWorkspaceStore((s) => s.createBlock);
  const createTether = useWorkspaceStore((s) => s.createTether);
  const deleteBlock = useWorkspaceStore((s) => s.deleteBlock);
  const setFocusedBlockId = useWorkspaceStore((s) => s.setFocusedBlockId);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const data = block.data as UploadBlockData;
  const fileName = data?.fileName || '';
  const size = data?.size || 0;
  const extractedBlockIds = data?.extractedBlockIds || [];
  const structureCollapsed = Boolean(data?.structureCollapsed);
  const status = block.status;

  const isCollapsed = isBlockPreviewTabCollapsed(block, isTetheredChild);
  const handleToggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateBlock(block.id, { collapsed: !isCollapsed });
  };

  const handleCommitResize = useCallback(
    (id: string, nextSize: { width: number; height: number }) => {
      updateBlock(id, nextSize);
    },
    [updateBlock]
  );

  const { liveWidth, liveHeight, isResizing, handleResizeStart } = useBlockResize({
    blockId: block.id,
    width: block.width,
    height: block.height,
    defaultWidth: 320,
    defaultHeight: 260,
    minWidth: 280,
    maxWidth: 700,
    minHeight: 180,
    maxHeight: 600,
    onCommit: handleCommitResize,
  });

  const handleProcessZip = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setErrorMessage('Please upload a valid .zip archive file.');
      return;
    }

    setErrorMessage(null);
    await updateBlock(block.id, {
      title: file.name,
      status: 'extracting',
    });
    await updateBlockData(block.id, {
      fileName: file.name,
      size: file.size,
    });

    try {
      const extractedEntries = await extractZipArchive(file);

      // Clean up previous extracted blocks if re-extracting
      if (extractedBlockIds.length > 0) {
        for (const prevId of extractedBlockIds) {
          await deleteBlock(prevId);
        }
      }

      if (extractedEntries.length === 0) {
        await updateBlock(block.id, { status: 'ready' });
        await updateBlockData(block.id, {
          extractedBlockIds: [],
          structureCollapsed: false,
          expandedFolderPaths: [],
        });
        return;
      }

      const newExtractedIds: string[] = [];

      // Organize by folders
      const rootEntries = extractedEntries.filter((e) => !e.parentFolderPath);
      const folderGroupsMap = new Map<string, typeof extractedEntries>();
      for (const entry of extractedEntries) {
        if (entry.parentFolderPath) {
          if (!folderGroupsMap.has(entry.parentFolderPath)) {
            folderGroupsMap.set(entry.parentFolderPath, []);
          }
          folderGroupsMap.get(entry.parentFolderPath)!.push(entry);
        }
      }

      const allFolderPaths = Array.from(folderGroupsMap.keys());
      let colIndex = 0;

      // Position root files in column 0 if any
      if (rootEntries.length > 0) {
        for (let i = 0; i < rootEntries.length; i++) {
          const entry = rootEntries[i];
          const posX = block.x + 360;
          const posY = block.y + i * 200;

          const fileBlock = await createBlock({
            projectId: block.projectId,
            groupId: block.groupId,
            kind: 'file',
            title: entry.name,
            x: posX,
            y: posY,
            status: 'ready',
            data: {
              path: entry.path,
              parentFolderPath: '',
              mimeType: entry.mimeType,
              size: entry.size,
              binary: entry.binary,
              content: entry.content,
              dataUrl: entry.dataUrl,
              isPdf: entry.isPdf,
            },
          });

          newExtractedIds.push(fileBlock.id);
          await createTether(block.id, fileBlock.id, 'extracted from');
        }
        colIndex++;
      }

      // Position folder files in distinct columns
      for (const [folderPath, entries] of folderGroupsMap.entries()) {
        const posX = block.x + 360 + colIndex * 340;

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const posY = block.y + 60 + i * 200;

          const fileBlock = await createBlock({
            projectId: block.projectId,
            groupId: block.groupId,
            kind: 'file',
            title: entry.name,
            x: posX,
            y: posY,
            status: 'ready',
            data: {
              path: entry.path,
              parentFolderPath: folderPath,
              mimeType: entry.mimeType,
              size: entry.size,
              binary: entry.binary,
              content: entry.content,
              dataUrl: entry.dataUrl,
              isPdf: entry.isPdf,
            },
          });

          newExtractedIds.push(fileBlock.id);
          await createTether(block.id, fileBlock.id, 'extracted from');
        }
        colIndex++;
      }

      await updateBlock(block.id, { status: 'ready' });
      await updateBlockData(block.id, {
        extractedBlockIds: newExtractedIds,
        structureCollapsed: false,
        expandedFolderPaths: allFolderPaths,
      });
    } catch (err) {
      await updateBlock(block.id, { status: 'error' });
      setErrorMessage((err as Error).message || 'Failed to extract ZIP archive.');
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessZip(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessZip(file);
    }
  };

  const toggleStructureCollapse = () => {
    updateBlockData(block.id, {
      structureCollapsed: !structureCollapsed,
    });
  };

  const handleExpandAll = () => {
    updateBlockData(block.id, {
      structureCollapsed: false,
      expandedFolderPaths: extractedFolderPaths,
    });
  };

  const handleCollapseAll = () => {
    updateBlockData(block.id, {
      structureCollapsed: false,
      expandedFolderPaths: [],
    });
  };

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
      {/* Top 2px Accent Line */}
      <div
        className={`h-0.5 w-full shrink-0 transition-colors ${
          isSelected
            ? 'bg-orange-500'
            : isTetheredChild
            ? 'bg-orange-500/45 group-hover/box:bg-orange-500/85'
            : 'bg-zinc-600/80 group-hover/box:bg-orange-500/80'
        }`}
      />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        onChange={onFileInputChange}
        className="hidden"
      />

      {/* --- HEADER / PREVIEW TAB BAR --- */}
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
            title={isCollapsed ? 'Expand archive preview tab' : 'Collapse to preview tab'}
            aria-label={isCollapsed ? 'Expand archive preview tab' : 'Collapse to preview tab'}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 text-orange-400/90" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-orange-400" />
            )}
          </button>
          <FileArchive className="w-3.5 h-3.5 text-orange-400 shrink-0" />
          <div className="min-w-0 flex flex-col">
            <span className="font-mono text-xs font-semibold text-zinc-100 truncate tracking-tight leading-tight" title={block.title}>
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
          <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border bg-orange-500/16 text-orange-200 border-orange-500/45 shrink-0">
            ZIP
          </span>
          {isCollapsed && (
            <span className="text-[10px] font-mono text-zinc-400 shrink-0 tabular-nums">
              {extractedBlockIds.length}f
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
            title="View archive manifest"
          >
            <Eye className="w-2.5 h-2.5 text-orange-400" />
            <span>View</span>
          </button>

          {/* Maximize Button */}
          {!isCollapsed && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFocusedBlockId(block.id);
              }}
              className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition cursor-pointer"
              title="Expand into Focus Mode"
              aria-label="Expand into Focus Mode"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}

          {/* Tether Action Button */}
          {!isConnectingSource && !isValidTarget && !isInvalidTarget && (
            <button
              type="button"
              onClick={onStartTether}
              className="text-[10px] font-mono text-zinc-300 hover:text-orange-300 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/80 hover:border-orange-500/50 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer"
              title="Start tether from this archive"
            >
              <ArrowRight className="w-2.5 h-2.5" />
              {!isCollapsed && <span>Tether</span>}
            </button>
          )}

          {/* Valid Target Prompt */}
          {isValidTarget && (
            <button
              type="button"
              onClick={onCompleteTether}
              className="text-[10px] font-mono text-emerald-300 bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.5 rounded flex items-center gap-1 font-semibold hover:bg-emerald-900 transition cursor-pointer"
              title="Click to complete tether"
            >
              <Check className="w-2.5 h-2.5" />
              <span>Connect</span>
            </button>
          )}

          {/* Invalid Target Indicator */}
          {isInvalidTarget && (
            <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-0.5">
              <Ban className="w-2.5 h-2.5" />
              <span>Invalid</span>
            </div>
          )}
        </div>
      </div>

      {/* --- PRIMARY BODY CANVAS --- */}
      {!isCollapsed && (
        <>
          <div className="flex-1 p-3 bg-[#0E1013] overflow-y-auto space-y-2.5 select-text font-mono text-xs">
            {status === 'extracting' ? (
              <div className="p-6 bg-[#13151A] border border-[#22262B] rounded flex flex-col items-center justify-center space-y-2">
                <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
                <div className="text-xs text-zinc-200 font-semibold">Extracting archive...</div>
                <div className="text-[10px] text-zinc-500">In-browser JSZip stream</div>
              </div>
            ) : fileName ? (
              <div className="p-2.5 bg-[#13151A] border border-[#22262B] rounded space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileArchive className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-xs font-semibold text-zinc-200 truncate">{fileName}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 shrink-0">
                    {formatFileSize(size)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1.5 border-t border-[#1E2228]">
                  <span>{extractedBlockIds.length} entries extracted</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="hover:text-amber-300 text-zinc-400 flex items-center gap-1 text-[10px] transition cursor-pointer"
                    title="Replace with new ZIP archive"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>Replace</span>
                  </button>
                </div>

                {/* Tree Collapsible Controls */}
                {extractedBlockIds.length > 0 && (
                  <div className="pt-2 border-t border-[#1E2228] space-y-1.5 font-mono">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={toggleStructureCollapse}
                        className="flex items-center gap-1.5 text-[11px] text-zinc-100 hover:text-orange-300 transition cursor-pointer"
                      >
                        {structureCollapsed ? (
                          <ChevronRight className="w-3.5 h-3.5 text-orange-400" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-orange-400" />
                        )}
                        <span className="font-medium">
                          {structureCollapsed ? 'Expand Tree' : 'Collapse Tree'}
                        </span>
                      </button>

                      {structureCollapsed && (
                        <span className="text-[10px] text-orange-300 bg-orange-500/15 border border-orange-500/40 px-1.5 py-0.5 rounded tabular-nums">
                          {extractedBlockIds.length} hidden
                        </span>
                      )}
                    </div>

                    {!structureCollapsed && extractedFolderPaths.length > 0 && (
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-0.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleExpandAll}
                            className="hover:text-zinc-200 transition underline cursor-pointer"
                          >
                            Expand All
                          </button>
                          <span>•</span>
                          <button
                            type="button"
                            onClick={handleCollapseAll}
                            className="hover:text-zinc-200 transition underline cursor-pointer"
                          >
                            Collapse All
                          </button>
                        </div>
                        <span className="text-zinc-500">{extractedFolderPaths.length} folders</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                aria-label="Choose or drop .ZIP archive"
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`p-6 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-center cursor-pointer transition ${
                  isDraggingOver
                    ? 'border-amber-400 bg-amber-950/20'
                    : 'border-[#22262B] hover:border-amber-500/50 bg-[#13151A]'
                }`}
              >
                <Upload className="w-5 h-5 text-amber-400 mb-1.5" />
                <div className="text-xs font-semibold text-zinc-200">Choose or drop .ZIP archive</div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  Instant in-memory extraction
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="p-2 bg-red-950/40 border border-red-900/60 rounded text-[11px] text-red-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="truncate">{errorMessage}</span>
              </div>
            )}
          </div>

          {/* --- EXTENSION DRAWER --- */}
          {isDrawerOpen && (
            <div className="border-t border-[#22262B] bg-[#13151A] p-2.5 overflow-auto text-[11px] font-mono text-zinc-400 space-y-1 max-h-36">
              <div className="flex items-center justify-between pb-1 border-b border-[#1E2228] text-zinc-500 text-[10px] uppercase font-semibold">
                <span>Archive Manifest</span>
                <span>Local DB</span>
              </div>
              <div className="space-y-1 text-[10px]">
                <div><strong className="text-zinc-300">Archive:</strong> {fileName || 'None'}</div>
                <div><strong className="text-zinc-300">Compressed:</strong> {formatFileSize(size)}</div>
                <div><strong className="text-zinc-300">Extracted:</strong> {extractedBlockIds.length} files</div>
                <div><strong className="text-zinc-300">Folders:</strong> {extractedFolderPaths.length}</div>
              </div>
            </div>
          )}

          {/* Footer / Status Bar */}
          <div className="h-[26px] px-3 border-t border-[#1C2025] bg-[#111317] flex items-center justify-between text-[10px] font-mono text-zinc-400 shrink-0">
            <div className="flex items-center gap-2">
              <span>{extractedBlockIds.length} files</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDrawerOpen(!isDrawerOpen);
                }}
                aria-expanded={isDrawerOpen}
                className="text-zinc-300 hover:text-white flex items-center gap-0.5 ml-1 cursor-pointer hover:underline"
              >
                {isDrawerOpen ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                <span>Manifest</span>
              </button>
            </div>
            <span className="uppercase text-amber-400/90 font-medium">{status}</span>
          </div>

          {/* --- INTERACTIVE RESIZE BORDERS --- */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'e')}
            className="absolute -right-1 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-500/30 transition-colors z-20"
            title="Resize width"
          />
          <div
            onMouseDown={(e) => handleResizeStart(e, 's')}
            className="absolute left-0 -bottom-1 right-0 h-2 cursor-ns-resize hover:bg-amber-500/30 transition-colors z-20"
            title="Resize height"
          />
          <div
            onMouseDown={(e) => handleResizeStart(e, 'se')}
            className="absolute -right-1 -bottom-1 w-3.5 h-3.5 cursor-nwse-resize z-30 hover:bg-amber-500/50 rounded-br transition-colors"
            title="Resize card"
          />
        </>
      )}
    </div>
  );
});
