'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  FileImage,
  FolderInput,
  ImagePlus,
  Link2,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  MEDIA_FOLDER_PRESETS,
  MEDIA_ROLE_OPTIONS,
  buildAssetTargetPath,
  generateImageReferenceSnippet,
  generateStarterSvgAsset,
  getBlockTextAndLanguage,
  getImageBlockPreviewSrc,
  getMediaRoleMeta,
  inferMediaRoleAndFolder,
  isImageBlock,
  isImageFilenameOrMime,
  readBrowserImageFile,
  sanitizeFolderPath,
  sanitizeLeafFileName,
  type MediaCategoryId,
} from '../../lib/imageAssets';
import { formatFileSize, getFileTypeInfo } from '../../lib/fileTypes';
import type { FileBlockData } from '../../types/model';

interface QueuedUploadImage {
  localId: string;
  fileName: string;
  mimeType: string;
  size: number;
  binary: boolean;
  dataUrl?: string;
  content?: string;
  mediaCategory: MediaCategoryId;
  folderPath: string;
  customFolder: boolean;
}

function getPreviewUrlForQueued(item: QueuedUploadImage): string | undefined {
  if (item.dataUrl) return item.dataUrl;
  if (item.content?.trim()) {
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.content)}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type ActiveImageModalRequest = NonNullable<
  ReturnType<typeof useWorkspaceStore.getState>['imageModalRequest']
>;

export function AddImageModal() {
  const imageModalRequest = useWorkspaceStore((s) => s.imageModalRequest);
  const closeImageModal = useWorkspaceStore((s) => s.closeImageModal);

  if (!imageModalRequest?.isOpen) return null;

  return (
    <AddImageModalInner
      key={imageModalRequest.token}
      request={imageModalRequest}
      closeImageModal={closeImageModal}
    />
  );
}

function AddImageModalInner({
  request,
  closeImageModal,
}: {
  request: ActiveImageModalRequest;
  closeImageModal: () => void;
}) {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeGroupId = useWorkspaceStore((s) => s.activeGroupId);
  const blocks = useWorkspaceStore((s) => s.blocks);
  const addImageAssetsToProject = useWorkspaceStore((s) => s.addImageAssetsToProject);
  const attachExistingImagesToBlock = useWorkspaceStore((s) => s.attachExistingImagesToBlock);
  const setImageFeedback = useWorkspaceStore((s) => s.setImageFeedback);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const initialDefaults = useMemo(() => {
    const initialTab = request.initialTab ?? 'upload';
    const preIds = request.preselectedImageIds ?? [];
    const defaultTarget = request.targetCodeBlockId ?? '';
    const defaultFolder = request.targetFolder;

    let inferredRole: MediaCategoryId = 'media-asset';
    let resolvedFolder = defaultFolder ?? 'assets/images';

    if (preIds.length > 0) {
      const firstImg = blocks.find((b) => b.id === preIds[0]);
      if (firstImg?.projectCategory?.startsWith('media-')) {
        inferredRole = firstImg.projectCategory as MediaCategoryId;
      } else if (firstImg) {
        inferredRole = inferMediaRoleAndFolder(firstImg.title).categoryId;
      }
      if (!defaultFolder) {
        resolvedFolder = getMediaRoleMeta(inferredRole).defaultFolder;
      }
    } else if (defaultFolder) {
      const matched = MEDIA_ROLE_OPTIONS.find(
        (r) => r.defaultFolder === sanitizeFolderPath(defaultFolder)
      );
      if (matched) inferredRole = matched.id;
    }

    return {
      initialTab,
      inferredRole,
      resolvedFolder,
      defaultTarget,
      preIds,
      keepFolders: preIds.length === 0 || !defaultFolder,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [activeTab, setActiveTab] = useState<'upload' | 'existing'>(initialDefaults.initialTab);
  const [selectedRole, setSelectedRole] = useState<MediaCategoryId>(initialDefaults.inferredRole);
  const [folderPath, setFolderPath] = useState<string>(initialDefaults.resolvedFolder);
  const [targetCodeBlockId, setTargetCodeBlockId] = useState<string>(initialDefaults.defaultTarget);
  const [insertCodeRef, setInsertCodeRef] = useState<boolean>(true);
  const [queuedImages, setQueuedImages] = useState<QueuedUploadImage[]>([]);
  const [selectedExistingIds, setSelectedExistingIds] = useState<string[]>(initialDefaults.preIds);
  const [keepExistingFolders, setKeepExistingFolders] = useState<boolean>(
    initialDefaults.keepFolders
  );
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Esc key closes modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeImageModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeImageModal]);

  const projectBlocks = useMemo(() => {
    if (!activeProjectId) return [];
    return blocks.filter((b) => b.projectId === activeProjectId);
  }, [blocks, activeProjectId]);

  const attachableCodeBlocks = useMemo(() => {
    return projectBlocks
      .filter((b) => {
        if (b.kind === 'upload') return false;
        if (isImageBlock(b)) return false;
        const fData = b.kind === 'file' ? (b.data as FileBlockData) : undefined;
        const info = getFileTypeInfo({
          title: b.title,
          kind: b.kind,
          mimeType: fData?.mimeType,
          binary: fData?.binary,
          isPdf: fData?.isPdf,
        });
        return info.isTextEditable;
      })
      .sort((a, b) => {
        const aSameGroup = a.groupId === activeGroupId ? 0 : 1;
        const bSameGroup = b.groupId === activeGroupId ? 0 : 1;
        if (aSameGroup !== bSameGroup) return aSameGroup - bSameGroup;
        const aIsHtml = a.title.toLowerCase().endsWith('.html') ? 0 : 1;
        const bIsHtml = b.title.toLowerCase().endsWith('.html') ? 0 : 1;
        if (aIsHtml !== bIsHtml) return aIsHtml - bIsHtml;
        return a.title.localeCompare(b.title);
      });
  }, [projectBlocks, activeGroupId]);

  const existingImageBlocks = useMemo(() => {
    return projectBlocks.filter((b) => isImageBlock(b));
  }, [projectBlocks]);

  const targetBlock = useMemo(() => {
    if (!targetCodeBlockId) return undefined;
    return projectBlocks.find((b) => b.id === targetCodeBlockId);
  }, [projectBlocks, targetCodeBlockId]);

  const handleSelectRole = (role: MediaCategoryId) => {
    setSelectedRole(role);
    const meta = getMediaRoleMeta(role);
    setFolderPath(meta.defaultFolder);
    setKeepExistingFolders(false);
    setQueuedImages((prev) =>
      prev.map((item) =>
        item.customFolder
          ? item
          : { ...item, mediaCategory: role, folderPath: meta.defaultFolder }
      )
    );
  };

  const handleGlobalFolderChange = (nextFolder: string) => {
    const sanitized = nextFolder.replace(/\\/g, '/').replace(/^\/+/, '');
    setFolderPath(sanitized);
    setKeepExistingFolders(false);
    setQueuedImages((prev) =>
      prev.map((item) =>
        item.customFolder ? item : { ...item, folderPath: sanitizeFolderPath(sanitized) }
      )
    );
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    setErrorMsg(null);
    const added: QueuedUploadImage[] = [];
    const skipped: string[] = [];

    for (let i = 0; i < incoming.length; i++) {
      const file = incoming[i];
      if (!isImageFilenameOrMime(file.name, file.type)) {
        skipped.push(file.name);
        continue;
      }

      try {
        const read = await readBrowserImageFile(file);
        const inferred = inferMediaRoleAndFolder(read.fileName);
        // Respect user's explicit role/folder if they picked one (or if uploading multiple gallery images)
        const shouldAutoInfer =
          queuedImages.length === 0 &&
          selectedRole === 'media-asset' &&
          folderPath === 'assets/images';

        const effectiveRole = shouldAutoInfer ? inferred.categoryId : selectedRole;
        const effectiveFolder = shouldAutoInfer
          ? inferred.folder
          : sanitizeFolderPath(folderPath);

        if (shouldAutoInfer && i === 0) {
          setSelectedRole(inferred.categoryId);
          setFolderPath(inferred.folder);
        }

        added.push({
          localId: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          fileName: read.fileName,
          mimeType: read.mimeType,
          size: read.size,
          binary: read.binary,
          dataUrl: read.dataUrl,
          content: read.content,
          mediaCategory: effectiveRole,
          folderPath: effectiveFolder,
          customFolder: false,
        });
      } catch (err) {
        setErrorMsg((err as Error).message || `Failed to read ${file.name}.`);
      }
    }

    if (skipped.length > 0) {
      setErrorMsg(
        `Skipped non-image file(s): ${skipped.join(', ')}. Supported: PNG, JPG, SVG, ICO, WebP, GIF, AVIF.`
      );
    }

    if (added.length > 0) {
      setQueuedImages((prev) => [...prev, ...added]);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (activeTab !== 'upload') return;
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles: File[] = [];
    let pasteIdx = 1;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const rawFile = item.getAsFile();
        if (rawFile) {
          const ext = rawFile.type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
          const name =
            rawFile.name && rawFile.name !== 'image.png'
              ? rawFile.name
              : `pasted-image-${queuedImages.length + pasteIdx}.${ext}`;
          pasteIdx++;
          imageFiles.push(new File([rawFile], name, { type: rawFile.type }));
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      await processFiles(imageFiles);
    }
  };

  const handleAddStarterSvg = (role: MediaCategoryId) => {
    const meta = getMediaRoleMeta(role);
    const countSame = queuedImages.filter((q) => q.mediaCategory === role).length;
    const suffix = countSame > 0 ? `-${countSame + 1}` : '';
    const baseStem =
      role === 'media-favicon'
        ? `favicon${suffix}.svg`
        : role === 'media-icon'
        ? `icon${suffix}.svg`
        : role === 'media-gallery'
        ? `gallery-${countSame + 1}.svg`
        : role === 'media-bg'
        ? `background${suffix}.svg`
        : role === 'media-ui'
        ? `ui-graphic${suffix}.svg`
        : `image${suffix}.svg`;

    const svgAsset = generateStarterSvgAsset(role, baseStem);
    setSelectedRole(role);
    setFolderPath(meta.defaultFolder);
    setQueuedImages((prev) => [
      ...prev,
      {
        localId: `${Date.now()}-svg-${Math.random().toString(36).slice(2, 7)}`,
        fileName: svgAsset.fileName,
        mimeType: svgAsset.mimeType,
        size: svgAsset.size,
        binary: false,
        content: svgAsset.content,
        mediaCategory: role,
        folderPath: meta.defaultFolder,
        customFolder: false,
      },
    ]);
    setErrorMsg(null);
  };

  const snippetPreview = useMemo(() => {
    if (!targetBlock || !insertCodeRef) return '';
    const { language, path } = getBlockTextAndLanguage(targetBlock);

    if (activeTab === 'upload') {
      if (queuedImages.length === 0) return '';
      const entries = queuedImages.map((item) => ({
        path: buildAssetTargetPath(item.fileName, item.folderPath),
        title: sanitizeLeafFileName(item.fileName),
        mimeType: item.mimeType,
      }));
      return generateImageReferenceSnippet({
        targetFilePath: path,
        targetLanguage: language,
        imageEntries: entries,
        role: selectedRole,
      });
    }

    if (selectedExistingIds.length === 0) return '';
    const selectedBlocks = existingImageBlocks.filter((b) =>
      selectedExistingIds.includes(b.id)
    );
    if (selectedBlocks.length === 0) return '';

    const entries = selectedBlocks.map((b) => {
      const currentPath = (
        b.sourcePath ||
        (b.data as FileBlockData | undefined)?.path ||
        b.title
      ).replace(/^\/+/, '');
      const nextPath = keepExistingFolders
        ? currentPath
        : buildAssetTargetPath(b.title, folderPath);
      return {
        path: nextPath,
        title: b.title,
        mimeType: (b.data as FileBlockData | undefined)?.mimeType,
      };
    });

    return generateImageReferenceSnippet({
      targetFilePath: path,
      targetLanguage: language,
      imageEntries: entries,
      role: selectedRole,
    });
  }, [
    targetBlock,
    insertCodeRef,
    activeTab,
    queuedImages,
    selectedRole,
    selectedExistingIds,
    existingImageBlocks,
    keepExistingFolders,
    folderPath,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProjectId || !activeGroupId) {
      setErrorMsg('Select a project and tether group before adding images.');
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      if (activeTab === 'upload') {
        if (queuedImages.length === 0) {
          setErrorMsg('Drop, browse, paste, or generate at least one image first.');
          setIsSubmitting(false);
          return;
        }

        const result = await addImageAssetsToProject({
          projectId: activeProjectId,
          groupId: activeGroupId,
          items: queuedImages.map((q) => ({
            fileName: q.fileName,
            mimeType: q.mimeType,
            size: q.size,
            binary: q.binary,
            dataUrl: q.dataUrl,
            content: q.content,
            mediaCategory: q.mediaCategory,
            folderPath: q.folderPath,
          })),
          defaultMediaCategory: selectedRole,
          defaultFolderPath: folderPath,
          attachToBlockId: targetCodeBlockId || undefined,
          insertCodeReference: Boolean(targetCodeBlockId && insertCodeRef),
        });

        const count = result.createdBlocks.length;
        const folderLabel = sanitizeFolderPath(folderPath) || 'root';
        if (targetBlock && result.insertedSnippet) {
          setImageFeedback(
            `Added ${count} image${count === 1 ? '' : 's'} to ${folderLabel}/ and inserted reference into ${targetBlock.title}.`
          );
        } else if (targetBlock) {
          setImageFeedback(
            `Added ${count} image${count === 1 ? '' : 's'} to ${folderLabel}/ and tethered to ${targetBlock.title}.`
          );
        } else {
          setImageFeedback(
            `Added ${count} image${count === 1 ? '' : 's'} to ${folderLabel}/ in Project Hierarchy.`
          );
        }

        closeImageModal();
        return;
      }

      // Tab 2: Attach existing project images
      if (!targetCodeBlockId) {
        setErrorMsg('Choose a target code/HTML/CSS block to attach selected images to.');
        setIsSubmitting(false);
        return;
      }
      if (selectedExistingIds.length === 0) {
        setErrorMsg('Select one or more existing project images.');
        setIsSubmitting(false);
        return;
      }

      const result = await attachExistingImagesToBlock({
        targetCodeBlockId,
        imageBlockIds: selectedExistingIds,
        role: selectedRole,
        folderOverride: keepExistingFolders ? undefined : sanitizeFolderPath(folderPath),
        insertCodeReference: insertCodeRef,
      });

      if (targetBlock && result.insertedSnippet) {
        setImageFeedback(
          `Attached ${result.attachedCount} image${
            result.attachedCount === 1 ? '' : 's'
          } and updated ${targetBlock.title}.`
        );
      } else if (targetBlock) {
        setImageFeedback(
          `Tethered ${result.attachedCount} image${
            result.attachedCount === 1 ? '' : 's'
          } to ${targetBlock.title}.`
        );
      }
      closeImageModal();
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to add images.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={closeImageModal}
      onPaste={handlePaste}
      role="dialog"
      aria-modal="true"
      aria-label="Add & Attach Project Images"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[92vh] glass-menu border border-zinc-600/80 border-t-orange-500/80 rounded-xl flex flex-col overflow-hidden shadow-2xl animate-panel-in font-mono"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-700/75 glass-header flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-orange-500/15 border border-orange-500/50 flex items-center justify-center shrink-0">
              <ImagePlus className="w-4 h-4 text-orange-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-semibold text-zinc-100 truncate">
                Add &amp; Attach Project Images
              </h2>
              <p className="text-[11px] text-zinc-400 truncate">
                Favicons, galleries, icons &amp; media synced straight into your Seed Folder Tree
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeImageModal}
            className="w-8 h-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition cursor-pointer shrink-0"
            aria-label="Close Add Images dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-4 pt-2.5 border-b border-zinc-700/70 bg-zinc-950/40 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('upload');
              setErrorMsg(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md border-b-2 transition cursor-pointer ${
              activeTab === 'upload'
                ? 'border-orange-500 text-orange-100 bg-orange-500/10 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5 text-orange-400" />
            <span>Upload / Create Pictures</span>
            {queuedImages.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-orange-500/20 text-orange-200 text-[10px] tabular-nums">
                {queuedImages.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('existing');
              setErrorMsg(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md border-b-2 transition cursor-pointer ${
              activeTab === 'existing'
                ? 'border-orange-500 text-orange-100 bg-orange-500/10 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileImage className="w-3.5 h-3.5 text-emerald-400" />
            <span>Existing Project Images</span>
            <span className="px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300 text-[10px] tabular-nums">
              {existingImageBlocks.length}
            </span>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Use-case Role Quick Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                1. Use Case &amp; Media Category
              </label>
              <span className="text-[10px] text-zinc-500">
                {getMediaRoleMeta(selectedRole).description}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {MEDIA_ROLE_OPTIONS.map((role) => {
                const isSelected = selectedRole === role.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => handleSelectRole(role.id)}
                    className={`px-2.5 py-1.5 rounded-md border text-left transition cursor-pointer ${
                      isSelected
                        ? 'bg-orange-500/20 border-orange-500/75 text-orange-100 font-semibold'
                        : 'bg-zinc-900/70 hover:bg-zinc-800/80 border-zinc-700/75 text-zinc-300 hover:text-white'
                    }`}
                  >
                    <div className="text-[11px] truncate">{role.label}</div>
                    <div className="text-[10px] text-zinc-400 truncate">
                      {role.defaultFolder}/
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Folder Destination */}
          <div className="space-y-1.5 p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/90">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="image-folder-path-input"
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400 font-semibold"
              >
                <FolderInput className="w-3.5 h-3.5 text-orange-400" />
                <span>2. Seed Folder Destination</span>
              </label>

              {activeTab === 'existing' && (
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keepExistingFolders}
                    onChange={(e) => setKeepExistingFolders(e.target.checked)}
                    className="accent-orange-500 rounded cursor-pointer"
                  />
                  <span>Keep current image paths</span>
                </label>
              )}
            </div>

            {(!keepExistingFolders || activeTab === 'upload') && (
              <>
                <div className="flex items-center gap-2">
                  <input
                    id="image-folder-path-input"
                    type="text"
                    value={folderPath}
                    onChange={(e) => handleGlobalFolderChange(e.target.value)}
                    placeholder="e.g. public or assets/images/gallery (leave blank for root)"
                    className="flex-1 bg-zinc-900 border border-zinc-700/80 focus:border-orange-500 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {MEDIA_FOLDER_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => handleGlobalFolderChange(preset.value)}
                      className={`px-2 py-0.5 rounded text-[10px] border transition cursor-pointer ${
                        sanitizeFolderPath(folderPath) === preset.value
                          ? 'bg-orange-500/20 border-orange-500/60 text-orange-200'
                          : 'bg-zinc-900/70 hover:bg-zinc-800 border-zinc-700/70 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Tab 1: Upload / Dropzone / Starter SVGs */}
          {activeTab === 'upload' && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.ico,.svg,.png,.jpg,.jpeg,.webp,.gif,.avif,.bmp"
                multiple
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    void processFiles(e.target.files);
                  }
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="hidden"
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    void processFiles(e.dataTransfer.files);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`p-5 rounded-xl border-2 border-dashed transition cursor-pointer text-center space-y-2 ${
                  isDraggingOver
                    ? 'border-orange-500 bg-orange-500/10'
                    : 'border-zinc-700/80 hover:border-orange-500/60 bg-zinc-950/50 hover:bg-zinc-900/60'
                }`}
              >
                <UploadCloud className="w-8 h-8 text-orange-400 mx-auto" />
                <div className="text-xs text-zinc-100 font-medium">
                  Drop pictures here, click to browse, or press Ctrl+V to paste
                </div>
                <div className="text-[11px] text-zinc-400">
                  Supports PNG, JPG, SVG, ICO, WebP, GIF, AVIF • Batch selection supported
                </div>
              </div>

              {/* Quick Starter SVG Helper */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                  <span>Need a placeholder SVG right away?</span>
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleAddStarterSvg('media-favicon')}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-orange-500/20 border border-zinc-700 hover:border-orange-500/50 text-[10px] text-zinc-200 cursor-pointer transition"
                  >
                    + Favicon SVG
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddStarterSvg('media-icon')}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-orange-500/20 border border-zinc-700 hover:border-orange-500/50 text-[10px] text-zinc-200 cursor-pointer transition"
                  >
                    + Icon SVG
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddStarterSvg('media-gallery')}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-orange-500/20 border border-zinc-700 hover:border-orange-500/50 text-[10px] text-zinc-200 cursor-pointer transition"
                  >
                    + Gallery SVG
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddStarterSvg('media-bg')}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-orange-500/20 border border-zinc-700 hover:border-orange-500/50 text-[10px] text-zinc-200 cursor-pointer transition"
                  >
                    + Backdrop SVG
                  </button>
                </div>
              </div>

              {/* Queued Upload Cards */}
              {queuedImages.length > 0 && (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {queuedImages.map((item) => {
                    const thumbSrc = getPreviewUrlForQueued(item);
                    const previewPath = buildAssetTargetPath(item.fileName, item.folderPath);
                    return (
                      <div
                        key={item.localId}
                        className="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-700/75"
                      >
                        <div className="w-12 h-12 rounded bg-zinc-950 border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                          {thumbSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumbSrc}
                              alt={item.fileName}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <FileImage className="w-5 h-5 text-zinc-500" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={item.fileName}
                              onChange={(e) => {
                                const nextName = e.target.value;
                                setQueuedImages((prev) =>
                                  prev.map((q) =>
                                    q.localId === item.localId ? { ...q, fileName: nextName } : q
                                  )
                                );
                              }}
                              aria-label="Image filename"
                              className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700/80 focus:border-orange-500 rounded px-2 py-0.5 text-xs text-zinc-100 outline-none"
                            />
                            <span className="text-[10px] text-zinc-400 tabular-nums shrink-0">
                              {formatFileSize(item.size)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                            <span className="truncate text-orange-300/90" title={previewPath}>
                              Path: {previewPath}
                            </span>
                            <select
                              value={item.mediaCategory}
                              onChange={(e) => {
                                const nextRole = e.target.value as MediaCategoryId;
                                const nextFolder = getMediaRoleMeta(nextRole).defaultFolder;
                                setQueuedImages((prev) =>
                                  prev.map((q) =>
                                    q.localId === item.localId
                                      ? {
                                          ...q,
                                          mediaCategory: nextRole,
                                          folderPath: nextFolder,
                                          customFolder: false,
                                        }
                                      : q
                                  )
                                );
                              }}
                              className="bg-zinc-950 border border-zinc-700/75 rounded px-1.5 py-0.5 text-[10px] text-zinc-200 outline-none cursor-pointer"
                            >
                              {MEDIA_ROLE_OPTIONS.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.shortLabel}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setQueuedImages((prev) =>
                              prev.filter((q) => q.localId !== item.localId)
                            )
                          }
                          className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition cursor-pointer shrink-0"
                          title="Remove from queue"
                          aria-label="Remove image from queue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Pick Existing Project Images */}
          {activeTab === 'existing' && (
            <div className="space-y-2">
              {existingImageBlocks.length === 0 ? (
                <div className="p-6 text-center rounded-xl border border-dashed border-zinc-700/80 bg-zinc-950/40 space-y-2">
                  <FileImage className="w-7 h-7 text-zinc-500 mx-auto" />
                  <p className="text-xs text-zinc-400">
                    No images in this project yet. Switch to &ldquo;Upload / Create Pictures&rdquo; to add some.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                  {existingImageBlocks.map((imgBlock) => {
                    const isChecked = selectedExistingIds.includes(imgBlock.id);
                    const previewSrc = getImageBlockPreviewSrc(imgBlock);
                    const imgPath =
                      imgBlock.sourcePath ||
                      (imgBlock.data as FileBlockData | undefined)?.path ||
                      imgBlock.title;
                    return (
                      <button
                        key={imgBlock.id}
                        type="button"
                        onClick={() => {
                          setSelectedExistingIds((prev) =>
                            prev.includes(imgBlock.id)
                              ? prev.filter((id) => id !== imgBlock.id)
                              : [...prev, imgBlock.id]
                          );
                        }}
                        className={`p-2 rounded-lg border text-left transition cursor-pointer flex flex-col gap-1.5 ${
                          isChecked
                            ? 'bg-orange-500/15 border-orange-500/80 text-white'
                            : 'bg-zinc-900/70 hover:bg-zinc-800/80 border-zinc-700/75 text-zinc-300'
                        }`}
                      >
                        <div className="relative h-20 w-full rounded bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center">
                          {previewSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewSrc}
                              alt={imgBlock.title}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <FileImage className="w-5 h-5 text-zinc-500" />
                          )}
                          {isChecked && (
                            <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-orange-500 text-zinc-950 flex items-center justify-center">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-medium truncate">{imgBlock.title}</div>
                        <div className="text-[10px] text-zinc-400 truncate" title={imgPath}>
                          {imgPath}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Target Code Block Linking & Snippet Preview */}
          <div className="space-y-2 p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/90">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label
                htmlFor="target-code-block-select"
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400 font-semibold"
              >
                <Link2 className="w-3.5 h-3.5 text-orange-400" />
                <span>3. Attach to Code Block &amp; Insert Reference</span>
              </label>

              {targetCodeBlockId && (
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={insertCodeRef}
                    onChange={(e) => setInsertCodeRef(e.target.checked)}
                    className="accent-orange-500 rounded cursor-pointer"
                  />
                  <span>Insert HTML/CSS/code tag automatically</span>
                </label>
              )}
            </div>

            <select
              id="target-code-block-select"
              value={targetCodeBlockId}
              onChange={(e) => setTargetCodeBlockId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700/80 focus:border-orange-500 rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none cursor-pointer"
            >
              <option value="">
                {activeTab === 'upload'
                  ? 'No code block (Add straight into Seed Folder Tree)'
                  : '-- Select a code/HTML/CSS block --'}
              </option>
              {attachableCodeBlocks.map((b) => {
                const p =
                  b.sourcePath || (b.data as { path?: string } | undefined)?.path || b.title;
                return (
                  <option key={b.id} value={b.id}>
                    {b.title} ({p})
                  </option>
                );
              })}
            </select>

            {snippetPreview && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                  <Code2 className="w-3 h-3" />
                  <span>Code snippet that will be inserted into {targetBlock?.title}:</span>
                </div>
                <pre className="p-2 rounded bg-zinc-900/90 border border-zinc-700/80 text-[11px] text-zinc-200 overflow-x-auto whitespace-pre-wrap">
                  {snippetPreview}
                </pre>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-800/80 text-red-200 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2">
            <span className="text-[10px] text-zinc-500 hidden sm:inline">
              Added pictures stay synced in Project Hierarchy &amp; .zip exports.
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={closeImageModal}
                className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 rounded-md bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-zinc-950 font-semibold text-xs transition cursor-pointer flex items-center gap-1.5"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                <span>
                  {isSubmitting
                    ? 'Saving...'
                    : activeTab === 'upload'
                    ? targetCodeBlockId
                      ? 'Add & Attach Pictures'
                      : 'Add Pictures to Project'
                    : 'Attach & Insert Selected'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
