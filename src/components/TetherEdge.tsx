'use client';

import React, { memo, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from 'reactflow';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Trash2 } from 'lucide-react';

export const TetherEdge = memo(function TetherEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const deleteTether = useWorkspaceStore((s) => s.deleteTether);
  const [showActions, setShowActions] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const label = data?.label || 'dependency';
  const isHighlighted = Boolean(data?.isHighlighted);
  const hasSelection = Boolean(data?.hasSelection);
  const isActive = isHighlighted || showActions;
  const normalizedLabel = label.toLowerCase();
  const isReference =
    normalizedLabel === 'reference' ||
    normalizedLabel === 'references' ||
    normalizedLabel.includes('ref');
  const isCopiedFrom = normalizedLabel === 'copied from';
  const isExtractedFrom = normalizedLabel === 'extracted from';

  const dimFactor = hasSelection && !isActive ? 0.38 : 1;

  const outerGlowColor = isActive
    ? 'rgba(249, 115, 22, 0.46)'
    : isCopiedFrom
    ? 'rgba(251, 146, 60, 0.30)'
    : hasSelection
    ? 'rgba(249, 115, 22, 0.10)'
    : 'rgba(249, 115, 22, 0.22)';

  const innerGlowColor = isActive
    ? 'rgba(251, 146, 60, 0.34)'
    : hasSelection
    ? 'rgba(249, 115, 22, 0.08)'
    : 'rgba(249, 115, 22, 0.16)';

  const strokeStyle: React.CSSProperties = {
    ...style,
    stroke: isActive
      ? '#f97316'
      : isCopiedFrom
      ? '#fb923c'
      : isExtractedFrom
      ? '#71717a'
      : isReference
      ? '#8b8b94'
      : '#b4b4bd',
    strokeWidth: isActive ? 2.4 : isCopiedFrom ? 2 : 1.75,
    strokeDasharray: isCopiedFrom ? '4 4' : isReference ? '5 5' : undefined,
    opacity: dimFactor,
    transition: 'stroke 150ms ease, opacity 150ms ease, stroke-width 150ms ease',
  };

  return (
    <>
      {/* Faint Orange Outer Ambient Glow */}
      <path
        d={edgePath}
        fill="none"
        stroke={outerGlowColor}
        strokeWidth={isActive ? 10 : 7}
        strokeLinecap="round"
        style={{
          filter: 'blur(3.5px)',
          pointerEvents: 'none',
          transition: 'stroke 150ms ease, stroke-width 150ms ease',
        }}
      />
      {/* Tight Orange Halo */}
      <path
        d={edgePath}
        fill="none"
        stroke={innerGlowColor}
        strokeWidth={isActive ? 4.5 : 3.25}
        strokeLinecap="round"
        style={{
          pointerEvents: 'none',
          transition: 'stroke 150ms ease, stroke-width 150ms ease',
        }}
      />
      {/* Crisp Cord */}
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={strokeStyle} />
      {/* Wide Transparent Hit Path for Smooth Hover Glow */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        className="react-flow__edge-interaction cursor-pointer"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            opacity: hasSelection && !isActive ? 0.52 : 1,
          }}
          className="nodrag nopan transition-opacity duration-150"
          onMouseEnter={() => setShowActions(true)}
          onMouseLeave={() => setShowActions(false)}
        >
          <div
            className={`flex items-center gap-1 glass-menu border rounded-md px-2 py-0.5 text-[10px] font-mono transition-colors ${
              isActive
                ? 'border-orange-500/80 text-orange-100 shadow-[0_0_12px_rgba(249,115,22,0.28)]'
                : 'border-zinc-700/80 text-zinc-300 shadow-[0_0_8px_rgba(249,115,22,0.10)]'
            }`}
          >
            <span>{label}</span>

            {showActions && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTether(id);
                }}
                className="text-zinc-400 hover:text-red-400 p-0.5 hover:bg-zinc-800 rounded transition cursor-pointer"
                title="Delete tether"
                aria-label="Delete tether"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
