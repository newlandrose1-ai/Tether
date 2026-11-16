'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type React from 'react';

interface UseBlockResizeOptions {
  blockId: string;
  width?: number;
  height?: number;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  onCommit: (id: string, size: { width: number; height: number }) => void;
}

export function useBlockResize({
  blockId,
  width,
  height,
  defaultWidth,
  defaultHeight,
  minWidth = 260,
  maxWidth = 800,
  minHeight = 160,
  maxHeight = 700,
  onCommit,
}: UseBlockResizeOptions) {
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: 'e' | 's' | 'se') => {
      e.preventDefault();
      e.stopPropagation();

      if (cleanupRef.current) {
        cleanupRef.current();
      }

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = width ?? defaultWidth;
      const startHeight = height ?? defaultHeight;

      let latestWidth = startWidth;
      let latestHeight = startHeight;

      setLiveSize({ width: startWidth, height: startHeight });

      const handleMouseMove = (moveEvent: MouseEvent) => {
        let nextWidth = startWidth;
        let nextHeight = startHeight;

        if (direction === 'e' || direction === 'se') {
          nextWidth = Math.round(
            Math.max(minWidth, Math.min(maxWidth, startWidth + (moveEvent.clientX - startX)))
          );
        }
        if (direction === 's' || direction === 'se') {
          nextHeight = Math.round(
            Math.max(minHeight, Math.min(maxHeight, startHeight + (moveEvent.clientY - startY)))
          );
        }

        latestWidth = nextWidth;
        latestHeight = nextHeight;

        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            setLiveSize({ width: latestWidth, height: latestHeight });
          });
        }
      };

      const handleMouseUp = () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        cleanupRef.current = null;
        setLiveSize(null);
        onCommit(blockId, { width: latestWidth, height: latestHeight });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      cleanupRef.current = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    },
    [blockId, width, height, defaultWidth, defaultHeight, minWidth, maxWidth, minHeight, maxHeight, onCommit]
  );

  return {
    liveWidth: liveSize?.width ?? width ?? defaultWidth,
    liveHeight: liveSize?.height ?? height,
    isResizing: liveSize !== null,
    handleResizeStart,
  };
}
