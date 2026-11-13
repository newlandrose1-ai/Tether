'use client';

import React, { useState } from 'react';
import type { Block, FileBlockData, CodeBlockData } from '../../types/model';
import { getFileTypeInfo } from '../../lib/fileTypes';
import {
  FileText,
  FileCode,
  FileJson,
  FileArchive,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Edit2,
  Copy,
  Trash2,
  FilePlus,
  Image as ImageIcon,
  Music,
  Film,
  Binary,
  Globe,
} from 'lucide-react';

export interface TreeNodeItem {
  id: string;
  name: string;
  isFolder: boolean;
  path: string;
  block?: Block;
  children?: TreeNodeItem[];
}

interface FileTreeNodeProps {
  item: TreeNodeItem;
  level: number;
  activeId: string | null;
  filterQuery?: string;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelect: (blockId: string) => void;
  onEdit?: (blockId: string) => void;
  onRename: (block: Block) => void;
  onDuplicate: (block: Block) => void;
  onDelete: (block: Block) => void;
  onCreateFileInFolder?: (folderPath: string) => void;
}

/**
 * Highlights matching search query substrings
 */
function HighlightMatch({ text, query }: { text: string; query?: string }) {
  if (!query || !query.trim()) {
    return <span className="truncate">{text}</span>;
  }

  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  const matchIndex = lower.indexOf(q);

  if (matchIndex === -1) {
    return <span className="truncate">{text}</span>;
  }

  const before = text.slice(0, matchIndex);
  const match = text.slice(matchIndex, matchIndex + q.length);
  const after = text.slice(matchIndex + q.length);

  return (
    <span className="truncate">
      {before}
      <mark className="bg-orange-500/25 text-orange-200 font-semibold px-0.5 rounded-xs">
        {match}
      </mark>
      {after}
    </span>
  );
}

export function FileTreeNode({
  item,
  level,
  activeId,
  filterQuery = '',
  expandedFolders,
  onToggleFolder,
  onSelect,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
  onCreateFileInFolder,
}: FileTreeNodeProps) {
  const [showMenu, setShowMenu] = useState(false);

  const isOpen = expandedFolders.has(item.path);
  const isSelected = item.block?.id === activeId;

  const fileInfo = item.block
    ? getFileTypeInfo({
        title: item.name,
        kind: item.block.kind,
        mimeType: (item.block.data as FileBlockData)?.mimeType,
        binary: (item.block.data as FileBlockData)?.binary,
        isPdf: (item.block.data as FileBlockData)?.isPdf,
        language: (item.block.data as CodeBlockData)?.language,
      })
    : null;

  const getFileIcon = () => {
    if (!fileInfo) return <FileText className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />;
    switch (fileInfo.viewerKind) {
      case 'archive':
        return <FileArchive className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />;
      case 'pdf':
        return <FileText className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />;
      case 'image':
      case 'svg':
        return <ImageIcon className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
      case 'audio':
        return <Music className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />;
      case 'video':
        return <Film className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />;
      case 'html':
        return <Globe className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />;
      case 'binary':
        return <Binary className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />;
      case 'markdown':
        return <FileText className="w-3.5 h-3.5 text-zinc-300 flex-shrink-0" />;
      default:
        if (fileInfo.badge === 'JSON') {
          return <FileJson className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />;
        }
        return <FileCode className={`w-3.5 h-3.5 ${fileInfo.accentColorClass} flex-shrink-0`} />;
    }
  };

  const indentPx = level * 14 + 6;

  // Folder item
  if (item.isFolder) {
    const childCount = item.children?.length ?? 0;

    return (
      <div className="select-none relative" role="none">
        <div
          role="treeitem"
          tabIndex={0}
          aria-expanded={isOpen}
          aria-selected={false}
          onClick={() => onToggleFolder(item.path)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleFolder(item.path);
            }
          }}
          style={{ paddingLeft: `${indentPx}px` }}
          className="group relative flex items-center justify-between min-h-[38px] sm:h-7 py-1 sm:py-0 pr-2 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 rounded-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500"
        >
          {/* Depth guide line for current level */}
          {Array.from({ length: level }).map((_, i) => (
            <span
              key={i}
              className="absolute top-0 bottom-0 border-l border-zinc-700/70 pointer-events-none"
              style={{ left: `${i * 14 + 11}px` }}
            />
          ))}

          <div className="flex items-center gap-1.5 min-w-0 flex-1 py-1">
            <span className="w-5 h-5 sm:w-3.5 sm:h-3.5 flex items-center justify-center text-zinc-400 group-hover:text-orange-400 transition-colors">
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 sm:w-3 sm:h-3 transition-transform" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 sm:w-3 sm:h-3 transition-transform" />
              )}
            </span>

            {isOpen ? (
              <FolderOpen className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-orange-400 fill-orange-400/20 flex-shrink-0" />
            ) : (
              <Folder className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-orange-400/85 fill-orange-400/15 flex-shrink-0" />
            )}

            <HighlightMatch text={item.name} query={filterQuery} />

            <span className="text-[10px] font-mono text-zinc-400 tabular-nums opacity-60 sm:opacity-0 group-hover:opacity-100 transition-opacity ml-1">
              {childCount}
            </span>
          </div>

          {/* Quick Action: New file in folder */}
          {onCreateFileInFolder && (
            <div className="opacity-80 sm:opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateFileInFolder(item.path);
                }}
                className="w-8 h-8 sm:w-6 sm:h-6 flex items-center justify-center hover:text-zinc-100 hover:bg-zinc-700/60 rounded text-zinc-400 transition cursor-pointer"
                title={`New file in ${item.name}`}
                aria-label={`New file in ${item.name}`}
              >
                <FilePlus className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Children nodes */}
        {isOpen && item.children && item.children.length > 0 && (
          <div className="relative">
            {item.children.map((child) => (
              <FileTreeNode
                key={child.id}
                item={child}
                level={level + 1}
                activeId={activeId}
                filterQuery={filterQuery}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onSelect={onSelect}
                onEdit={onEdit}
                onRename={onRename}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onCreateFileInFolder={onCreateFileInFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File item
  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-selected={isSelected}
      onClick={() => item.block && onSelect(item.block.id)}
      onDoubleClick={() => {
        if (item.block && onEdit) {
          onEdit(item.block.id);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (item.block) onSelect(item.block.id);
        }
      }}
      style={{ paddingLeft: `${indentPx + 4}px` }}
      className={`group relative flex items-center justify-between min-h-[38px] sm:h-7 py-1 sm:py-0 pr-2 text-xs rounded-sm cursor-pointer transition-colors select-none border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 ${
        isSelected
          ? 'bg-orange-500/12 border-orange-500/35 text-orange-100 font-medium'
          : 'border-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/45'
      }`}
    >
      {/* Depth guide lines */}
      {Array.from({ length: level }).map((_, i) => (
        <span
          key={i}
          className="absolute top-0 bottom-0 border-l border-zinc-700/70 pointer-events-none"
          style={{ left: `${i * 14 + 11}px` }}
        />
      ))}

      <div className="flex items-center gap-1.5 min-w-0 flex-1 py-1">
        <span className="w-4 h-4 sm:w-3.5 sm:h-3.5 flex items-center justify-center flex-shrink-0">
          {getFileIcon()}
        </span>
        <HighlightMatch text={item.name} query={filterQuery} />
        {fileInfo && (
          <span
            className={`text-[9px] font-mono font-semibold px-1 py-0 rounded border flex-shrink-0 opacity-85 ${fileInfo.badgeClass}`}
          >
            {fileInfo.badge}
          </span>
        )}
        {item.block?.lastAuditStatus === 'failed' && (
          <span className="text-[10px] font-mono text-red-400 flex-shrink-0" title="Audit errors">
            !
          </span>
        )}
        {item.block?.copiedFromBlockId && item.block?.lastAuditStatus !== 'failed' && (
          <span className="text-[10px] font-mono text-amber-400 flex-shrink-0" title="Copied draft">
            copy
          </span>
        )}
      </div>

      {item.block && (
        <div
          className="relative opacity-80 sm:opacity-0 group-hover:opacity-100 flex items-center transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="w-8 h-8 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 rounded transition cursor-pointer"
            title="File actions"
            aria-label="File actions"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-7 z-50 w-44 glass-menu border border-zinc-600/80 rounded-lg py-1 text-xs font-mono text-zinc-300 animate-panel-in">
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      if (item.block) onEdit(item.block.id);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 min-h-[38px] hover:bg-orange-500/15 hover:text-zinc-100 text-left transition cursor-pointer"
                  >
                    <FileCode className="w-3.5 h-3.5 text-orange-400" />
                    <span>{fileInfo?.isTextEditable ? 'Open Editor' : 'Open Viewer'}</span>
                  </button>
                )}
                {fileInfo?.isTextEditable !== false && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      if (item.block) onDuplicate(item.block);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 min-h-[38px] hover:bg-zinc-800 hover:text-zinc-100 text-left transition cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Copy &amp; Audit</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    if (item.block) onRename(item.block);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 min-h-[38px] hover:bg-zinc-800 hover:text-zinc-100 text-left transition cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Rename</span>
                </button>
                <div className="my-1 border-t border-zinc-800" />
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    if (item.block) onDelete(item.block);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 min-h-[40px] hover:bg-red-950/60 text-red-400 hover:text-red-300 text-left transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
