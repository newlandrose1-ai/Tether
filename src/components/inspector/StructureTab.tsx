'use client';

import React from 'react';
import type { CodeSymbol } from '../../lib/codeStructure';
import { Code2, Box, Layers, Package, Tag, ArrowRight } from 'lucide-react';

interface StructureTabProps {
  symbols: CodeSymbol[];
  onJumpToLine?: (line: number) => void;
}

export function StructureTab({ symbols, onJumpToLine }: StructureTabProps) {
  const getIcon = (kind: CodeSymbol['kind']) => {
    switch (kind) {
      case 'component':
        return <Box className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />;
      case 'function':
        return <Code2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
      case 'class':
        return <Layers className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />;
      case 'export':
        return <Package className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />;
      case 'interface':
        return <Tag className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />;
      default:
        return <Code2 className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />;
    }
  };

  if (symbols.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-zinc-400 font-mono">
        No symbols or structures detected in this file.
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1 overflow-y-auto">
      <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 px-2 py-1 font-semibold">
        Detected Symbols ({symbols.length})
      </div>
      {symbols.map((sym) => (
        <div
          key={sym.id}
          onClick={() => onJumpToLine && onJumpToLine(sym.line)}
          className="group flex items-center justify-between px-2.5 py-1.5 hover:bg-zinc-800/80 rounded cursor-pointer transition text-xs font-mono select-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            {getIcon(sym.kind)}
            <span className="truncate text-zinc-200 group-hover:text-zinc-100 font-medium">
              {sym.name}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-zinc-400 group-hover:text-zinc-300 text-[11px] flex-shrink-0">
            <span>L{sym.line}</span>
            <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
          </div>
        </div>
      ))}
    </div>
  );
}
