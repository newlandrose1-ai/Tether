'use client';

import React, { useEffect } from 'react';
import { useWorkspaceStore } from './store/workspaceStore';
import { WorkspaceShell } from './components/WorkspaceShell';

export default function App() {
  const initStorage = useWorkspaceStore((s) => s.initStorage);
  const isInitialized = useWorkspaceStore((s) => s.isInitialized);

  useEffect(() => {
    initStorage();
    if (typeof window !== 'undefined') {
      (window as unknown as { tetherStore: typeof useWorkspaceStore }).tetherStore =
        useWorkspaceStore;
    }
  }, [initStorage]);

  if (!isInitialized) {
    return (
      <div className="h-screen w-screen bg-zinc-950 text-zinc-400 flex items-center justify-center font-mono text-xs select-none">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-zinc-500 animate-ping" />
          <span>Hydrating Tether workspace...</span>
        </div>
      </div>
    );
  }

  return <WorkspaceShell />;
}
