'use client';

import React, { useMemo, useState } from 'react';
import type {
  Block,
  CodeBlockData,
  FileBlockData,
  TextBlockData,
  UploadBlockData,
} from '../../types/model';
import {
  formatFileSize,
  getFileTypeInfo,
  parseCsvRows,
} from '../../lib/fileTypes';
import {
  Binary,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Music,
  Search,
  Table,
} from 'lucide-react';

interface UniversalBlockViewerProps {
  block: Block;
  contentOverride?: string;
  allBlocks?: Block[];
  onOpenBlock?: (blockId: string) => void;
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={keyIdx++}
          className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700/70 rounded text-orange-300 font-mono text-[0.88em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={keyIdx++} className="font-semibold text-zinc-100">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={keyIdx++} className="italic text-zinc-200">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        const safeHref = /^(https?:|mailto:|#)/i.test(href) ? href : '#';
        parts.push(
          <a
            key={keyIdx++}
            href={safeHref}
            target={safeHref.startsWith('http') ? '_blank' : undefined}
            rel={safeHref.startsWith('http') ? 'noopener noreferrer' : undefined}
            className="text-orange-400 hover:text-orange-300 underline underline-offset-2"
          >
            {label}
          </a>
        );
      } else {
        parts.push(token);
      }
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function MarkdownPreview({ source }: { source: string }) {
  const blocks = useMemo(() => {
    const lines = source.split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        nodes.push(
          <div
            key={key++}
            className="my-3 rounded-lg border border-zinc-700/80 bg-[#090B0E] overflow-hidden"
          >
            {lang && (
              <div className="px-3 py-1 bg-zinc-900/90 border-b border-zinc-800 text-[10px] font-mono uppercase text-zinc-400">
                {lang}
              </div>
            )}
            <pre className="p-3 text-xs font-mono text-zinc-200 overflow-x-auto whitespace-pre leading-relaxed">
              {codeLines.join('\n')}
            </pre>
          </div>
        );
        continue;
      }

      if (/^---+$|^\*\*\*+$/.test(line.trim())) {
        nodes.push(<hr key={key++} className="my-4 border-zinc-800" />);
        i++;
        continue;
      }

      const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const cls =
          level === 1
            ? 'text-xl font-bold text-zinc-50 border-b border-zinc-800 pb-2 mt-4 mb-3'
            : level === 2
            ? 'text-lg font-semibold text-zinc-100 mt-4 mb-2'
            : level === 3
            ? 'text-base font-semibold text-orange-200 mt-3 mb-1.5'
            : 'text-sm font-semibold text-zinc-200 mt-2.5 mb-1';
        nodes.push(
          <div key={key++} className={cls}>
            {renderInlineMarkdown(text)}
          </div>
        );
        i++;
        continue;
      }

      if (line.trim().startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        nodes.push(
          <blockquote
            key={key++}
            className="my-2.5 pl-3.5 border-l-2 border-orange-500/75 text-zinc-300 italic text-sm space-y-1"
          >
            {quoteLines.map((ql, idx) => (
              <p key={idx}>{renderInlineMarkdown(ql)}</p>
            ))}
          </blockquote>
        );
        continue;
      }

      if (/^[-*+]\s+/.test(line.trim())) {
        const items: string[] = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
          i++;
        }
        nodes.push(
          <ul key={key++} className="my-2 pl-5 list-disc space-y-1 text-sm text-zinc-300">
            {items.map((item, idx) => (
              <li key={idx}>{renderInlineMarkdown(item)}</li>
            ))}
          </ul>
        );
        continue;
      }

      if (/^\d+\.\s+/.test(line.trim())) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
          i++;
        }
        nodes.push(
          <ol key={key++} className="my-2 pl-5 list-decimal space-y-1 text-sm text-zinc-300">
            {items.map((item, idx) => (
              <li key={idx}>{renderInlineMarkdown(item)}</li>
            ))}
          </ol>
        );
        continue;
      }

      if (!line.trim()) {
        i++;
        continue;
      }

      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^(#{1,4}\s+|```|>|[-*+]\s+|\d+\.\s+|---+$)/.test(lines[i].trim())
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <p key={key++} className="my-2 text-sm text-zinc-300 leading-relaxed">
          {renderInlineMarkdown(paraLines.join(' '))}
        </p>
      );
    }

    return nodes;
  }, [source]);

  if (!source.trim()) {
    return (
      <div className="p-8 text-center text-xs font-mono text-zinc-500 italic">
        Empty document — switch to Raw or Sections to write content.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-5 sm:p-8 select-text font-sans">
      {blocks}
    </div>
  );
}

export function UniversalBlockViewer({
  block,
  contentOverride,
  allBlocks = [],
  onOpenBlock,
}: UniversalBlockViewerProps) {
  const [archiveSearch, setArchiveSearch] = useState('');

  const fileData = block.kind === 'file' ? (block.data as FileBlockData) : undefined;
  const uploadData = block.kind === 'upload' ? (block.data as UploadBlockData) : undefined;
  const codeData = block.kind === 'code' ? (block.data as CodeBlockData) : undefined;
  const textData = block.kind === 'text' ? (block.data as TextBlockData) : undefined;

  const effectiveContent = useMemo(() => {
    if (contentOverride !== undefined) return contentOverride;
    if (block.kind === 'code') return codeData?.currentContent ?? '';
    if (block.kind === 'text') return textData?.content ?? '';
    if (block.kind === 'file') return fileData?.content ?? '';
    return '';
  }, [contentOverride, block.kind, codeData, textData, fileData]);

  const info = useMemo(
    () =>
      getFileTypeInfo({
        title: block.title,
        kind: block.kind,
        mimeType: fileData?.mimeType,
        binary: fileData?.binary,
        isPdf: fileData?.isPdf,
        language: codeData?.language,
      }),
    [block.title, block.kind, fileData?.mimeType, fileData?.binary, fileData?.isPdf, codeData?.language]
  );

  const svgDataUrl = useMemo(() => {
    if (info.viewerKind !== 'svg') return fileData?.dataUrl;
    if (fileData?.dataUrl) return fileData.dataUrl;
    if (!effectiveContent.trim()) return undefined;
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(effectiveContent)}`;
    } catch {
      return undefined;
    }
  }, [info.viewerKind, fileData?.dataUrl, effectiveContent]);

  const csvRows = useMemo(() => {
    if (info.viewerKind !== 'csv') return [];
    const delimiter = info.extension === 'tsv' ? '\t' : ',';
    return parseCsvRows(effectiveContent, delimiter);
  }, [info.viewerKind, info.extension, effectiveContent]);

  const extractedBlockIds = uploadData?.extractedBlockIds;
  const archiveChildren = useMemo(() => {
    if (info.viewerKind !== 'archive' || !extractedBlockIds) return [];
    const childSet = new Set(extractedBlockIds);
    const list = allBlocks.filter((b) => childSet.has(b.id));
    if (!archiveSearch.trim()) return list;
    const q = archiveSearch.trim().toLowerCase();
    return list.filter((b) => {
      const p = ((b.data as FileBlockData)?.path || b.title).toLowerCase();
      return b.title.toLowerCase().includes(q) || p.includes(q);
    });
  }, [info.viewerKind, extractedBlockIds, allBlocks, archiveSearch]);

  // 1. HTML Live Rendered Page
  if (info.viewerKind === 'html') {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#090B0E] overflow-hidden">
        <div className="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-700/75 flex items-center justify-between text-[11px] font-mono text-zinc-400 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="truncate text-zinc-200">{block.title}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 border border-orange-500/40 text-orange-300">
              Rendered Page
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 hidden sm:inline">Sandboxed HTML preview</span>
        </div>
        <div className="flex-1 p-2 sm:p-3 bg-[#090B0E] overflow-hidden">
          <iframe
            title={block.title}
            sandbox="allow-scripts"
            srcDoc={effectiveContent || '<p style="font-family:sans-serif;color:#666;padding:16px;">Empty HTML document</p>'}
            className="w-full h-full bg-white rounded-md border border-zinc-700/80"
          />
        </div>
      </div>
    );
  }

  // 2. Markdown Rendered Page
  if (info.viewerKind === 'markdown') {
    return (
      <div className="flex-1 overflow-y-auto bg-[#090B0E] h-full">
        <MarkdownPreview source={effectiveContent} />
      </div>
    );
  }

  // 3. CSV / TSV Table View
  if (info.viewerKind === 'csv') {
    const headerRow = csvRows[0] || [];
    const bodyRows = csvRows.slice(1);
    return (
      <div className="flex-1 flex flex-col h-full bg-[#090B0E] overflow-hidden">
        <div className="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-700/75 flex items-center justify-between text-[11px] font-mono text-zinc-400 shrink-0">
          <div className="flex items-center gap-2">
            <Table className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-zinc-200">{info.label}</span>
          </div>
          <span className="tabular-nums text-[10px]">
            {csvRows.length} rows × {headerRow.length} cols
          </span>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {csvRows.length === 0 ? (
            <div className="p-8 text-center text-xs font-mono text-zinc-500 italic">
              Empty table file.
            </div>
          ) : (
            <table className="w-full border-collapse text-xs font-mono">
              <thead>
                <tr className="bg-zinc-900 sticky top-0 z-10">
                  <th className="px-2.5 py-2 text-right text-zinc-500 border border-zinc-800 w-10">#</th>
                  {headerRow.map((col, idx) => (
                    <th
                      key={idx}
                      className="px-3 py-2 text-left font-semibold text-orange-200 border border-zinc-800 whitespace-nowrap"
                    >
                      {col || `Column ${idx + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-zinc-900/60 transition-colors">
                    <td className="px-2.5 py-1.5 text-right text-zinc-600 border border-zinc-800/80 tabular-nums">
                      {rIdx + 1}
                    </td>
                    {headerRow.map((_, cIdx) => (
                      <td
                        key={cIdx}
                        className="px-3 py-1.5 text-zinc-300 border border-zinc-800/80 max-w-xs truncate"
                        title={row[cIdx] ?? ''}
                      >
                        {row[cIdx] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // 4. Image & SVG Viewer
  if (info.viewerKind === 'image' || info.viewerKind === 'svg') {
    const imgSrc = info.viewerKind === 'svg' ? svgDataUrl : fileData?.dataUrl;
    return (
      <div className="flex-1 flex flex-col h-full bg-[#090B0E] overflow-hidden">
        <div className="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-700/75 flex items-center justify-between text-[11px] font-mono text-zinc-400 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate text-zinc-200">{block.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${info.badgeClass}`}>
              {info.badge}
            </span>
          </div>
          {imgSrc && (
            <a
              href={imgSrc}
              download={block.title}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] border border-zinc-700 transition"
            >
              <Download className="w-3 h-3 text-orange-400" />
              <span>Download</span>
            </a>
          )}
        </div>
        <div
          className="flex-1 flex items-center justify-center p-6 overflow-auto"
          style={{
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        >
          {imgSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt={block.title}
              className="max-w-full max-h-full object-contain rounded-lg border border-zinc-700/80 shadow-2xl bg-zinc-950/50"
            />
          ) : (
            <div className="text-center space-y-2 p-6 glass-card border border-zinc-700/80 rounded-lg max-w-sm">
              <ImageIcon className="w-10 h-10 text-emerald-400/75 mx-auto" />
              <div className="text-xs font-mono text-zinc-200 font-semibold">{block.title}</div>
              <div className="text-[11px] font-mono text-zinc-400">
                Image preview bytes are unavailable for this older entry ({formatFileSize(fileData?.size)}). Re-import the file or ZIP archive to render it.
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 5. PDF Viewer
  if (info.viewerKind === 'pdf') {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#090B0E] overflow-hidden">
        <div className="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-700/75 flex items-center justify-between text-[11px] font-mono text-zinc-400 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="truncate text-zinc-200">{block.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${info.badgeClass}`}>
              PDF
            </span>
          </div>
          {fileData?.dataUrl && (
            <a
              href={fileData.dataUrl}
              download={block.title}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] border border-zinc-700 transition"
            >
              <Download className="w-3 h-3 text-orange-400" />
              <span>Download PDF</span>
            </a>
          )}
        </div>

        {fileData?.dataUrl ? (
          <div className="flex-1 p-2 sm:p-3 overflow-hidden">
            <object
              data={fileData.dataUrl}
              type="application/pdf"
              className="w-full h-full rounded border border-zinc-700/80 bg-zinc-900"
            >
              <div className="flex flex-col items-center justify-center h-full text-center p-6 text-zinc-400 font-mono">
                <FileText className="w-10 h-10 text-rose-400 mb-2" />
                <p className="text-xs text-zinc-200 font-semibold">PDF Inline Preview Unavailable</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Download the PDF file directly to inspect it in your system viewer.
                </p>
                <a
                  href={fileData.dataUrl}
                  download={block.title}
                  className="mt-3 px-3 py-1.5 bg-orange-500/20 border border-orange-500/60 text-orange-200 rounded text-xs"
                >
                  Download {block.title}
                </a>
              </div>
            </object>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center font-mono">
            <FileText className="w-12 h-12 text-rose-400/80 mb-3" />
            <p className="text-xs font-semibold text-zinc-200">{block.title}</p>
            <p className="text-[11px] text-zinc-400 mt-1">
              PDF metadata loaded ({formatFileSize(fileData?.size)}). Re-drop the PDF or ZIP to load inline pages.
            </p>
          </div>
        )}
      </div>
    );
  }

  // 6. Audio Player
  if (info.viewerKind === 'audio') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#090B0E] h-full font-mono">
        <div className="w-full max-w-md glass-card border border-zinc-700/80 rounded-xl p-6 space-y-4 text-center">
          <div className="w-12 h-12 rounded-full bg-violet-500/15 border border-violet-500/40 flex items-center justify-center mx-auto">
            <Music className="w-6 h-6 text-violet-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100 truncate">{block.title}</div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              {info.label} · {formatFileSize(fileData?.size)}
            </div>
          </div>
          {fileData?.dataUrl ? (
            <div className="space-y-3">
              <audio controls src={fileData.dataUrl} className="w-full" />
              <a
                href={fileData.dataUrl}
                download={block.title}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 rounded text-xs transition"
              >
                <Download className="w-3.5 h-3.5 text-orange-400" />
                <span>Download Audio</span>
              </a>
            </div>
          ) : (
            <div className="text-[11px] text-zinc-500">
              Audio stream unavailable for this archive entry.
            </div>
          )}
        </div>
      </div>
    );
  }

  // 7. Video Player
  if (info.viewerKind === 'video') {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#090B0E] overflow-hidden font-mono">
        <div className="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-700/75 flex items-center justify-between text-[11px] text-zinc-400 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Film className="w-3.5 h-3.5 text-pink-400 shrink-0" />
            <span className="truncate text-zinc-200">{block.title}</span>
          </div>
          {fileData?.dataUrl && (
            <a
              href={fileData.dataUrl}
              download={block.title}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] border border-zinc-700 transition"
            >
              <Download className="w-3 h-3 text-orange-400" />
              <span>Download</span>
            </a>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center p-4 bg-black/70 overflow-hidden">
          {fileData?.dataUrl ? (
            <video
              controls
              src={fileData.dataUrl}
              className="max-w-full max-h-full rounded-lg border border-zinc-800"
            />
          ) : (
            <div className="text-xs text-zinc-400">
              Video bytes unavailable ({formatFileSize(fileData?.size)}).
            </div>
          )}
        </div>
      </div>
    );
  }

  // 8. ZIP Archive Manifest Viewer (upload block or .zip file)
  if (info.viewerKind === 'archive') {
    const childCount = uploadData?.extractedBlockIds?.length ?? 0;
    return (
      <div className="flex-1 flex flex-col h-full bg-[#090B0E] overflow-hidden font-mono">
        <div className="p-4 border-b border-zinc-700/75 bg-zinc-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-orange-500/15 border border-orange-500/40 shrink-0">
              <FileArchive className="w-5 h-5 text-orange-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100 truncate">
                {uploadData?.fileName || block.title}
              </div>
              <div className="text-[11px] text-zinc-400 tabular-nums">
                {childCount} extracted file{childCount === 1 ? '' : 's'} · {formatFileSize(uploadData?.size ?? fileData?.size)}
              </div>
            </div>
          </div>

          {childCount > 0 && (
            <div className="relative flex items-center sm:w-64">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter archive files..."
                value={archiveSearch}
                onChange={(e) => setArchiveSearch(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700/80 focus:border-orange-500/70 rounded pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {childCount === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
              No extracted files stored in this archive block yet. Drop a .ZIP onto the block card on the canvas to populate entries.
            </div>
          ) : archiveChildren.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              No files matching &ldquo;{archiveSearch}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-4xl mx-auto">
              {archiveChildren.map((child) => {
                const cData = child.data as FileBlockData;
                const cInfo = getFileTypeInfo({
                  title: child.title,
                  kind: child.kind,
                  mimeType: cData?.mimeType,
                  binary: cData?.binary,
                  isPdf: cData?.isPdf,
                });
                return (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => onOpenBlock?.(child.id)}
                    className="flex items-center justify-between gap-2 p-2.5 glass-card border border-zinc-700/75 hover:border-orange-500/70 rounded-lg text-left transition cursor-pointer group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${cInfo.badgeClass}`}>
                          {cInfo.badge}
                        </span>
                        <span className="text-xs font-medium text-zinc-100 group-hover:text-orange-200 truncate">
                          {child.title}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate mt-1">
                        {cData?.path || child.title}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-zinc-400 tabular-nums">
                        {formatFileSize(cData?.size)}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-zinc-500 group-hover:text-orange-400" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 9. Generic Binary Entry
  if (info.viewerKind === 'binary') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#090B0E] h-full font-mono">
        <div className="w-full max-w-md glass-card border border-zinc-700/80 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-zinc-800 border border-zinc-700">
              <Binary className="w-5 h-5 text-orange-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100 truncate">{block.title}</div>
              <div className="text-[11px] text-zinc-400">{info.label}</div>
            </div>
          </div>

          <div className="p-3 bg-zinc-950/80 border border-zinc-800 rounded text-xs text-zinc-400 space-y-1.5">
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500">Path</span>
              <span className="text-zinc-200 truncate">{fileData?.path || block.title}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500">MIME</span>
              <span className="text-zinc-200 truncate">{fileData?.mimeType || 'application/octet-stream'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500">Size</span>
              <span className="text-zinc-200 tabular-nums">{formatFileSize(fileData?.size)}</span>
            </div>
          </div>

          {fileData?.dataUrl && (
            <a
              href={fileData.dataUrl}
              download={block.title}
              className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/60 text-orange-100 rounded text-xs font-semibold transition"
            >
              <Download className="w-3.5 h-3.5 text-orange-400" />
              <span>Download Binary File</span>
            </a>
          )}
        </div>
      </div>
    );
  }

  // 10. Default Text/Code Read-Only Preview
  return (
    <div className="flex-1 overflow-auto bg-[#090B0E] p-4 font-mono text-xs text-zinc-200 whitespace-pre-wrap select-text leading-relaxed">
      {effectiveContent || <span className="text-zinc-500 italic">Empty file</span>}
    </div>
  );
}
