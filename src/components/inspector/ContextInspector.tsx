'use client';

import React, { useState, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { StructureTab } from './StructureTab';
import { DetailsTab } from './DetailsTab';
import { ChangesTab } from './ChangesTab';
import { analyzeCodeStructure } from '../../lib/codeStructure';
import type { CodeBlockData, TextBlockData, FileBlockData } from '../../types/model';
import {
  Layers,
  Info,
  GitCompare,
  PanelRightClose,
  X,
} from 'lucide-react';

export function ContextInspector() {
  const blocks = useWorkspaceStore((s) => s.blocks);
  const activeEditorBlockId = useWorkspaceStore((s) => s.activeEditorBlockId);
  const isInspectorCollapsed = useWorkspaceStore((s) => s.isInspectorCollapsed);
  const toggleInspector = useWorkspaceStore((s) => s.toggleInspector);

  const [activeTab, setActiveTab] = useState<'structure' | 'details' | 'changes'>('structure');

  const activeBlock = blocks.find((b) => b.id === activeEditorBlockId);

  // Content & language for symbol extraction
  const content = useMemo(() => {
    if (!activeBlock) return '';
    if (activeBlock.kind === 'code') {
      return (activeBlock.data as CodeBlockData)?.currentContent || '';
    }
    if (activeBlock.kind === 'text') {
      return (activeBlock.data as TextBlockData)?.content || '';
    }
    if (activeBlock.kind === 'file') {
      return (activeBlock.data as FileBlockData)?.content || '';
    }
    return '';
  }, [activeBlock]);

  const language = useMemo(() => {
    if (!activeBlock) return 'javascript';
    if (activeBlock.kind === 'code') {
      return (activeBlock.data as CodeBlockData)?.language || 'javascript';
    }
    const ext = activeBlock.title.split('.').pop()?.toLowerCase();
    if (ext === 'json') return 'json';
    if (ext === 'ts' || ext === 'tsx') return 'typescript';
    return 'javascript';
  }, [activeBlock]);

  const { symbols } = useMemo(() => {
    return analyzeCodeStructure(content, language);
  }, [content, language]);

  if (isInspectorCollapsed) {
    return null;
  }

  return (
    <aside
      className="w-full sm:w-80 flex-shrink-0 glass-panel border-l border-zinc-700/75 flex flex-col h-full select-none text-zinc-300"
      role="region"
      aria-label="Context Inspector"
    >
      {/* Top Header */}
      <div className="h-12 sm:h-10 px-3 border-b border-zinc-700/75 glass-header flex items-center justify-between text-xs">
        <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[11px] font-mono flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          <span>Inspector</span>
        </span>

        <button
          type="button"
          onClick={toggleInspector}
          className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded transition cursor-pointer"
          title="Close Inspector"
          aria-label="Close Inspector"
        >
          <X className="w-4 h-4 sm:hidden" />
          <PanelRightClose className="hidden sm:block w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab Controls */}
      <div className="flex items-center border-b border-zinc-700/75 bg-zinc-950/35 px-2 gap-1 text-xs font-mono">
        <button
          type="button"
          onClick={() => setActiveTab('structure')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 border-b-2 text-xs font-medium flex-1 transition cursor-pointer ${
            activeTab === 'structure'
              ? 'border-orange-500 text-zinc-100'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Layers className={`w-3.5 h-3.5 ${activeTab === 'structure' ? 'text-orange-400' : ''}`} />
          <span>Structure</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('details')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 border-b-2 text-xs font-medium flex-1 transition cursor-pointer ${
            activeTab === 'details'
              ? 'border-orange-500 text-zinc-100'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Info className={`w-3.5 h-3.5 ${activeTab === 'details' ? 'text-orange-400' : ''}`} />
          <span>Details</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('changes')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 border-b-2 text-xs font-medium flex-1 transition cursor-pointer ${
            activeTab === 'changes'
              ? 'border-orange-500 text-zinc-100'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <GitCompare className={`w-3.5 h-3.5 ${activeTab === 'changes' ? 'text-orange-400' : ''}`} />
          <span>History</span>
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-hidden flex flex-col pb-16 md:pb-0">
        {!activeBlock ? (
          <div className="p-6 text-center text-xs text-zinc-400 font-mono">
            Open a file to inspect its structure and properties.
          </div>
        ) : activeTab === 'structure' ? (
          <StructureTab symbols={symbols} />
        ) : activeTab === 'details' ? (
          <DetailsTab block={activeBlock} />
        ) : (
          <ChangesTab block={activeBlock} />
        )}
      </div>
    </aside>
  );
}
