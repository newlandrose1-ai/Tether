'use client';

import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useWorkspaceStore } from '../store/workspaceStore';
import { BlockNode } from './BlockNode';
import { TetherEdge } from './TetherEdge';
import { FolderNode } from './FolderNode';
import type { UploadBlockData, FileBlockData, Block } from '../types/model';
import { getMimeType, isTextFile } from '../lib/zip';
import {
  Plus,
  X,
  FileUp,
  FileText,
  Code2,
  FileArchive,
  UploadCloud,
  LayoutGrid,
  ChevronsUpDown,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Maximize,
} from 'lucide-react';

const nodeTypes: NodeTypes = {
  blockNode: BlockNode,
  folderNode: FolderNode,
};

const edgeTypes: EdgeTypes = {
  tetherEdge: TetherEdge,
};

export function BlockCanvas() {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeGroupId = useWorkspaceStore((s) => s.activeGroupId);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const tethers = useWorkspaceStore((s) => s.tethers);
  const groups = useWorkspaceStore((s) => s.groups);
  const selectedBlockId = useWorkspaceStore((s) => s.selectedBlockId);
  const connectingSourceBlockId = useWorkspaceStore((s) => s.connectingSourceBlockId);
  const searchQuery = useWorkspaceStore((s) => s.searchQuery);
  const focusViewportRequest = useWorkspaceStore((s) => s.focusViewportRequest);

  const collapsedCanvasFolders = useWorkspaceStore((s) => s.collapsedCanvasFolders);
  const toggleCanvasFolder = useWorkspaceStore((s) => s.toggleCanvasFolder);
  const selectBlock = useWorkspaceStore((s) => s.selectBlock);
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const batchUpdateBlocks = useWorkspaceStore((s) => s.batchUpdateBlocks);
  const updateBlockData = useWorkspaceStore((s) => s.updateBlockData);
  const createBlock = useWorkspaceStore((s) => s.createBlock);
  const createTether = useWorkspaceStore((s) => s.createTether);
  const setConnectingSourceBlockId = useWorkspaceStore((s) => s.setConnectingSourceBlockId);
  const requestFocusViewport = useWorkspaceStore((s) => s.requestFocusViewport);

  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const directFileInputRef = useRef<HTMLInputElement>(null);
  const [isCanvasDraggingOver, setIsCanvasDraggingOver] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dockRef.current && !dockRef.current.contains(e.target as globalThis.Node)) {
        setIsAddMenuOpen(false);
        setIsLayoutMenuOpen(false);
      }
    };
    if (isAddMenuOpen || isLayoutMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isAddMenuOpen, isLayoutMenuOpen]);

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const folderDragStartPos = useRef<Record<string, { x: number; y: number }>>({});

  const canvasCollapsedFolders = useMemo(
    () => new Set(collapsedCanvasFolders),
    [collapsedCanvasFolders]
  );

  const handleToggleProjectFolder = useCallback(
    (folderPath: string) => {
      toggleCanvasFolder(folderPath);
    },
    [toggleCanvasFolder]
  );

  // Filter blocks for active project and active group
  const groupBlocks = useMemo(() => {
    if (!activeProjectId || !activeGroupId) return [];
    return blocks.filter((b) => {
      if (b.projectId !== activeProjectId || b.groupId !== activeGroupId) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const titleMatch = b.title.toLowerCase().includes(q);
      const contentMatch =
        b.kind === 'text' &&
        typeof (b.data as { content?: string })?.content === 'string' &&
        (b.data as { content: string }).content.toLowerCase().includes(q);
      return titleMatch || contentMatch;
    });
  }, [blocks, activeProjectId, activeGroupId, searchQuery]);

  // Map of upload blocks in this group
  const uploadBlocks = useMemo(() => {
    return groupBlocks.filter((b) => b.kind === 'upload');
  }, [groupBlocks]);

  const anyCollapsed = useMemo(() => {
    return groupBlocks.some((b) => b.collapsed);
  }, [groupBlocks]);

  const handleToggleExpandAllBlocks = useCallback(async () => {
    const targetState = !anyCollapsed;
    const updates = groupBlocks
      .filter((b) => b.collapsed !== targetState)
      .map((b) => ({ id: b.id, patch: { collapsed: targetState } }));
    if (updates.length > 0) {
      await batchUpdateBlocks(updates);
    }
  }, [anyCollapsed, groupBlocks, batchUpdateBlocks]);

  const handleAutoOrganize = useCallback(async () => {
    if (groupBlocks.length === 0) return;

    // Group blocks by folder path (or root)
    const folderGroups: Record<string, Block[]> = { root: [] };

    groupBlocks.forEach((b) => {
      const rawPath = (b.sourcePath || (b.data as { path?: string })?.path || b.title).replace(/^\/+/, '');
      const parts = rawPath.split('/');
      if (parts.length > 1) {
        const folder = parts.slice(0, -1).join('/');
        if (!folderGroups[folder]) folderGroups[folder] = [];
        folderGroups[folder].push(b);
      } else {
        folderGroups.root.push(b);
      }
    });

    let currentX = 60;
    const startY = 80;
    const columnWidth = 360;
    const updates: Array<{ id: string; patch: { x: number; y: number } }> = [];

    for (const [folderName, files] of Object.entries(folderGroups)) {
      if (files.length === 0) continue;
      let currentY = startY;

      if (folderName !== 'root') {
        currentY += 60;
      }

      for (const file of files) {
        const isCollapsed = Boolean(file.collapsed);
        const cardHeight = isCollapsed ? 52 : (file.height || 260);

        updates.push({
          id: file.id,
          patch: { x: currentX, y: currentY },
        });

        currentY += cardHeight + 24;
      }

      currentX += columnWidth + 40;
    }

    if (updates.length > 0) {
      await batchUpdateBlocks(updates);
    }
  }, [groupBlocks, batchUpdateBlocks]);

  // Smoothly pan React Flow viewport to requested block
  useEffect(() => {
    if (!focusViewportRequest) return;
    const target = blocks.find((b) => b.id === focusViewportRequest.blockId);
    const inst = rfInstanceRef.current;
    if (target && inst) {
      const centerX = target.x + (target.width ?? 340) / 2;
      const centerY = target.y + (target.collapsed ? 30 : 120);
      inst.setCenter(centerX, centerY, {
        zoom: Math.max(inst.getZoom(), 0.85),
        duration: 280,
      });
    }
    requestFocusViewport(null);
  }, [focusViewportRequest, blocks, requestFocusViewport]);

  // Precompute child->upload mapping for O(1) lookup
  const uploadParentByChildId = useMemo(() => {
    const map = new Map<string, Block>();
    for (const u of uploadBlocks) {
      const ids = (u.data as UploadBlockData)?.extractedBlockIds ?? [];
      for (const id of ids) {
        map.set(id, u);
      }
    }
    return map;
  }, [uploadBlocks]);

  // Helper: check if a file block is visible given parent upload collapse & folder collapse states
  const isBlockVisible = useCallback(
    (b: Block): boolean => {
      const parentUpload = uploadParentByChildId.get(b.id);
      if (parentUpload) {
        const uploadData = parentUpload.data as UploadBlockData;
        if (uploadData?.structureCollapsed) return false;

        const fileData = b.data as FileBlockData;
        const parentFolderPath = fileData?.parentFolderPath;
        if (!parentFolderPath) return true;

        const expandedFolders = new Set(uploadData?.expandedFolderPaths ?? []);
        const segments = parentFolderPath.split('/');
        let currentPath = '';

        for (const seg of segments) {
          currentPath = currentPath ? `${currentPath}/${seg}` : seg;
          if (!expandedFolders.has(currentPath)) {
            return false;
          }
        }
        return true;
      }

      const rawPath = (b.sourcePath || (b.data as { path?: string })?.path || b.title).replace(/^\/+/, '');
      const parts = rawPath.split('/');
      if (parts.length > 1) {
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
          if (canvasCollapsedFolders.has(currentPath)) {
            return false;
          }
        }
      }

      return true;
    },
    [uploadParentByChildId, canvasCollapsedFolders]
  );

  // Filter tethers for active project and active group
  const groupTethers = useMemo(() => {
    if (!activeProjectId || !activeGroupId) return [];
    return tethers.filter(
      (t) => t.projectId === activeProjectId && t.groupId === activeGroupId
    );
  }, [tethers, activeProjectId, activeGroupId]);

  const connectingSourceBlock = useMemo(
    () => (connectingSourceBlockId ? blocks.find((b) => b.id === connectingSourceBlockId) : undefined),
    [blocks, connectingSourceBlockId]
  );

  const connectedToSourceIds = useMemo(() => {
    if (!connectingSourceBlockId) return new Set<string>();
    const set = new Set<string>();
    for (const t of groupTethers) {
      if (t.sourceBlockId === connectingSourceBlockId) set.add(t.targetBlockId);
      if (t.targetBlockId === connectingSourceBlockId) set.add(t.sourceBlockId);
    }
    return set;
  }, [groupTethers, connectingSourceBlockId]);

  // Build visible React Flow nodes (blocks + transient folder nodes)
  const nodes: Node[] = useMemo(() => {
    const visibleBlocks = groupBlocks.filter(isBlockVisible);

    const blockNodes: Node[] = visibleBlocks.map((b) => {
      const isConnectingSource = connectingSourceBlockId === b.id;
      const isConnectingMode = Boolean(connectingSourceBlockId);
      const isAlreadyTethered = connectedToSourceIds.has(b.id);
      const isSameScope =
        connectingSourceBlock &&
        connectingSourceBlock.projectId === b.projectId &&
        connectingSourceBlock.groupId === b.groupId;
      const isValidTarget = Boolean(
        isConnectingMode && !isConnectingSource && isSameScope && !isAlreadyTethered
      );
      const isInvalidTarget = Boolean(isConnectingMode && !isConnectingSource && !isValidTarget);

      return {
        id: b.id,
        type: 'blockNode',
        position: { x: b.x, y: b.y },
        data: {
          block: b,
          group: activeGroup,
          isConnectingSource,
          isValidTarget,
          isInvalidTarget,
        },
        selected: b.id === selectedBlockId,
      };
    });

    const folderNodes: Node[] = [];

    // Create folder grouping nodes for each upload block
    for (const uploadBlock of uploadBlocks) {
      const uploadData = uploadBlock.data as UploadBlockData;
      if (uploadData?.structureCollapsed) continue;

      const childFiles = groupBlocks.filter(
        (b) =>
          b.kind !== 'upload' &&
          uploadData?.extractedBlockIds?.includes(b.id)
      );

      const uniqueFolders = Array.from(
        new Set(
          childFiles
            .map((f) => (f.data as FileBlockData)?.parentFolderPath)
            .filter((p): p is string => Boolean(p))
        )
      );

      const expandedSet = new Set(uploadData?.expandedFolderPaths ?? []);

      for (const fp of uniqueFolders) {
        const segments = fp.split('/');
        let ancestorCollapsed = false;
        let runningPath = '';

        for (let i = 0; i < segments.length - 1; i++) {
          runningPath = runningPath ? `${runningPath}/${segments[i]}` : segments[i];
          if (!expandedSet.has(runningPath)) {
            ancestorCollapsed = true;
            break;
          }
        }

        if (ancestorCollapsed) continue;

        const filesInThisFolder = childFiles.filter(
          (f) => (f.data as FileBlockData)?.parentFolderPath === fp
        );

        if (filesInThisFolder.length === 0) continue;

        const isExpanded = expandedSet.has(fp);
        const minX = Math.min(...filesInThisFolder.map((f) => f.x));
        const minY = Math.min(...filesInThisFolder.map((f) => f.y));

        folderNodes.push({
          id: `folder-${uploadBlock.id}-${fp}`,
          type: 'folderNode',
          position: { x: minX, y: minY - 46 },
          data: {
            folderPath: fp,
            isExpanded,
            fileCount: filesInThisFolder.length,
            uploadBlockId: uploadBlock.id,
          },
        });
      }
    }

    // Create folder grouping nodes for non-upload project files
    const nonUploadFiles = groupBlocks.filter((b) => !uploadParentByChildId.has(b.id));

    const projectFolders = new Map<string, Block[]>();
    for (const b of nonUploadFiles) {
      const rawPath = (b.sourcePath || (b.data as { path?: string })?.path || b.title).replace(/^\/+/, '');
      const parts = rawPath.split('/');
      if (parts.length > 1) {
        const folder = parts.slice(0, -1).join('/');
        if (!projectFolders.has(folder)) projectFolders.set(folder, []);
        projectFolders.get(folder)!.push(b);
      }
    }

    for (const [folderPath, folderFiles] of projectFolders.entries()) {
      const segments = folderPath.split('/');
      let ancestorCollapsed = false;
      let running = '';
      for (let i = 0; i < segments.length - 1; i++) {
        running = running ? `${running}/${segments[i]}` : segments[i];
        if (canvasCollapsedFolders.has(running)) {
          ancestorCollapsed = true;
          break;
        }
      }
      if (ancestorCollapsed) continue;

      const isExpanded = !canvasCollapsedFolders.has(folderPath);
      const minX = Math.min(...folderFiles.map((f) => f.x));
      const minY = Math.min(...folderFiles.map((f) => f.y));

      folderNodes.push({
        id: `folder-project-${folderPath}`,
        type: 'folderNode',
        position: { x: minX, y: minY - 46 },
        data: {
          folderPath,
          isExpanded,
          fileCount: folderFiles.length,
          onToggleFolder: handleToggleProjectFolder,
        },
      });
    }

    return [...folderNodes, ...blockNodes];
  }, [
    groupBlocks,
    isBlockVisible,
    selectedBlockId,
    activeGroup,
    connectingSourceBlockId,
    connectingSourceBlock,
    connectedToSourceIds,
    uploadBlocks,
    uploadParentByChildId,
    canvasCollapsedFolders,
    handleToggleProjectFolder,
  ]);

  // Set of visible node IDs to ensure collapsed tethers are visually hidden but preserved in store
  const visibleNodeIds = useMemo(() => {
    return new Set(nodes.map((n) => n.id));
  }, [nodes]);

  // Build React Flow edges (rendering only those connecting currently visible nodes)
  const edges: Edge[] = useMemo(() => {
    const visibleEdges = groupTethers.filter(
      (t) => visibleNodeIds.has(t.sourceBlockId) && visibleNodeIds.has(t.targetBlockId)
    );
    const hasSelection = Boolean(selectedBlockId);

    return visibleEdges.map((t) => {
      const normalized = (t.label || 'dependency').toLowerCase();
      const isReference =
        normalized === 'reference' ||
        normalized === 'references' ||
        normalized.includes('ref');
      const isCopiedFrom = normalized === 'copied from';
      const isExtractedFrom = normalized === 'extracted from';
      const isHighlighted = Boolean(
        selectedBlockId &&
          (t.sourceBlockId === selectedBlockId || t.targetBlockId === selectedBlockId)
      );

      return {
        id: t.id,
        source: t.sourceBlockId,
        target: t.targetBlockId,
        type: 'tetherEdge',
        data: {
          label: t.label || 'dependency',
          isHighlighted,
          hasSelection,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: isHighlighted
            ? '#f97316'
            : isCopiedFrom
            ? '#f59e0b'
            : isExtractedFrom
            ? '#52525b'
            : isReference
            ? '#71717a'
            : '#a1a1aa',
        },
      };
    });
  }, [groupTethers, visibleNodeIds, selectedBlockId]);

  // Record drag start for folder nodes so we can move visible child blocks relatively
  const onNodeDragStart = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'folderNode') {
      folderDragStartPos.current[node.id] = {
        x: node.position.x,
        y: node.position.y,
      };
    }
  }, []);

  // Handle Drag Stop -> Persist Coordinates & Move folder children if folder dragged
  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'folderNode') {
        const start = folderDragStartPos.current[node.id];
        if (start) {
          const dx = Math.round(node.position.x - start.x);
          const dy = Math.round(node.position.y - start.y);

          if (dx !== 0 || dy !== 0) {
            const data = node.data as { folderPath: string; uploadBlockId?: string };
            let filesToMove: Block[] = [];
            if (data.uploadBlockId) {
              const uploadBlock = blocks.find((b) => b.id === data.uploadBlockId);
              const childIds = (uploadBlock?.data as UploadBlockData)?.extractedBlockIds ?? [];

              filesToMove = blocks.filter(
                (b) =>
                  b.kind !== 'upload' &&
                  childIds.includes(b.id) &&
                  (b.data as FileBlockData)?.parentFolderPath === data.folderPath
              );
            } else {
              filesToMove = blocks.filter((b) => {
                const rawPath = (b.sourcePath || (b.data as { path?: string })?.path || b.title).replace(/^\/+/, '');
                return rawPath.startsWith(`${data.folderPath}/`);
              });
            }

            if (filesToMove.length > 0) {
              batchUpdateBlocks(
                filesToMove.map((f) => ({
                  id: f.id,
                  patch: {
                    x: Math.round(f.x + dx),
                    y: Math.round(f.y + dy),
                  },
                }))
              );
            }
          }
        }
      } else {
        updateBlock(node.id, {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        });
      }
    },
    [updateBlock, batchUpdateBlocks, blocks]
  );

  // Connection validation
  const isValidConnection = useCallback(
    (connection: Connection): boolean => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;

      const sourceBlock = blocks.find((b) => b.id === connection.source);
      const targetBlock = blocks.find((b) => b.id === connection.target);
      if (!sourceBlock || !targetBlock) return false;

      if (
        sourceBlock.projectId !== targetBlock.projectId ||
        sourceBlock.groupId !== targetBlock.groupId
      ) {
        return false;
      }

      // Check duplicate bidirectional tether
      const duplicateExists = tethers.some(
        (t) =>
          t.projectId === sourceBlock.projectId &&
          t.groupId === sourceBlock.groupId &&
          ((t.sourceBlockId === connection.source && t.targetBlockId === connection.target) ||
            (t.sourceBlockId === connection.target && t.targetBlockId === connection.source))
      );

      return !duplicateExists;
    },
    [blocks, tethers]
  );

  // Handle Connect
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (!isValidConnection(connection)) return;
      await createTether(connection.source, connection.target, 'dependency');
    },
    [createTether, isValidConnection]
  );

  const handlePaneClick = useCallback(() => {
    selectBlock(null);
    if (connectingSourceBlockId) {
      setConnectingSourceBlockId(null);
    }
  }, [selectBlock, connectingSourceBlockId, setConnectingSourceBlockId]);

  const handleCreateTextBlock = async () => {
    if (!activeProjectId || !activeGroupId) return;

    const count = groupBlocks.length;
    const x = 120 + (count % 3) * 320;
    const y = 80 + Math.floor(count / 3) * 260;

    const block = await createBlock({
      projectId: activeProjectId,
      groupId: activeGroupId,
      kind: 'text',
      title: `Note ${count + 1}`,
      x,
      y,
      data: { content: '' },
    });

    selectBlock(block.id);
  };

  const handleCreateUploadBlock = async () => {
    if (!activeProjectId || !activeGroupId) return;

    const count = groupBlocks.length;
    const x = 120 + (count % 3) * 340;
    const y = 80 + Math.floor(count / 3) * 260;

    const block = await createBlock({
      projectId: activeProjectId,
      groupId: activeGroupId,
      kind: 'upload',
      title: 'Archive Upload',
      status: 'idle',
      x,
      y,
      data: { fileName: '', size: 0, extractedBlockIds: [] },
    });

    selectBlock(block.id);
  };

  const handleCreateCodeBlock = async () => {
    if (!activeProjectId || !activeGroupId) return;

    const count = groupBlocks.length;
    const x = 120 + (count % 3) * 340;
    const y = 80 + Math.floor(count / 3) * 260;

    const block = await createBlock({
      projectId: activeProjectId,
      groupId: activeGroupId,
      kind: 'code',
      title: `script-${count + 1}.js`,
      status: 'ready',
      x,
      y,
      data: {
        path: `script-${count + 1}.js`,
        language: 'javascript',
        currentContent: '// Tether Code Block\n// Local editing & revision playground\n\nfunction main() {\n  console.log("Tether local workspace");\n}\n',
        revisions: [],
      },
    });

    selectBlock(block.id);
  };

  // Direct file / document / PDF upload handler
  const handleDirectFilesUpload = async (fileList: FileList | File[]) => {
    if (!activeProjectId || !activeGroupId || fileList.length === 0) return;

    const count = groupBlocks.length;
    for (let idx = 0; idx < fileList.length; idx++) {
      const file = fileList[idx];
      const posX = 120 + ((count + idx) % 3) * 340;
      const posY = 80 + Math.floor((count + idx) / 3) * 260;

      // 1. If it's a ZIP archive
      if (file.name.toLowerCase().endsWith('.zip')) {
        const uploadBlock = await createBlock({
          projectId: activeProjectId,
          groupId: activeGroupId,
          kind: 'upload',
          title: file.name,
          status: 'extracting',
          x: posX,
          y: posY,
          data: { fileName: file.name, size: file.size, extractedBlockIds: [] },
        });
        selectBlock(uploadBlock.id);

        try {
          const { extractZipArchive } = await import('../lib/zip');
          const extractedEntries = await extractZipArchive(file);
          const newIds: string[] = [];

          for (let j = 0; j < extractedEntries.length; j++) {
            const entry = extractedEntries[j];
            const childBlock = await createBlock({
              projectId: activeProjectId,
              groupId: activeGroupId,
              kind: 'file',
              title: entry.name,
              x: posX + 360,
              y: posY + j * 200,
              status: 'ready',
              data: {
                path: entry.path,
                parentFolderPath: entry.parentFolderPath,
                mimeType: entry.mimeType,
                size: entry.size,
                binary: entry.binary,
                isPdf: entry.isPdf,
                dataUrl: entry.dataUrl,
                content: entry.content,
              },
            });
            newIds.push(childBlock.id);
            await createTether(uploadBlock.id, childBlock.id, 'extracted from');
          }

          await updateBlock(uploadBlock.id, { status: 'ready' });
          await updateBlockData(uploadBlock.id, {
            extractedBlockIds: newIds,
            structureCollapsed: false,
          });
        } catch {
          await updateBlock(uploadBlock.id, { status: 'error' });
        }
        continue;
      }

      // 2. If it's a PDF document
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const dataUrl = event.target?.result as string;
          const pdfBlock = await createBlock({
            projectId: activeProjectId,
            groupId: activeGroupId,
            kind: 'file',
            title: file.name,
            x: posX,
            y: posY,
            status: 'ready',
            data: {
              path: file.name,
              mimeType: 'application/pdf',
              size: file.size,
              binary: true,
              isPdf: true,
              dataUrl,
            },
          });
          selectBlock(pdfBlock.id);
        };
        reader.readAsDataURL(file);
        continue;
      }

      // 3. If it's a text/code/markdown/structured document
      const resolvedMime = file.type || getMimeType(file.name);
      const isLikelyText =
        resolvedMime.startsWith('text/') ||
        resolvedMime === 'application/json' ||
        resolvedMime === 'application/xml' ||
        resolvedMime === 'image/svg+xml' ||
        isTextFile(file.name);

      if (isLikelyText) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const textContent = event.target?.result as string;
          const textFileBlock = await createBlock({
            projectId: activeProjectId,
            groupId: activeGroupId,
            kind: 'file',
            title: file.name,
            x: posX,
            y: posY,
            status: 'ready',
            data: {
              path: file.name,
              mimeType: resolvedMime,
              size: file.size,
              binary: false,
              content: textContent,
            },
          });
          selectBlock(textFileBlock.id);
        };
        reader.readAsText(file);
        continue;
      }

      // 4. Any other binary, image, audio, video, or document file
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        const binBlock = await createBlock({
          projectId: activeProjectId,
          groupId: activeGroupId,
          kind: 'file',
          title: file.name,
          x: posX,
          y: posY,
          status: 'ready',
          data: {
            path: file.name,
            mimeType: resolvedMime,
            size: file.size,
            binary: true,
            dataUrl,
          },
        });
        selectBlock(binBlock.id);
      };
      reader.readAsDataURL(file);
    }
  };

  const onDirectFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleDirectFilesUpload(files);
    }
    if (directFileInputRef.current) {
      directFileInputRef.current.value = '';
    }
  };

  // Empty states
  if (!activeProjectId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#090B0E] text-zinc-400 select-none">
        <p className="text-sm font-mono text-zinc-400 mb-3">
          No project selected. Create or select a project in the sidebar.
        </p>
      </div>
    );
  }

  if (!activeGroupId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#090B0E] text-zinc-400 select-none">
        <p className="text-sm font-mono text-zinc-400 mb-3">
          No tether group selected. Select or create a tether group in the sidebar.
        </p>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsCanvasDraggingOver(true);
      }}
      onDragLeave={() => setIsCanvasDraggingOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsCanvasDraggingOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleDirectFilesUpload(e.dataTransfer.files);
        }
      }}
      className="flex-1 relative h-full w-full bg-[#090B0E] overflow-hidden"
    >
      {/* Hidden file input for direct file/PDF/document upload */}
      <input
        ref={directFileInputRef}
        type="file"
        accept="*/*"
        multiple
        onChange={onDirectFileInputChange}
        className="hidden"
      />

      {/* Canvas Drop Overlay */}
      {isCanvasDraggingOver && (
        <div className="absolute inset-0 z-50 bg-[#090B0E]/85 backdrop-blur-md border-2 border-dashed border-orange-500/80 flex flex-col items-center justify-center pointer-events-none">
          <UploadCloud className="w-12 h-12 text-orange-400 animate-bounce mb-3" />
          <p className="text-sm font-mono font-semibold text-zinc-100">Drop files anywhere to create blocks</p>
          <p className="text-xs font-mono text-zinc-400 mt-1">Accepts PDF documents, code, notes, and .ZIP archives</p>
        </div>
      )}

      {/* Active Connecting Banner */}
      {connectingSourceBlock && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 glass-menu border border-orange-500/80 rounded-md px-3.5 py-1.5 text-xs font-mono text-zinc-200 animate-panel-in">
          <div className="w-2 h-2 rounded-full bg-orange-400 animate-ping" />
          <span>
            Connecting tether from <strong className="text-orange-300">{connectingSourceBlock.title}</strong>. Click another block to complete.
          </span>
          <button
            type="button"
            onClick={() => setConnectingSourceBlockId(null)}
            className="text-zinc-400 hover:text-zinc-100 p-0.5 hover:bg-zinc-800/80 rounded transition cursor-pointer"
            title="Cancel tether"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Empty Group State */}
      {groupBlocks.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-8 pointer-events-none">
          <div className="pointer-events-auto max-w-md text-center space-y-4 glass-panel border border-zinc-700/80 p-6 rounded-xl animate-panel-in">
            <div
              className="w-3 h-3 rounded-full mx-auto ring-2 ring-orange-500/30"
              style={{ backgroundColor: activeGroup?.color || '#f97316' }}
            />
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 font-mono">Workspace Canvas Empty</h3>
              <p className="text-xs font-mono text-zinc-400 mt-1">
                Create a modular box or drop any file, PDF, or ZIP archive directly onto the canvas.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 font-mono">
              <button
                type="button"
                onClick={handleCreateCodeBlock}
                className="py-2 px-3 bg-zinc-900/80 hover:bg-orange-500/15 text-zinc-100 hover:text-orange-200 text-xs rounded-lg transition border border-zinc-700/70 hover:border-orange-500/60 flex items-center justify-center gap-1.5 cursor-pointer font-medium"
              >
                <Code2 className="w-3.5 h-3.5 text-orange-400" />
                <span>+ Code Block</span>
              </button>
              <button
                type="button"
                onClick={handleCreateTextBlock}
                className="py-2 px-3 bg-zinc-900/80 hover:bg-zinc-800/90 text-zinc-200 hover:text-white text-xs rounded-lg transition border border-zinc-700/70 hover:border-zinc-500 flex items-center justify-center gap-1.5 cursor-pointer font-medium"
              >
                <FileText className="w-3.5 h-3.5 text-zinc-300" />
                <span>+ Note</span>
              </button>
              <button
                type="button"
                onClick={() => directFileInputRef.current?.click()}
                className="py-2 px-3 bg-zinc-900/80 hover:bg-zinc-800/90 text-zinc-200 hover:text-white text-xs rounded-lg transition border border-zinc-700/70 hover:border-zinc-500 flex items-center justify-center gap-1.5 cursor-pointer font-medium"
              >
                <FileUp className="w-3.5 h-3.5 text-zinc-300" />
                <span>+ File / PDF</span>
              </button>
              <button
                type="button"
                onClick={handleCreateUploadBlock}
                className="py-2 px-3 bg-zinc-900/80 hover:bg-zinc-800/90 text-zinc-200 hover:text-white text-xs rounded-lg transition border border-zinc-700/70 hover:border-zinc-500 flex items-center justify-center gap-1.5 cursor-pointer font-medium"
              >
                <FileArchive className="w-3.5 h-3.5 text-orange-400" />
                <span>+ ZIP Archive</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Glass Action Dock (Collapsible) */}
      {groupBlocks.length > 0 && (
        <div
          ref={dockRef}
          className="absolute bottom-5 left-5 z-20 flex items-center gap-1.5 glass-menu border border-zinc-700/80 p-1 rounded-lg font-mono text-xs"
        >
          {isDockCollapsed ? (
            <button
              type="button"
              onClick={() => setIsDockCollapsed(false)}
              className="flex items-center gap-1.5 py-1.5 px-2.5 rounded-md bg-zinc-900/70 hover:bg-zinc-800/80 text-zinc-200 hover:text-white border border-zinc-700/75 hover:border-orange-500/60 transition cursor-pointer font-medium"
              title="Expand canvas actions"
              aria-label="Expand canvas actions"
            >
              <Plus className="w-3.5 h-3.5 text-orange-400" />
              <span>Dock</span>
              <ChevronsRight className="w-3.5 h-3.5 text-zinc-400" />
            </button>
          ) : (
            <>
              {/* Add Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddMenuOpen(!isAddMenuOpen);
                    setIsLayoutMenuOpen(false);
                  }}
                  className={`flex items-center gap-1.5 py-1.5 px-3 rounded-md border transition cursor-pointer font-medium ${
                    isAddMenuOpen
                      ? 'bg-orange-500/20 text-orange-200 border-orange-500/70'
                      : 'bg-zinc-900/70 hover:bg-zinc-800/80 text-zinc-100 border-zinc-700/75 hover:border-orange-500/50'
                  }`}
                  aria-expanded={isAddMenuOpen}
                >
                  <Plus className="w-3.5 h-3.5 text-orange-400" />
                  <span>Add</span>
                  <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${isAddMenuOpen ? 'rotate-180 text-orange-400' : ''}`} />
                </button>

                {isAddMenuOpen && (
                  <div className="absolute bottom-full mb-2 left-0 w-44 glass-menu border border-zinc-600/80 rounded-lg p-1 space-y-0.5 z-30 animate-panel-in">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddMenuOpen(false);
                        handleCreateCodeBlock();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-orange-500/15 rounded transition cursor-pointer"
                    >
                      <Code2 className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                      <span>Code Block</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsAddMenuOpen(false);
                        handleCreateTextBlock();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      <span>Note</span>
                    </button>

                    <div className="border-t border-zinc-700/70 my-1" />

                    <button
                      type="button"
                      onClick={() => {
                        setIsAddMenuOpen(false);
                        directFileInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                    >
                      <FileUp className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      <span>Upload File</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsAddMenuOpen(false);
                        handleCreateUploadBlock();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                    >
                      <FileArchive className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                      <span>Upload ZIP</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Layout Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsLayoutMenuOpen(!isLayoutMenuOpen);
                    setIsAddMenuOpen(false);
                  }}
                  className={`flex items-center gap-1.5 py-1.5 px-3 rounded-md border transition cursor-pointer font-medium ${
                    isLayoutMenuOpen
                      ? 'bg-orange-500/20 text-orange-200 border-orange-500/70'
                      : 'bg-zinc-900/70 hover:bg-zinc-800/80 text-zinc-300 hover:text-white border-zinc-700/75 hover:border-zinc-500'
                  }`}
                  aria-expanded={isLayoutMenuOpen}
                >
                  <LayoutGrid className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Layout</span>
                  <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${isLayoutMenuOpen ? 'rotate-180 text-orange-400' : ''}`} />
                </button>

                {isLayoutMenuOpen && (
                  <div className="absolute bottom-full mb-2 left-0 w-44 glass-menu border border-zinc-600/80 rounded-lg p-1 space-y-0.5 z-30 animate-panel-in">
                    <button
                      type="button"
                      onClick={() => {
                        setIsLayoutMenuOpen(false);
                        handleAutoOrganize();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-orange-500/15 rounded transition cursor-pointer"
                    >
                      <LayoutGrid className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                      <span>Auto-Organize</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsLayoutMenuOpen(false);
                        handleToggleExpandAllBlocks();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                    >
                      <ChevronsUpDown className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      <span>{anyCollapsed ? 'Expand All' : 'Collapse All'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsLayoutMenuOpen(false);
                        rfInstanceRef.current?.fitView({ padding: 0.18, duration: 280 });
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition cursor-pointer"
                    >
                      <Maximize className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      <span>Fit View</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsAddMenuOpen(false);
                  setIsLayoutMenuOpen(false);
                  setIsDockCollapsed(true);
                }}
                className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-orange-300 hover:bg-zinc-800/80 transition cursor-pointer"
                title="Collapse dock"
                aria-label="Collapse dock"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(inst) => {
          rfInstanceRef.current = inst;
        }}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onPaneClick={handlePaneClick}
        fitView={groupBlocks.length > 0}
        fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
        minZoom={0.05}
        maxZoom={3}
        translateExtent={[
          [-12000, -12000],
          [20000, 20000],
        ]}
        nodeExtent={[
          [-10000, -10000],
          [18000, 18000],
        ]}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#232832" gap={22} size={1} />
        <Controls
          showInteractive={false}
          className="!glass-menu !border !border-zinc-700/80 !rounded-lg !fill-zinc-300 [&>button]:!border-zinc-700/70 [&>button]:!bg-transparent hover:[&>button]:!bg-zinc-800/70 hover:[&>button]:!text-orange-400"
        />
      </ReactFlow>
    </div>
  );
}
