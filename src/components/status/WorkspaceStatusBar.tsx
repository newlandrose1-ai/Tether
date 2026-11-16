'use client';

import React from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  FolderTree,
  LayoutGrid,
  Edit3,
  Layers,
} from 'lucide-react';

export function WorkspaceStatusBar() {
  const isSidebarCollapsed = useWorkspaceStore((s) => s.isSidebarCollapsed);
  const selectedBlockId = useWorkspaceStore((s) => s.selectedBlockId);
  const activeEditorBlockId = useWorkspaceStore((s) => s.activeEditorBlockId);
  const isEditorOpen = useWorkspaceStore((s) => s.isEditorOpen);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const selectBlock = useWorkspaceStore((s) => s.selectBlock);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const closeEditorModal = useWorkspaceStore((s) => s.closeEditorModal);

  const editableTargetId = selectedBlockId || activeEditorBlockId;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 glass-header border-t border-zinc-700/80 z-30 safe-bottom select-none"
      role="navigation"
      aria-label="Mobile Navigation"
    >
      <div className="flex items-center justify-around h-13 px-2">
        {/* Project Hierarchy Drawer */}
        <button
          type="button"
          onClick={() => {
            if (isEditorOpen) closeEditorModal();
            toggleSidebar();
          }}
          aria-pressed={!isSidebarCollapsed}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[44px] py-1 transition-colors cursor-pointer ${
            !isSidebarCollapsed
              ? 'text-orange-400 font-semibold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label="Toggle Hierarchy"
        >
          <FolderTree className="w-5 h-5" />
          <span className="text-[10px] font-mono mt-0.5">Hierarchy</span>
        </button>

        {/* Canvas View */}
        <button
          type="button"
          onClick={() => {
            if (isEditorOpen) closeEditorModal();
            if (!isSidebarCollapsed) toggleSidebar();
          }}
          aria-pressed={isSidebarCollapsed && !isEditorOpen}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[44px] py-1 transition-colors cursor-pointer ${
            isSidebarCollapsed && !isEditorOpen
              ? 'text-orange-400 font-semibold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label="Canvas View"
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[10px] font-mono mt-0.5">Canvas</span>
        </button>

        {/* Pop-up Editor Toggle (when a block is selected or open) */}
        {editableTargetId && (
          <button
            type="button"
            onClick={() => {
              if (!isSidebarCollapsed) toggleSidebar();
              if (isEditorOpen) closeEditorModal();
              else openBlockInEditor(editableTargetId);
            }}
            aria-pressed={isEditorOpen}
            className={`flex flex-col items-center justify-center flex-1 h-full min-h-[44px] py-1 transition-colors cursor-pointer ${
              isEditorOpen
                ? 'text-orange-400 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            aria-label="Toggle Pop-up Editor"
          >
            <Edit3 className="w-5 h-5" />
            <span className="text-[10px] font-mono mt-0.5">Editor</span>
          </button>
        )}

        {/* Clear Selected Block */}
        {selectedBlockId && (
          <button
            type="button"
            onClick={() => {
              if (isEditorOpen) closeEditorModal();
              selectBlock(null);
            }}
            className="flex flex-col items-center justify-center flex-1 h-full min-h-[44px] py-1 text-zinc-300 hover:text-orange-300 font-semibold transition-colors cursor-pointer"
            aria-label="Deselect current block"
            title="Deselect current block"
          >
            <Layers className="w-5 h-5" />
            <span className="text-[10px] font-mono mt-0.5">Deselect</span>
          </button>
        )}
      </div>
    </nav>
  );
}
