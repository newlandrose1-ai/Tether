'use client';

import React from 'react';
import type { CodeSection } from '../../lib/codeStructure';
import {
  ChevronRight,
  ChevronDown,
  Layers,
  Code2,
  Box,
  FileCode,
  Package,
  Copy,
  Check,
} from 'lucide-react';

interface ExpandableSectionHeaderProps {
  section: CodeSection;
  isCollapsed: boolean;
  onToggle: () => void;
  onJumpToLine?: (line: number) => void;
  errorCount?: number;
  warningCount?: number;
}

export function ExpandableSectionHeader({
  section,
  isCollapsed,
  onToggle,
  onJumpToLine,
  errorCount = 0,
  warningCount = 0,
}: ExpandableSectionHeaderProps) {
  const [copied, setCopied] = React.useState(false);

  const getBadgeStyle = (type: CodeSection['type']) => {
    switch (type) {
      case 'imports':
        return {
          icon: <Package className="w-3 h-3 text-indigo-400" />,
          bg: 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60',
          label: 'Imports',
        };
      case 'component':
        return {
          icon: <Box className="w-3 h-3 text-sky-400" />,
          bg: 'bg-sky-950/60 text-sky-300 border-sky-800/60',
          label: 'Component',
        };
      case 'function':
        return {
          icon: <Code2 className="w-3 h-3 text-emerald-400" />,
          bg: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
          label: 'Function',
        };
      case 'class':
        return {
          icon: <Layers className="w-3 h-3 text-amber-400" />,
          bg: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
          label: 'Class',
        };
      case 'constants':
        return {
          icon: <FileCode className="w-3 h-3 text-purple-400" />,
          bg: 'bg-purple-950/60 text-purple-300 border-purple-800/60',
          label: 'Config',
        };
      default:
        return {
          icon: <Code2 className="w-3 h-3 text-zinc-400" />,
          bg: 'bg-zinc-800 text-zinc-300 border-zinc-700',
          label: 'Block',
        };
    }
  };

  const badge = getBadgeStyle(section.type);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(section.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!isCollapsed}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`group flex items-center justify-between px-3 py-2 min-h-[44px] border border-zinc-700/70 rounded-md cursor-pointer select-none transition-colors outline-none focus-visible:ring-1 focus-visible:ring-orange-500 ${
        isCollapsed
          ? 'glass-card hover:border-zinc-500/80 text-zinc-300'
          : 'glass-panel border-b-zinc-700/50 text-zinc-200'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
        {/* Expand / Collapse Chevron */}
        <span className="w-5 h-5 flex items-center justify-center text-zinc-400 group-hover:text-orange-400 transition-colors flex-shrink-0">
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          ) : (
            <ChevronDown className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          )}
        </span>

        {/* Semantic Badge */}
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border flex-shrink-0 ${badge.bg}`}
        >
          {badge.icon}
          <span>{badge.label}</span>
        </span>

        {/* Section Label */}
        <span className="text-xs font-mono font-medium text-zinc-200 truncate flex-shrink-0">
          {section.label}
        </span>

        {/* Collapsed One-Line Snippet Preview */}
        {isCollapsed && section.preview && (
          <span className="text-[11px] font-mono text-zinc-500 truncate min-w-0 flex-1 pl-1 hidden sm:inline">
            — {section.preview}
          </span>
        )}
      </div>

      {/* Right Telemetry & Actions */}
      <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 flex-shrink-0">
        {errorCount > 0 && (
          <span className="text-[10px] font-semibold text-red-400 tabular-nums">
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        )}
        {errorCount === 0 && warningCount > 0 && (
          <span className="text-[10px] font-semibold text-amber-400 tabular-nums">
            {warningCount} {warningCount === 1 ? 'warn' : 'warns'}
          </span>
        )}
        <span className="tabular-nums">
          L{section.startLine}–L{section.endLine}
        </span>
        <span className="hidden sm:inline">•</span>
        <span className="hidden sm:inline tabular-nums">{section.lineCount} {section.lineCount === 1 ? 'line' : 'lines'}</span>

        {/* Copy Section Snippet */}
        <button
          type="button"
          onClick={handleCopy}
          className="w-8 h-8 sm:w-6 sm:h-6 flex items-center justify-center opacity-80 sm:opacity-0 group-hover:opacity-100 hover:text-zinc-100 hover:bg-zinc-700/60 rounded text-zinc-400 transition cursor-pointer"
          title="Copy section code"
          aria-label="Copy section code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 sm:w-3 sm:h-3" />}
        </button>

        {onJumpToLine && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onJumpToLine(section.startLine);
            }}
            className="hidden sm:inline-block opacity-0 group-hover:opacity-100 px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] transition cursor-pointer"
            title="Jump to line"
          >
            Jump
          </button>
        )}
      </div>
    </div>
  );
}
