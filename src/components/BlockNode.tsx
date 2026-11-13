'use client';

import React, { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type {
  Block,
  TetherGroup,
  TextBlockData,
  UploadBlockData,
  FileBlockData,
  CodeBlockData,
} from '../types/model';
import { useWorkspaceStore } from '../store/workspaceStore';
import { TextBlock } from './blocks/TextBlock';
import { UploadBlock } from './blocks/UploadBlock';
import { FileBlock } from './blocks/FileBlock';
import { CodeBlock } from './blocks/CodeBlock';

export interface BlockNodeData {
  block: Block;
  group?: TetherGroup;
  isConnectingSource: boolean;
  isValidTarget: boolean;
  isInvalidTarget: boolean;
}

export const BlockNode = memo(function BlockNode({
  data,
  selected,
}: NodeProps<BlockNodeData>) {
  const { block, group, isConnectingSource, isValidTarget, isInvalidTarget } = data;

  const connectingSourceBlockId = useWorkspaceStore((s) => s.connectingSourceBlockId);
  const setConnectingSourceBlockId = useWorkspaceStore((s) => s.setConnectingSourceBlockId);
  const createTether = useWorkspaceStore((s) => s.createTether);
  const selectBlock = useWorkspaceStore((s) => s.selectBlock);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);

  const handleStartTether = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setConnectingSourceBlockId(block.id);
    },
    [block.id, setConnectingSourceBlockId]
  );

  const handleCompleteTether = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!connectingSourceBlockId || !isValidTarget) return;
      await createTether(connectingSourceBlockId, block.id, 'dependency');
      setConnectingSourceBlockId(null);
    },
    [connectingSourceBlockId, isValidTarget, createTether, block.id, setConnectingSourceBlockId]
  );

  const handleNodeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isValidTarget && connectingSourceBlockId) {
        handleCompleteTether(e);
        return;
      }
      selectBlock(block.id);
    },
    [isValidTarget, connectingSourceBlockId, handleCompleteTether, selectBlock, block.id]
  );

  const handleNodeDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      openBlockInEditor(block.id);
    },
    [block.id, openBlockInEditor]
  );

  return (
    <div
      onClick={handleNodeClick}
      onDoubleClick={handleNodeDoubleClick}
      className="relative group focus:outline-none"
    >
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!w-3 !h-3 !bg-zinc-900 !border-2 !border-zinc-500 hover:!border-orange-400 transition-colors"
        title="Tether target input"
      />

      {block.kind === 'text' && (
        <TextBlock
          block={block as Block<TextBlockData>}
          group={group}
          isSelected={Boolean(selected)}
          isConnectingSource={isConnectingSource}
          isValidTarget={isValidTarget}
          isInvalidTarget={isInvalidTarget}
          onStartTether={handleStartTether}
          onCompleteTether={handleCompleteTether}
        />
      )}

      {block.kind === 'upload' && (
        <UploadBlock
          block={block as Block<UploadBlockData>}
          group={group}
          isSelected={Boolean(selected)}
          isConnectingSource={isConnectingSource}
          isValidTarget={isValidTarget}
          isInvalidTarget={isInvalidTarget}
          onStartTether={handleStartTether}
          onCompleteTether={handleCompleteTether}
        />
      )}

      {block.kind === 'file' && (
        <FileBlock
          block={block as Block<FileBlockData>}
          group={group}
          isSelected={Boolean(selected)}
          isConnectingSource={isConnectingSource}
          isValidTarget={isValidTarget}
          isInvalidTarget={isInvalidTarget}
          onStartTether={handleStartTether}
          onCompleteTether={handleCompleteTether}
        />
      )}

      {block.kind === 'code' && (
        <CodeBlock
          block={block as Block<CodeBlockData>}
          group={group}
          isSelected={Boolean(selected)}
          isConnectingSource={isConnectingSource}
          isValidTarget={isValidTarget}
          isInvalidTarget={isInvalidTarget}
          onStartTether={handleStartTether}
          onCompleteTether={handleCompleteTether}
        />
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!w-3 !h-3 !bg-zinc-900 !border-2 !border-zinc-500 hover:!border-orange-400 transition-colors"
        title="Tether source output"
      />
    </div>
  );
});
