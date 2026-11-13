import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getFileTypeInfo,
  parseCsvRows,
  formatFileSize,
  getExtension,
} from '../src/lib/fileTypes';
import { useWorkspaceStore } from '../src/store/workspaceStore';

describe('File type classification and collapsible UI controls', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      isHeaderCollapsed: false,
      isSidebarCollapsed: false,
      isBlockInspectorCollapsed: false,
      isInspectorCollapsed: false,
    });
  });

  it('extracts lowercase extensions reliably across nested paths and queries', () => {
    expect(getExtension('src/components/App.TSX')).toBe('tsx');
    expect(getExtension('docs/guide.markdown?v=1')).toBe('markdown');
    expect(getExtension('Makefile')).toBe('');
    expect(getExtension('.env')).toBe('');
  });

  it('classifies code, markup, markdown, CSV/TSV, SVG, PDF, media, archive, and binary blocks accurately', () => {
    const tsx = getFileTypeInfo({ title: 'App.tsx', kind: 'code', language: 'typescript' });
    expect(tsx.badge).toBe('TSX');
    expect(tsx.viewerKind).toBe('code');
    expect(tsx.isTextEditable).toBe(true);

    const html = getFileTypeInfo({ title: 'index.html', kind: 'file', mimeType: 'text/html' });
    expect(html.badge).toBe('HTML');
    expect(html.viewerKind).toBe('html');
    expect(html.hasRenderedPreview).toBe(true);
    expect(html.isTextEditable).toBe(true);

    const md = getFileTypeInfo({ title: 'README.md', kind: 'file', mimeType: 'text/markdown' });
    expect(md.badge).toBe('MD');
    expect(md.viewerKind).toBe('markdown');
    expect(md.hasRenderedPreview).toBe(true);

    const csv = getFileTypeInfo({ title: 'metrics.csv', kind: 'file', mimeType: 'text/csv' });
    expect(csv.badge).toBe('CSV');
    expect(csv.viewerKind).toBe('csv');
    expect(csv.hasRenderedPreview).toBe(true);

    const tsv = getFileTypeInfo({ title: 'table.tsv', kind: 'file' });
    expect(tsv.badge).toBe('TSV');
    expect(tsv.viewerKind).toBe('csv');

    const svg = getFileTypeInfo({ title: 'logo.svg', kind: 'file', mimeType: 'image/svg+xml' });
    expect(svg.badge).toBe('SVG');
    expect(svg.viewerKind).toBe('svg');
    expect(svg.hasRenderedPreview).toBe(true);
    expect(svg.isTextEditable).toBe(true);

    const png = getFileTypeInfo({ title: 'hero.png', kind: 'file', mimeType: 'image/png', binary: true });
    expect(png.badge).toBe('PNG');
    expect(png.viewerKind).toBe('image');
    expect(png.isTextEditable).toBe(false);

    const pdf = getFileTypeInfo({ title: 'brief.pdf', kind: 'file', isPdf: true, binary: true });
    expect(pdf.badge).toBe('PDF');
    expect(pdf.viewerKind).toBe('pdf');
    expect(pdf.isTextEditable).toBe(false);

    const audio = getFileTypeInfo({ title: 'clip.mp3', kind: 'file', mimeType: 'audio/mpeg', binary: true });
    expect(audio.badge).toBe('MP3');
    expect(audio.viewerKind).toBe('audio');
    expect(audio.isTextEditable).toBe(false);

    const video = getFileTypeInfo({ title: 'demo.mp4', kind: 'file', mimeType: 'video/mp4', binary: true });
    expect(video.badge).toBe('MP4');
    expect(video.viewerKind).toBe('video');
    expect(video.isTextEditable).toBe(false);

    const archive = getFileTypeInfo({ title: 'bundle.zip', kind: 'upload' });
    expect(archive.badge).toBe('ZIP');
    expect(archive.viewerKind).toBe('archive');
    expect(archive.hasRenderedPreview).toBe(true);

    const note = getFileTypeInfo({ title: 'Architecture Notes', kind: 'text' });
    expect(note.badge).toBe('NOTE');
    expect(note.viewerKind).toBe('markdown');
    expect(note.hasRenderedPreview).toBe(true);

    const bin = getFileTypeInfo({ title: 'firmware.bin', kind: 'file', binary: true });
    expect(bin.badge).toBe('BIN');
    expect(bin.viewerKind).toBe('binary');
    expect(bin.isTextEditable).toBe(false);
  });

  it('parses CSV and TSV rows with quoted commas and escaped quotes', () => {
    const csvSample = 'name,role,notes\n"Alice, A.","Engineer","Uses ""quotes"""\nBob,Designer,Clean\n';
    const parsedCsv = parseCsvRows(csvSample, ',');
    expect(parsedCsv).toEqual([
      ['name', 'role', 'notes'],
      ['Alice, A.', 'Engineer', 'Uses "quotes"'],
      ['Bob', 'Designer', 'Clean'],
    ]);

    const tsvSample = 'col1\tcol2\nalpha\tbeta\n';
    expect(parseCsvRows(tsvSample, '\t')).toEqual([
      ['col1', 'col2'],
      ['alpha', 'beta'],
    ]);
  });

  it('formats byte sizes cleanly across B, KB, and MB ranges', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.00 MB');
  });

  it('toggles collapsible workspace shell states cleanly', () => {
    const store = useWorkspaceStore.getState();

    expect(store.isHeaderCollapsed).toBe(false);
    store.toggleHeader();
    expect(useWorkspaceStore.getState().isHeaderCollapsed).toBe(true);

    expect(store.isSidebarCollapsed).toBe(false);
    store.toggleSidebar();
    expect(useWorkspaceStore.getState().isSidebarCollapsed).toBe(true);

    expect(store.isBlockInspectorCollapsed).toBe(false);
    store.toggleBlockInspector();
    expect(useWorkspaceStore.getState().isBlockInspectorCollapsed).toBe(true);
    store.setBlockInspectorCollapsed(false);
    expect(useWorkspaceStore.getState().isBlockInspectorCollapsed).toBe(false);
  });
});
