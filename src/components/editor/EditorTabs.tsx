'use client';

import React from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { Block, CodeBlockData, FileBlockData } from '../../types/model';
import { getFileTypeInfo } from '../../lib/fileTypes';
import {
  X,
  FileCode,
  FileText,
  FileJson,
  FileArchive,
  Image as ImageIcon,
  Music,
  Film,
  Binary,
  Globe,
} from 'lucide-react';

interface EditorTabsProps {
  openBlockIds: string[];
  activeId: string | null;
  dirtyBlockIds: Set<string>;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOthers: (id: string) => void;
}

export function EditorTabs({
  openBlockIds,
  activeId,
  dirtyBlockIds,
  onSelectTab,
  onCloseTab,
}: EditorTabsProps) {
  const blocks = useWorkspaceStore((s) => s.blocks);

  const getTabMeta = (block: Block) => {
    const fileData = block.kind === 'file' ? (block.data as FileBlockData) : undefined;
    const codeData = block.kind === 'code' ? (block.data as CodeBlockData) : undefined;
    const info = getFileTypeInfo({
      title: block.title,
      kind: block.kind,
      mimeType: fileData?.mimeType,
      binary: fileData?.binary,
      isPdf: fileData?.isPdf,
      language: codeData?.language,
    });

    let icon: React.ReactNode;
    switch (info.viewerKind) {
      case 'archive':
        icon = <FileArchive className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />;
        break;
      case 'pdf':
        icon = <FileText className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />;
        break;
      case 'image':
      case 'svg':
        icon = <ImageIcon className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
        break;
      case 'audio':
        icon = <Music className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />;
        break;
      case 'video':
        icon = <Film className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />;
        break;
      case 'html':
        icon = <Globe className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />;
        break;
      case 'binary':
        icon = <Binary className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />;
        break;
      case 'markdown':
        icon = <FileText className="w-3.5 h-3.5 text-zinc-300 flex-shrink-0" />;
        break;
      default:
        icon =
          info.badge === 'JSON' ? (
            <FileJson className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          ) : (
            <FileCode className={`w-3.5 h-3.5 ${info.accentColorClass} flex-shrink-0`} />
          );
    }

    return { info, icon };
  };

  if (openBlockIds.length === 0) {
    return null;
  }

  return (
    <div
      className="flex items-center h-11 sm:h-9 glass-header border-b border-zinc-700/75 overflow-x-auto no-scrollbar scroll-smooth select-none flex-shrink-0"
      role="tablist"
      aria-label="Open editor files"
    >
      {openBlockIds.map((id) => {
        const block = blocks.find((b) => b.id === id);
        if (!block) return null;

        const isActive = id === activeId;
        const isDirty = dirtyBlockIds.has(id);
        const { info, icon } = getTabMeta(block);

        return (
          <div
            key={id}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onClick={() => onSelectTab(id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelectTab(id);
              if (e.key === 'w' && (e.metaKey || e.ctrlKey)) onCloseTab(id);
            }}
            className={`group relative flex items-center gap-1.5 h-full px-3 text-xs border-r border-zinc-700/65 cursor-pointer transition-colors min-w-[110px] max-w-[220px] outline-none flex-shrink-0 ${
              isActive
                ? 'bg-zinc-900/70 text-zinc-100 font-medium border-t-2 border-t-orange-500'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/45'
            }`}
          >
            <span className="flex-shrink-0">{icon}</span>

            <span className="truncate flex-1" title={block.title}>
              {block.title}
            </span>

            <span
              className={`text-[9px] font-mono px-1 rounded border flex-shrink-0 ${info.badgeClass}`}
            >
              {info.badge}
            </span>

            {/* Unsaved changes dot indicator */}
            {isDirty && (
              <span
                className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"
                title="Unsaved changes"
              />
            )}

            {/* Close Tab Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(id);
              }}
              className={`w-7 h-7 sm:w-5 sm:h-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 transition cursor-pointer ${
                isActive ? 'opacity-90' : 'opacity-60 sm:opacity-0 group-hover:opacity-100'
              }`}
              title="Close tab"
              aria-label={`Close tab ${block.title}`}
            >
              <X className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
