'use client';

import React, { useState } from 'react';
import { Search, Replace, ChevronDown, ChevronUp, X } from 'lucide-react';

interface FindReplaceBarProps {
  onFind: (query: string, matchCase: boolean) => void;
  onReplace: (replaceWith: string) => void;
  onReplaceAll: (replaceWith: string) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  onClose: () => void;
  matchCount?: number;
  currentMatchIndex?: number;
}

export function FindReplaceBar({
  onFind,
  onReplace,
  onReplaceAll,
  onNextMatch,
  onPrevMatch,
  onClose,
  matchCount = 0,
  currentMatchIndex = 0,
}: FindReplaceBarProps) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [showReplace, setShowReplace] = useState(false);

  const handleFindChange = (val: string) => {
    setFindText(val);
    onFind(val, matchCase);
  };

  const handleToggleCase = () => {
    const next = !matchCase;
    setMatchCase(next);
    onFind(findText, next);
  };

  return (
    <div className="border-b border-zinc-800/80 bg-[#12151A] px-3 py-2 text-xs font-mono text-zinc-300 space-y-1.5 shadow-md z-20">
      {/* Find Row */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2 pointer-events-none" />
          <input
            type="text"
            autoFocus
            placeholder="Find in editor..."
            value={findText}
            onChange={(e) => handleFindChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) onPrevMatch();
                else onNextMatch();
              }
              if (e.key === 'Escape') onClose();
            }}
            className="w-full bg-[#0A0C0E] border border-zinc-700/80 focus:border-sky-500 rounded pl-7 pr-16 py-1 text-xs text-zinc-100 placeholder:text-zinc-400 outline-none"
          />
          <div className="absolute right-2 flex items-center gap-1 text-[11px] text-zinc-400">
            {findText ? (
              <span>
                {matchCount > 0 ? `${currentMatchIndex + 1}/${matchCount}` : 'No results'}
              </span>
            ) : null}
          </div>
        </div>

        {/* Case sensitive toggle */}
        <button
          type="button"
          onClick={handleToggleCase}
          className={`px-1.5 py-0.5 rounded text-[10px] border transition ${
            matchCase
              ? 'bg-sky-950 text-sky-300 border-sky-700'
              : 'text-zinc-400 hover:text-zinc-200 border-zinc-800'
          }`}
          title="Match Case (Aa)"
        >
          Aa
        </button>

        {/* Next & Prev */}
        <button
          type="button"
          onClick={onPrevMatch}
          disabled={matchCount === 0}
          className="p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 rounded"
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onNextMatch}
          disabled={matchCount === 0}
          className="p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 rounded"
          title="Next match (Enter)"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        {/* Toggle Replace */}
        <button
          type="button"
          onClick={() => setShowReplace(!showReplace)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition ${
            showReplace
              ? 'bg-zinc-800 text-zinc-100 border-zinc-600'
              : 'text-zinc-400 hover:text-zinc-200 border-zinc-800'
          }`}
        >
          <Replace className="w-3 h-3" />
          <span>Replace</span>
        </button>

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-zinc-400 hover:text-zinc-200 rounded ml-auto"
          title="Close find (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Replace Row */}
      {showReplace && (
        <div className="flex items-center gap-2 pt-1">
          <div className="relative flex items-center flex-1 max-w-sm">
            <input
              type="text"
              placeholder="Replace with..."
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="w-full bg-[#0A0C0E] border border-zinc-700/80 focus:border-sky-500 rounded px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-400 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => onReplace(replaceText)}
            disabled={matchCount === 0}
            className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded text-[11px] border border-zinc-700 cursor-pointer"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => onReplaceAll(replaceText)}
            disabled={matchCount === 0}
            className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded text-[11px] border border-zinc-700 cursor-pointer"
          >
            Replace All
          </button>
        </div>
      )}
    </div>
  );
}
