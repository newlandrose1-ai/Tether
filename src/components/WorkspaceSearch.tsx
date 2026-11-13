'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Search, X, FileText, Code, Archive, File } from 'lucide-react';
import type { BlockKind } from '../types/model';

function getKindIcon(kind: BlockKind) {
  switch (kind) {
    case 'text':
      return <FileText className="w-3 h-3 text-zinc-400" />;
    case 'code':
      return <Code className="w-3 h-3 text-zinc-400" />;
    case 'upload':
      return <Archive className="w-3 h-3 text-zinc-400" />;
    case 'file':
      return <File className="w-3 h-3 text-zinc-400" />;
  }
}

export function WorkspaceSearch() {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const groups = useWorkspaceStore((s) => s.groups);
  const setActiveGroup = useWorkspaceStore((s) => s.setActiveGroup);
  const selectBlock = useWorkspaceStore((s) => s.selectBlock);
  const setFocusedBlockId = useWorkspaceStore((s) => s.setFocusedBlockId);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const requestFocusViewport = useWorkspaceStore((s) => s.requestFocusViewport);

  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchResults = useMemo(() => {
    if (!activeProjectId || !query.trim()) return [];
    const q = query.toLowerCase().trim();

    return blocks
      .filter((b) => b.projectId === activeProjectId)
      .filter((b) => {
        // Title match
        if (b.title.toLowerCase().includes(q)) return true;

        // Content matches based on kind
        if (b.kind === 'text') {
          const content = (b.data as { content?: string })?.content;
          return typeof content === 'string' && content.toLowerCase().includes(q);
        }

        if (b.kind === 'code') {
          const codeData = b.data as { path?: string; currentContent?: string; language?: string };
          if (codeData?.path && codeData.path.toLowerCase().includes(q)) return true;
          if (codeData?.language && codeData.language.toLowerCase().includes(q)) return true;
          return typeof codeData?.currentContent === 'string' && codeData.currentContent.toLowerCase().includes(q);
        }

        if (b.kind === 'file') {
          const fileData = b.data as { path?: string; content?: string };
          if (fileData?.path && fileData.path.toLowerCase().includes(q)) return true;
          return typeof fileData?.content === 'string' && fileData.content.toLowerCase().includes(q);
        }

        if (b.kind === 'upload') {
          const uploadData = b.data as { fileName?: string };
          return typeof uploadData?.fileName === 'string' && uploadData.fileName.toLowerCase().includes(q);
        }

        return false;
      })
      .slice(0, 10); // Limit to top 10 concise results
  }, [blocks, activeProjectId, query]);

  const handleSelectResult = (blockId: string, groupId: string) => {
    setFocusedBlockId(null);
    setActiveGroup(groupId);
    selectBlock(blockId);
    requestFocusViewport(blockId);
    openBlockInEditor(blockId);
    setIsOpen(false);
    setMobileExpanded(false);
  };

  const [mobileExpanded, setMobileExpanded] = useState(false);

  return (
    <>
      {/* Mobile search trigger icon (< md) */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => {
            setMobileExpanded(true);
            setIsOpen(true);
          }}
          className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded min-w-[40px] min-h-[40px] flex items-center justify-center transition cursor-pointer"
          title="Search blocks"
          aria-label="Search blocks"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Mobile search overlay modal */}
        {mobileExpanded && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col p-3 safe-top">
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1 flex items-center">
                <Search className="w-4 h-4 text-orange-400 absolute left-3 pointer-events-none" />
                <input
                  type="search"
                  autoFocus
                  placeholder="Search project files..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full glass-menu border border-zinc-700/80 focus:border-orange-500/75 rounded-lg text-base pl-9 pr-8 py-2 text-zinc-100 placeholder:text-zinc-500 outline-none transition font-mono"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-2.5 text-zinc-400 hover:text-zinc-200 p-1"
                    title="Clear"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileExpanded(false);
                  setQuery('');
                }}
                className="px-3 py-2 text-sm text-orange-300 hover:text-orange-200 cursor-pointer min-h-[44px] flex items-center"
              >
                Done
              </button>
            </div>

            {/* Mobile results list */}
            <div className="flex-1 overflow-y-auto glass-panel border border-zinc-700/80 rounded-lg divide-y divide-zinc-700/60 font-mono text-xs animate-panel-in">
              <div className="px-3 py-2 border-b border-zinc-700/70 text-[11px] text-zinc-400 uppercase font-semibold flex justify-between">
                <span>Results ({searchResults.length})</span>
                <span>Active Project</span>
              </div>

              {searchResults.length === 0 ? (
                <div className="p-6 text-center text-zinc-500 italic">
                  {query ? 'No matching blocks found.' : 'Type to search...'}
                </div>
              ) : (
                searchResults.map((b) => {
                  const group = groups.find((g) => g.id === b.groupId);
                  return (
                    <div
                      key={b.id}
                      onClick={() => {
                        handleSelectResult(b.id, b.groupId);
                        setMobileExpanded(false);
                      }}
                      className="p-3 hover:bg-zinc-800/80 active:bg-zinc-800 cursor-pointer transition flex items-center justify-between gap-2 min-h-[44px]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {getKindIcon(b.kind)}
                        <span className="text-zinc-100 text-sm truncate font-medium">{b.title}</span>
                        <span className="text-[10px] uppercase px-1.5 py-0.5 text-zinc-400 bg-zinc-950 border border-zinc-800 rounded">
                          {b.kind}
                        </span>
                      </div>

                      {group && (
                        <div className="flex items-center gap-1.5 text-xs text-zinc-400 flex-shrink-0">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          <span className="truncate max-w-[100px]">{group.name}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Desktop Search input (md:flex) */}
      <div ref={containerRef} className="hidden md:block relative flex-1 max-w-xs mx-2">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            placeholder="Search project blocks..."
            value={query}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            className="w-full bg-zinc-900/75 border border-zinc-700/80 focus:border-orange-500/75 rounded text-xs pl-8 pr-7 py-1 text-zinc-100 placeholder:text-zinc-500 outline-none transition font-mono"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setIsOpen(false);
              }}
              className="absolute right-2 text-zinc-500 hover:text-zinc-300 text-xs p-0.5 cursor-pointer"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Desktop Results Dropdown */}
        {isOpen && query.trim().length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 glass-menu border border-zinc-600/80 rounded-lg z-50 overflow-hidden font-mono text-xs max-h-72 overflow-y-auto animate-panel-in">
            <div className="px-2.5 py-1.5 border-b border-zinc-700/70 text-[10px] text-zinc-400 uppercase font-semibold flex justify-between">
              <span>Results ({searchResults.length})</span>
              <span>Active Project</span>
            </div>

            {searchResults.length === 0 ? (
              <div className="p-3 text-center text-zinc-400 italic">
                No matching blocks found.
              </div>
            ) : (
              <div className="divide-y divide-zinc-700/50">
                {searchResults.map((b) => {
                  const group = groups.find((g) => g.id === b.groupId);
                  return (
                    <div
                      key={b.id}
                      onClick={() => handleSelectResult(b.id, b.groupId)}
                      className="p-2 hover:bg-orange-500/12 cursor-pointer transition flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {getKindIcon(b.kind)}
                        <span className="text-zinc-200 truncate font-medium">{b.title}</span>
                        <span className="text-[9px] uppercase px-1 py-0.2 text-zinc-400 bg-zinc-950 border border-zinc-800 rounded">
                          {b.kind}
                        </span>
                      </div>

                      {group && (
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 flex-shrink-0">
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          <span className="truncate max-w-[90px]">{group.name}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
