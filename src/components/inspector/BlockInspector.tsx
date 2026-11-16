'use client';

import React, { useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  X,
  Trash2,
  GitCommit,
  Clock,
  ArrowRight,
  ArrowLeft,
  Tag,
  Check,
  Download,
  Maximize2,
  Edit3,
  Copy,
  Eye,
  PanelRightClose,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  ImagePlus,
  FolderInput,
  Link2,
} from 'lucide-react';
import type { TextBlockData } from '../../types/model';
import { getFileTypeInfo, formatFileSize } from '../../lib/fileTypes';
import {
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_GROUP_LABELS,
  getProjectCategoryById,
  extractBlockTextContent,
  type ProjectCategoryGroup,
} from '../../lib/projectCategories';
import {
  MEDIA_FOLDER_PRESETS,
  getImageBlockPreviewSrc,
  isImageBlock,
  sanitizeFolderPath,
} from '../../lib/imageAssets';

export function BlockInspector() {
  const selectedBlockId = useWorkspaceStore((s) => s.selectedBlockId);
  const selectBlock = useWorkspaceStore((s) => s.selectBlock);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const tethers = useWorkspaceStore((s) => s.tethers);
  const deleteBlock = useWorkspaceStore((s) => s.deleteBlock);
  const deleteTether = useWorkspaceStore((s) => s.deleteTether);
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const openBlockInEditor = useWorkspaceStore((s) => s.openBlockInEditor);
  const copyBlockForEdit = useWorkspaceStore((s) => s.copyBlockForEdit);
  const toggleBlockInspector = useWorkspaceStore((s) => s.toggleBlockInspector);
  const applyBlockProjectCategory = useWorkspaceStore((s) => s.applyBlockProjectCategory);
  const openImageModal = useWorkspaceStore((s) => s.openImageModal);
  const moveOrRenameAssetBlock = useWorkspaceStore((s) => s.moveOrRenameAssetBlock);
  const setImageFeedback = useWorkspaceStore((s) => s.setImageFeedback);

  const [editingTitleBlockId, setEditingTitleBlockId] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editingPathBlockId, setEditingPathBlockId] = useState<string | null>(null);
  const [editedPath, setEditedPath] = useState('');
  const [confirmDeleteBlockId, setConfirmDeleteBlockId] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState({
    metadata: true,
    tethers: true,
    preview: true,
    revisions: true,
    export: true,
    danger: false,
  });

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!selectedBlockId) return null;

  const block = blocks.find((b) => b.id === selectedBlockId);
  if (!block) return null;

  const blockData = (block.data ?? {}) as {
    path?: string;
    size?: number;
    mimeType?: string;
    language?: string;
    binary?: boolean;
    isPdf?: boolean;
    dataUrl?: string;
  };
  const fileInfo = getFileTypeInfo({
    title: block.title,
    kind: block.kind,
    mimeType: blockData.mimeType,
    binary: blockData.binary,
    isPdf: blockData.isPdf,
    language: blockData.language,
  });
  const resolvedPath = block.sourcePath || blockData.path;

  // Connected tethers
  const incomingTethers = tethers.filter((t) => t.targetBlockId === block.id);
  const outgoingTethers = tethers.filter((t) => t.sourceBlockId === block.id);
  const totalTethersCount = incomingTethers.length + outgoingTethers.length;

  const activeCategory = getProjectCategoryById(block.projectCategory);
  const currentBlockText = extractBlockTextContent(block);
  const showResetTemplateButton = Boolean(
    activeCategory &&
      !blockData.binary &&
      currentBlockText.trim().length > 0 &&
      currentBlockText.trim() !== activeCategory.template.trim()
  );

  const isImageAsset = isImageBlock(block);
  const imagePreviewSrc = isImageAsset ? getImageBlockPreviewSrc(block) : undefined;
  const currentAssetPath = (resolvedPath || block.title).replace(/^\/+/, '');
  const currentAssetFolder = currentAssetPath.includes('/')
    ? currentAssetPath.split('/').slice(0, -1).join('/')
    : '';

  const isEditingTitle = editingTitleBlockId === block.id;
  const isEditingPath = editingPathBlockId === block.id;
  const confirmDeleteBlock = confirmDeleteBlockId === block.id;

  const handleSaveTitle = async () => {
    if (editedTitle.trim()) {
      await updateBlock(block.id, { title: editedTitle.trim() });
    }
    setEditingTitleBlockId(null);
  };

  const handleSaveAssetPath = async (nextFullPath: string) => {
    const moved = await moveOrRenameAssetBlock(block.id, nextFullPath);
    setEditingPathBlockId(null);
    if (moved) {
      setImageFeedback(`Moved ${moved.title} to ${moved.sourcePath || moved.title}`);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <aside className="w-full sm:w-80 flex-shrink-0 glass-panel border-l border-zinc-700/75 flex flex-col h-full select-none text-zinc-300">
      {/* Header */}
      <div className="h-12 px-3.5 border-b border-zinc-700/75 glass-header flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono tracking-wider text-zinc-300 uppercase font-semibold truncate flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          <span>Block Details</span>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => openBlockInEditor(block.id)}
            className="flex items-center gap-1 px-2.5 py-1 min-h-[32px] sm:min-h-0 text-xs font-mono font-medium text-orange-100 hover:text-white bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/70 rounded transition cursor-pointer"
            title={fileInfo.isTextEditable ? 'Open block in pop-up editor' : 'Open block in viewer'}
          >
            {fileInfo.isTextEditable ? (
              <Edit3 className="w-3 h-3 text-orange-400" />
            ) : (
              <Eye className="w-3 h-3 text-orange-400" />
            )}
            <span>{fileInfo.isTextEditable ? 'Edit' : 'View'}</span>
          </button>

          {fileInfo.isTextEditable && block.kind !== 'upload' && (
            <button
              type="button"
              onClick={() => copyBlockForEdit(block.id)}
              className="w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center text-zinc-300 hover:text-orange-300 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/80 hover:border-orange-500/50 rounded transition cursor-pointer"
              title="Copy & Audit"
              aria-label="Copy block for editing"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => useWorkspaceStore.getState().setFocusedBlockId(block.id)}
            className="w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center text-zinc-300 hover:text-zinc-100 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/80 rounded transition cursor-pointer"
            title="Focus view"
            aria-label="Focus view"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={toggleBlockInspector}
            className="hidden md:flex w-7 h-7 items-center justify-center text-zinc-400 hover:text-orange-300 hover:bg-zinc-800 rounded transition cursor-pointer"
            title="Collapse Block Details"
            aria-label="Collapse Block Details"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => selectBlock(null)}
            className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition cursor-pointer"
            title="Close Inspector"
            aria-label="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-28 md:pb-14 space-y-4">
        {/* Block Title */}
        <div>
          <span className="text-[10px] font-mono tracking-wider text-zinc-400 uppercase block mb-1">
            Title
          </span>
          {isEditingTitle ? (
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5">
              <input
                type="text"
                autoFocus
                aria-label="Block title"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') setEditingTitleBlockId(null);
                }}
                className="w-full bg-transparent text-base sm:text-xs text-zinc-100 outline-none font-mono py-0.5"
              />
              <button
                type="button"
                onClick={handleSaveTitle}
                className="w-8 h-8 flex items-center justify-center text-emerald-400 hover:text-emerald-300 rounded cursor-pointer"
                title="Save title"
                aria-label="Save title"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setEditingTitleBlockId(null)}
                className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-300 rounded cursor-pointer"
                title="Cancel"
                aria-label="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditedTitle(block.title);
                setEditingTitleBlockId(block.id);
              }}
              className="group/title w-full flex items-center justify-between gap-2 text-left text-xs text-zinc-100 bg-zinc-900/60 border border-zinc-800/80 hover:border-orange-500/50 rounded px-2.5 py-1.5 cursor-pointer transition"
              title="Rename block"
              aria-label={`Rename block ${block.title}`}
            >
              <span className="truncate">{block.title}</span>
              <Edit3 className="w-3 h-3 text-zinc-500 group-hover/title:text-orange-400 group-focus-visible/title:text-orange-400 shrink-0 transition-colors" />
            </button>
          )}
        </div>

        {/* Image Asset Preview & Quick Attach Controls */}
        {isImageAsset ? (
          <div className="p-2.5 rounded-lg bg-zinc-900/70 border border-zinc-700/75 space-y-2">
            {imagePreviewSrc && (
              <button
                type="button"
                onClick={() => openBlockInEditor(block.id)}
                className="h-28 w-full rounded bg-zinc-950 border border-zinc-800 flex items-center justify-center overflow-hidden cursor-pointer hover:border-orange-500/60 transition"
                title="Open full image viewer"
                aria-label={`Open full image viewer for ${block.title}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreviewSrc}
                  alt={block.title}
                  className="max-h-full max-w-full object-contain"
                />
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                openImageModal({
                  initialTab: 'existing',
                  preselectedImageIds: [block.id],
                })
              }
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/50 text-orange-100 text-xs font-mono transition cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5 text-orange-400" />
              <span>Insert / Attach to Code Block...</span>
            </button>
          </div>
        ) : (
          fileInfo.isTextEditable &&
          block.kind !== 'upload' && (
            <button
              type="button"
              onClick={() => openImageModal({ targetCodeBlockId: block.id })}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded bg-zinc-900/80 hover:bg-orange-500/15 border border-zinc-700/80 hover:border-orange-500/50 text-zinc-200 hover:text-orange-100 text-xs font-mono transition cursor-pointer"
            >
              <ImagePlus className="w-3.5 h-3.5 text-orange-400" />
              <span>+ Attach Image / Favicon / Gallery</span>
            </button>
          )
        )}

        {/* Metadata Section (Collapsible) */}
        <div className="border-y border-zinc-700/65 py-2.5">
          <button
            type="button"
            onClick={() => toggleSection('metadata')}
            className="w-full flex items-center justify-between text-[10px] font-mono tracking-wider text-zinc-400 hover:text-zinc-200 uppercase cursor-pointer"
            aria-expanded={openSections.metadata}
          >
            <span>File &amp; Metadata</span>
            {openSections.metadata ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
            )}
          </button>

          {openSections.metadata && (
            <div className="space-y-2.5 pt-2.5 text-xs font-mono">
              {block.kind !== 'upload' && (
                <div className="space-y-1.5 pb-2 border-b border-zinc-800/80">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="block-project-category-select"
                      className="text-[10px] uppercase tracking-wider text-zinc-400"
                    >
                      Project Category
                    </label>
                    {showResetTemplateButton && activeCategory && (
                      <button
                        type="button"
                        onClick={() => {
                          void applyBlockProjectCategory(block.id, activeCategory.id, {
                            applyTemplateIfNonEmpty: true,
                          });
                        }}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-orange-300 hover:text-orange-100 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/40 rounded transition cursor-pointer"
                        title="Replace current content with starter template"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>Reset Template</span>
                      </button>
                    )}
                  </div>
                  <select
                    id="block-project-category-select"
                    value={block.projectCategory || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        void updateBlock(block.id, { projectCategory: undefined });
                      } else {
                        void applyBlockProjectCategory(block.id, val);
                      }
                    }}
                    className="w-full bg-zinc-900/90 border border-zinc-700/80 hover:border-orange-500/60 focus:border-orange-500 rounded px-2 py-1.5 text-[11px] text-zinc-100 outline-none cursor-pointer"
                  >
                    <option value="">Custom / Unassigned</option>
                    {(['docs', 'deps', 'entry', 'folders', 'media'] as ProjectCategoryGroup[]).map((grp) => (
                      <optgroup key={grp} label={PROJECT_CATEGORY_GROUP_LABELS[grp]}>
                        {PROJECT_CATEGORIES.filter((c) => c.group === grp).map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {activeCategory && (
                    <p className="text-[10px] text-zinc-400 leading-snug">
                      {activeCategory.description}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-between items-center text-zinc-400 gap-2">
                <span>Format</span>
                <span className="flex items-center gap-1.5 text-zinc-200">
                  <span
                    className={`px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase rounded border ${fileInfo.badgeClass}`}
                  >
                    {fileInfo.badge}
                  </span>
                  <span className="text-[11px]">{fileInfo.label}</span>
                </span>
              </div>

              <div className="flex justify-between items-center text-zinc-400 gap-2">
                <span className="shrink-0">Tree Sync</span>
                {block.isInFolderStructure ? (
                  <span className="text-orange-300 truncate text-[11px]">
                    {block.tetherParentId
                      ? `Synced under ${
                          blocks.find((b) => b.id === block.tetherParentId)?.title || 'parent'
                        }`
                      : 'Synced root in Folder Tree'}
                  </span>
                ) : (
                  <span className="text-zinc-400 text-[11px]">Untethered (canvas only)</span>
                )}
              </div>

              {block.kind !== 'upload' && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between items-center text-zinc-400 gap-2">
                    <span className="flex items-center gap-1 shrink-0">
                      <FolderInput className="w-3 h-3 text-orange-400" />
                      <span>Path</span>
                    </span>
                    {!isEditingPath ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditedPath(currentAssetPath);
                          setEditingPathBlockId(block.id);
                        }}
                        className="text-zinc-200 hover:text-orange-300 truncate text-[11px] underline decoration-dotted underline-offset-2 cursor-pointer"
                        title="Click to move folder or rename path"
                      >
                        {currentAssetPath}
                      </button>
                    ) : null}
                  </div>

                  {isEditingPath && (
                    <div className="space-y-1.5 p-2 rounded bg-zinc-950/80 border border-zinc-700/80">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          autoFocus
                          aria-label="Block file path"
                          value={editedPath}
                          onChange={(e) => setEditedPath(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleSaveAssetPath(editedPath);
                            if (e.key === 'Escape') setEditingPathBlockId(null);
                          }}
                          className="w-full bg-zinc-900 border border-zinc-700 focus:border-orange-500 rounded px-2 py-1 text-[11px] text-zinc-100 outline-none"
                          placeholder="e.g. assets/images/hero.png"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveAssetPath(editedPath)}
                          className="p-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                          title="Move / Save path"
                          aria-label="Save path"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingPathBlockId(null)}
                          className="p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                          title="Cancel"
                          aria-label="Cancel path edit"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {isImageAsset && (
                        <div className="flex flex-wrap gap-1">
                          {MEDIA_FOLDER_PRESETS.slice(0, 6).map((preset) => {
                            const leaf = block.title;
                            const target = preset.value ? `${preset.value}/${leaf}` : leaf;
                            return (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => setEditedPath(target)}
                                className={`px-1.5 py-0.5 rounded text-[9px] border cursor-pointer ${
                                  sanitizeFolderPath(currentAssetFolder) === preset.value
                                    ? 'bg-orange-500/20 border-orange-500/50 text-orange-200'
                                    : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {block.originalSourcePath && block.originalSourcePath !== resolvedPath && (
                <div className="flex justify-between items-center text-zinc-400 gap-2">
                  <span className="shrink-0">Origin</span>
                  <span
                    className="text-zinc-400 truncate text-[11px]"
                    title={block.originalSourcePath}
                  >
                    {block.originalSourcePath}
                  </span>
                </div>
              )}

              {typeof blockData.size === 'number' && blockData.size > 0 && (
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Size</span>
                  <span className="text-zinc-200 tabular-nums">{formatFileSize(blockData.size)}</span>
                </div>
              )}

              <div className="flex justify-between items-center text-zinc-400">
                <span>Updated</span>
                <span className="text-zinc-200 flex items-center gap-1 tabular-nums">
                  <Clock className="w-3 h-3 text-orange-400" />
                  {formatDate(block.updatedAt)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Connected Tethers Section (Collapsible) */}
        <div className="pb-2 border-b border-zinc-700/65">
          <button
            type="button"
            onClick={() => toggleSection('tethers')}
            className="w-full flex items-center justify-between text-[10px] font-mono tracking-wider text-zinc-400 hover:text-zinc-200 uppercase cursor-pointer mb-2"
            aria-expanded={openSections.tethers}
          >
            <span className="flex items-center gap-1.5">
              <GitCommit className="w-3 h-3 text-orange-400" />
              <span>Connected Tethers ({totalTethersCount})</span>
            </span>
            {openSections.tethers ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
            )}
          </button>

          {openSections.tethers && (
            totalTethersCount === 0 ? (
              <div className="text-xs text-zinc-400 p-3 border border-dashed border-zinc-700/80 rounded text-center">
                No tethers connected to this block. Use the Tether action on any block to connect.
              </div>
            ) : (
              <div className="space-y-1.5">
                {outgoingTethers.map((tether) => {
                  const target = blocks.find((b) => b.id === tether.targetBlockId);
                  const isRef = tether.label?.toLowerCase() === 'reference';
                  return (
                    <div
                      key={tether.id}
                      className="flex items-center justify-between p-2 glass-card border border-zinc-700/75 rounded text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ArrowRight className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-200">
                            {target ? target.title : 'Unknown'}
                          </div>
                          <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-1">
                            <Tag className="w-2.5 h-2.5 text-zinc-400" />
                            <span>{tether.label || 'dependency'}</span>
                            <span className="text-zinc-400">•</span>
                            <span>{isRef ? 'dashed' : 'solid'}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteTether(tether.id)}
                        className="text-zinc-400 hover:text-red-400 p-1 hover:bg-zinc-800 rounded transition cursor-pointer"
                        title="Delete tether"
                        aria-label="Delete tether"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}

                {incomingTethers.map((tether) => {
                  const source = blocks.find((b) => b.id === tether.sourceBlockId);
                  const isRef = tether.label?.toLowerCase() === 'reference';
                  return (
                    <div
                      key={tether.id}
                      className="flex items-center justify-between p-2 bg-zinc-900/60 border border-zinc-800/80 rounded text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ArrowLeft className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-200">
                            {source ? source.title : 'Unknown'}
                          </div>
                          <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-1">
                            <Tag className="w-2.5 h-2.5 text-zinc-400" />
                            <span>{tether.label || 'dependency'}</span>
                            <span className="text-zinc-400">•</span>
                            <span>{isRef ? 'dashed' : 'solid'}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteTether(tether.id)}
                        className="text-zinc-400 hover:text-red-400 p-1 hover:bg-zinc-800 rounded transition cursor-pointer"
                        title="Delete tether"
                        aria-label="Delete tether"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Text Content Preview (if text block) */}
        {block.kind === 'text' && (
          <div className="pb-2 border-b border-zinc-700/65">
            <button
              type="button"
              onClick={() => toggleSection('preview')}
              className="w-full flex items-center justify-between text-[10px] font-mono tracking-wider text-zinc-400 hover:text-zinc-200 uppercase cursor-pointer mb-1.5"
              aria-expanded={openSections.preview}
            >
              <span>Text Preview</span>
              {openSections.preview ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              )}
            </button>
            {openSections.preview && (
              <div className="p-2.5 bg-zinc-900/50 border border-zinc-800/80 rounded text-xs text-zinc-300 font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
                {(block.data as TextBlockData)?.content || (
                  <span className="text-zinc-400 italic">Empty text block</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Code Revisions Section (if code block) */}
        {block.kind === 'code' && (
          <div className="pb-2 border-b border-zinc-700/65">
            <button
              type="button"
              onClick={() => toggleSection('revisions')}
              className="w-full flex items-center justify-between text-[10px] font-mono tracking-wider text-zinc-400 hover:text-zinc-200 uppercase cursor-pointer mb-1.5"
              aria-expanded={openSections.revisions}
            >
              <span>
                Code Revisions ({((block.data as { revisions?: unknown[] })?.revisions ?? []).length})
              </span>
              {openSections.revisions ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              )}
            </button>
            {openSections.revisions && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {((block.data as { revisions?: { id: string; createdAt: number; content: string; label?: string }[] })?.revisions ?? []).length === 0 ? (
                  <div className="text-xs text-zinc-400 p-2.5 border border-dashed border-zinc-800/80 rounded text-center">
                    No revisions saved yet. Save draft or take a snapshot to create one.
                  </div>
                ) : (
                  ((block.data as { revisions?: { id: string; createdAt: number; content: string; label?: string }[] })?.revisions ?? [])
                    .slice()
                    .reverse()
                    .map((rev) => (
                      <div
                        key={rev.id}
                        className="p-2 bg-zinc-900/60 border border-zinc-800/80 rounded text-xs font-mono flex items-center justify-between"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="text-zinc-200 font-medium truncate">{rev.label || 'revision'}</div>
                          <div className="text-[10px] text-zinc-400">
                            {formatDate(rev.createdAt)} • {rev.content.length} chars
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await useWorkspaceStore.getState().rollbackCodeRevision(block.id, rev.id);
                          }}
                          className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] border border-zinc-700 cursor-pointer flex-shrink-0"
                        >
                          Rollback
                        </button>
                      </div>
                    ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Single Block Export */}
        <div className="pb-2 border-b border-zinc-700/65">
          <button
            type="button"
            onClick={() => toggleSection('export')}
            className="w-full flex items-center justify-between text-[10px] font-mono tracking-wider text-zinc-400 hover:text-zinc-200 uppercase cursor-pointer mb-2"
            aria-expanded={openSections.export}
          >
            <span>Block Export</span>
            {openSections.export ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
            )}
          </button>

          {openSections.export && (
            blockData.dataUrl ? (
              <a
                href={blockData.dataUrl}
                download={block.title}
                className="w-full flex items-center justify-center gap-2 py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 hover:border-orange-500/50 text-zinc-200 hover:text-white rounded text-xs font-mono transition"
              >
                <Download className="w-3.5 h-3.5 text-orange-400" />
                <span>Download {fileInfo.badge} File</span>
              </a>
            ) : block.kind === 'upload' ? (
              <div className="text-[11px] font-mono text-zinc-400 italic">
                Open Viewer to browse or inspect individual extracted files.
              </div>
            ) : block.kind === 'file' && blockData.binary ? (
              <div className="text-[11px] font-mono text-zinc-400 italic">
                Binary payload unavailable for text export.
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const { exportSingleBlock } = await import('../../lib/exportImport');
                  exportSingleBlock(block);
                }}
                className="w-full flex items-center justify-center gap-2 py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-300 hover:text-zinc-100 rounded text-xs font-mono transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-zinc-400" />
                <span>Export Block File</span>
              </button>
            )
          )}
        </div>

        {/* Destructive Action Area */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('danger')}
            className="w-full flex items-center justify-between text-[10px] font-mono tracking-wider text-red-400/80 hover:text-red-300 uppercase cursor-pointer mb-2"
            aria-expanded={openSections.danger}
          >
            <span>Danger Zone</span>
            {openSections.danger ? (
              <ChevronDown className="w-3.5 h-3.5 text-red-400/70" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-red-400/70" />
            )}
          </button>

          {openSections.danger && (
            confirmDeleteBlock ? (
              <div className="p-2.5 bg-red-950/40 border border-red-900/60 rounded text-xs space-y-2">
                <div className="text-red-300 font-medium">Delete this block?</div>
                <div className="text-[11px] text-red-400/80">
                  This block and all {totalTethersCount} connected tether(s) will be permanently deleted.
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteBlock(block.id);
                      setConfirmDeleteBlockId(null);
                    }}
                    className="px-2.5 py-1 bg-red-800 hover:bg-red-700 text-red-100 rounded text-xs font-medium cursor-pointer"
                  >
                    Confirm Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteBlockId(null)}
                    className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDeleteBlockId(block.id)}
                className="w-full flex items-center justify-center gap-2 py-1.5 px-3 bg-red-950/30 hover:bg-red-900/40 border border-red-900/60 text-red-400 hover:text-red-300 rounded text-xs transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Block</span>
              </button>
            )
          )}
        </div>
      </div>
    </aside>
  );
}

