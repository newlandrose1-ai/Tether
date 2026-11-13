'use client';

import React, { useState, useMemo } from 'react';
import type { Block, CodeBlockData } from '../../types/model';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { computeLineDiff } from '../../lib/lineDiff';
import { RotateCcw, Check } from 'lucide-react';

interface ChangesTabProps {
  block: Block;
}

export function ChangesTab({ block }: ChangesTabProps) {
  const rollbackCodeRevision = useWorkspaceStore((s) => s.rollbackCodeRevision);

  const codeData = block.kind === 'code' ? (block.data as CodeBlockData) : null;
  const revisions = codeData?.revisions || [];
  const currentContent = codeData?.currentContent || '';

  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    revisions.length > 0 ? revisions[revisions.length - 1].id : null
  );

  const selectedRevision = revisions.find((r) => r.id === selectedRevisionId);
  const baselineContent = selectedRevision ? selectedRevision.content : '';

  const diffResult = useMemo(() => {
    return computeLineDiff(baselineContent, currentContent);
  }, [baselineContent, currentContent]);

  const handleRollback = async () => {
    if (!selectedRevision) return;
    await rollbackCodeRevision(block.id, selectedRevision.id);
  };

  if (block.kind !== 'code') {
    return (
      <div className="p-4 text-center text-xs text-zinc-400 font-mono">
        Revision history is available for code files.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 overflow-y-auto text-xs font-mono select-none">
      {/* Revision Selection */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span>Compare against</span>
          <span>{revisions.length} snapshots</span>
        </div>

        {revisions.length === 0 ? (
          <div className="text-[11px] text-zinc-500 py-2">
            No snapshots saved yet.
          </div>
        ) : (
          <select
            value={selectedRevisionId || ''}
            onChange={(e) => setSelectedRevisionId(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none"
          >
            {revisions
              .slice()
              .reverse()
              .map((rev) => (
                <option key={rev.id} value={rev.id}>
                  {rev.label || 'snapshot'} (
                  {new Date(rev.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  )
                </option>
              ))}
          </select>
        )}
      </div>

      {/* Diff Metrics & Rollback */}
      {selectedRevision && (
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-900/60 border border-zinc-800/80 rounded">
          <div className="flex items-center gap-3">
            <span className="text-emerald-400">+{diffResult.additions}</span>
            <span className="text-red-400">-{diffResult.deletions}</span>
          </div>

          <button
            type="button"
            onClick={handleRollback}
            className="flex items-center gap-1 px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] border border-zinc-700 transition cursor-pointer"
            title="Restore file to this snapshot"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Restore</span>
          </button>
        </div>
      )}

      {/* Diff View */}
      {revisions.length > 0 && (
        <div className="border border-zinc-800/80 rounded overflow-hidden bg-[#090A0D]">
          <div className="max-h-96 overflow-y-auto text-[11px] font-mono leading-relaxed divide-y divide-zinc-900">
            {diffResult.lines.length === 0 ? (
              <div className="p-4 text-center text-zinc-500">No content</div>
            ) : !diffResult.hasChanges ? (
              <div className="p-4 text-center text-zinc-400 flex items-center justify-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Matches selected snapshot</span>
              </div>
            ) : (
              diffResult.lines.map((line, idx) => {
                if (line.type === 'added') {
                  return (
                    <div
                      key={idx}
                      className="flex items-start bg-emerald-950/30 text-emerald-300 px-2 py-0.5"
                    >
                      <span className="w-5 text-emerald-500 select-none text-right pr-2">
                        +
                      </span>
                      <span className="flex-1 whitespace-pre-wrap break-all">
                        {line.text}
                      </span>
                    </div>
                  );
                }
                if (line.type === 'removed') {
                  return (
                    <div
                      key={idx}
                      className="flex items-start bg-red-950/30 text-red-300 px-2 py-0.5 line-through decoration-red-500/40"
                    >
                      <span className="w-5 text-red-500 select-none text-right pr-2">
                        -
                      </span>
                      <span className="flex-1 whitespace-pre-wrap break-all">
                        {line.text}
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="flex items-start text-zinc-400 px-2 py-0.5">
                    <span className="w-5 text-zinc-600 select-none text-right pr-2">
                      {line.newLineNumber || line.oldLineNumber}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all">
                      {line.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
