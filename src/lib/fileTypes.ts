import type { BlockKind } from '../types/model';

export type FileCategory =
  | 'code'
  | 'markup'
  | 'doc'
  | 'data'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'archive'
  | 'binary';

export type ViewerKind =
  | 'code'
  | 'markdown'
  | 'html'
  | 'csv'
  | 'svg'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'archive'
  | 'binary';

export interface FileTypeInfo {
  extension: string;
  badge: string;
  label: string;
  category: FileCategory;
  viewerKind: ViewerKind;
  hasRenderedPreview: boolean;
  isTextEditable: boolean;
  badgeClass: string;
  accentColorClass: string;
  language?: string;
}

const BADGE_STYLES: Record<FileCategory, { badgeClass: string; accentColorClass: string }> = {
  code: {
    badgeClass: 'bg-sky-500/12 text-sky-300 border-sky-500/35',
    accentColorClass: 'text-sky-400',
  },
  markup: {
    badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/45',
    accentColorClass: 'text-orange-400',
  },
  doc: {
    badgeClass: 'bg-zinc-700/45 text-zinc-200 border-zinc-600/65',
    accentColorClass: 'text-zinc-300',
  },
  data: {
    badgeClass: 'bg-amber-500/12 text-amber-300 border-amber-500/35',
    accentColorClass: 'text-amber-400',
  },
  image: {
    badgeClass: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/35',
    accentColorClass: 'text-emerald-400',
  },
  pdf: {
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    accentColorClass: 'text-rose-400',
  },
  audio: {
    badgeClass: 'bg-violet-500/14 text-violet-300 border-violet-500/35',
    accentColorClass: 'text-violet-400',
  },
  video: {
    badgeClass: 'bg-pink-500/14 text-pink-300 border-pink-500/35',
    accentColorClass: 'text-pink-400',
  },
  archive: {
    badgeClass: 'bg-orange-500/16 text-orange-200 border-orange-500/45',
    accentColorClass: 'text-orange-400',
  },
  binary: {
    badgeClass: 'bg-zinc-800/80 text-zinc-300 border-zinc-600/60',
    accentColorClass: 'text-zinc-400',
  },
};

export function getExtension(fileName: string): string {
  const clean = fileName.trim().split('?')[0].split('#')[0];
  const base = clean.split('/').pop() || clean;
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

export function getFileTypeInfo(options: {
  title: string;
  kind: BlockKind;
  mimeType?: string;
  binary?: boolean;
  isPdf?: boolean;
  language?: string;
}): FileTypeInfo {
  const { title, kind, mimeType = '', binary = false, isPdf = false, language } = options;
  const ext = getExtension(title);
  const mime = mimeType.toLowerCase();

  const build = (
    badge: string,
    label: string,
    category: FileCategory,
    viewerKind: ViewerKind,
    opts?: { hasRenderedPreview?: boolean; isTextEditable?: boolean; lang?: string }
  ): FileTypeInfo => {
    const styles = BADGE_STYLES[category];
    return {
      extension: ext,
      badge,
      label,
      category,
      viewerKind,
      hasRenderedPreview:
        opts?.hasRenderedPreview ??
        viewerKind !== 'code',
      isTextEditable: opts?.isTextEditable ?? true,
      badgeClass: styles.badgeClass,
      accentColorClass: styles.accentColorClass,
      language: opts?.lang ?? language,
    };
  };

  if (kind === 'upload' || ext === 'zip' || mime === 'application/zip') {
    return build('ZIP', 'ZIP Archive', 'archive', 'archive', {
      hasRenderedPreview: true,
      isTextEditable: false,
    });
  }

  if (isPdf || ext === 'pdf' || mime === 'application/pdf') {
    return build('PDF', 'PDF Document', 'pdf', 'pdf', {
      hasRenderedPreview: true,
      isTextEditable: false,
    });
  }

  if (ext === 'svg' || mime === 'image/svg+xml') {
    return build('SVG', 'SVG Vector', 'image', 'svg', {
      hasRenderedPreview: true,
      isTextEditable: !binary,
      lang: 'html',
    });
  }

  if (
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'].includes(ext) ||
    mime.startsWith('image/')
  ) {
    const badge = ext ? ext.toUpperCase().slice(0, 4) : 'IMG';
    return build(badge, `${badge} Image`, 'image', 'image', {
      hasRenderedPreview: true,
      isTextEditable: false,
    });
  }

  if (
    ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext) ||
    mime.startsWith('audio/')
  ) {
    const badge = ext ? ext.toUpperCase().slice(0, 4) : 'AUD';
    return build(badge, `${badge} Audio`, 'audio', 'audio', {
      hasRenderedPreview: true,
      isTextEditable: false,
    });
  }

  if (
    ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext) ||
    mime.startsWith('video/')
  ) {
    const badge = ext ? ext.toUpperCase().slice(0, 4) : 'VID';
    return build(badge, `${badge} Video`, 'video', 'video', {
      hasRenderedPreview: true,
      isTextEditable: false,
    });
  }

  if (binary) {
    const badge = ext ? ext.toUpperCase().slice(0, 4) : 'BIN';
    return build(badge, 'Binary File', 'binary', 'binary', {
      hasRenderedPreview: true,
      isTextEditable: false,
    });
  }

  if (ext === 'html' || ext === 'htm' || mime === 'text/html' || language === 'html') {
    return build('HTML', 'HTML Page', 'markup', 'html', {
      hasRenderedPreview: true,
      isTextEditable: true,
      lang: 'html',
    });
  }

  if (ext === 'md' || ext === 'markdown' || mime === 'text/markdown' || language === 'markdown') {
    return build('MD', 'Markdown Doc', 'doc', 'markdown', {
      hasRenderedPreview: true,
      isTextEditable: true,
      lang: 'markdown',
    });
  }

  if (ext === 'csv' || ext === 'tsv' || mime === 'text/csv') {
    const badge = ext === 'tsv' ? 'TSV' : 'CSV';
    return build(badge, `${badge} Table`, 'data', 'csv', {
      hasRenderedPreview: true,
      isTextEditable: true,
      lang: 'text',
    });
  }

  if (ext === 'json' || mime === 'application/json' || language === 'json') {
    return build('JSON', 'JSON Data', 'data', 'code', {
      hasRenderedPreview: false,
      isTextEditable: true,
      lang: 'json',
    });
  }

  if (ext === 'css' || ext === 'scss' || mime === 'text/css' || language === 'css') {
    const badge = ext === 'scss' ? 'SCSS' : 'CSS';
    return build(badge, `${badge} Stylesheet`, 'markup', 'code', {
      hasRenderedPreview: false,
      isTextEditable: true,
      lang: 'css',
    });
  }

  if (ext === 'tsx') {
    return build('TSX', 'TypeScript JSX', 'code', 'code', {
      hasRenderedPreview: false,
      isTextEditable: true,
      lang: 'typescript',
    });
  }

  if (ext === 'ts' || language === 'typescript') {
    return build('TS', 'TypeScript', 'code', 'code', {
      hasRenderedPreview: false,
      isTextEditable: true,
      lang: 'typescript',
    });
  }

  if (ext === 'jsx') {
    return build('JSX', 'JavaScript JSX', 'code', 'code', {
      hasRenderedPreview: false,
      isTextEditable: true,
      lang: 'javascript',
    });
  }

  if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || language === 'javascript') {
    return build(ext === 'mjs' || ext === 'cjs' ? ext.toUpperCase() : 'JS', 'JavaScript', 'code', 'code', {
      hasRenderedPreview: false,
      isTextEditable: true,
      lang: 'javascript',
    });
  }

  if (['yml', 'yaml', 'toml', 'ini', 'env', 'xml'].includes(ext)) {
    const badge = ext.toUpperCase().slice(0, 4);
    return build(badge, `${badge} Config`, 'data', 'code', {
      hasRenderedPreview: false,
      isTextEditable: true,
      lang: ext === 'xml' ? 'html' : 'text',
    });
  }

  if (['py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sh', 'sql', 'php', 'swift', 'kt', 'vue', 'svelte'].includes(ext)) {
    const badge = ext.toUpperCase().slice(0, 4);
    return build(badge, `${badge} Source`, 'code', 'code', {
      hasRenderedPreview: false,
      isTextEditable: true,
      lang: ext,
    });
  }

  if (kind === 'text') {
    return build(ext ? ext.toUpperCase().slice(0, 4) : 'NOTE', 'Text Note', 'doc', 'markdown', {
      hasRenderedPreview: true,
      isTextEditable: true,
      lang: 'markdown',
    });
  }

  if (kind === 'code') {
    const badge = ext ? ext.toUpperCase().slice(0, 4) : (language ? language.toUpperCase().slice(0, 4) : 'CODE');
    return build(badge, `${badge} Code`, 'code', 'code', {
      hasRenderedPreview: false,
      isTextEditable: true,
      lang: language || 'javascript',
    });
  }

  const fallbackBadge = ext ? ext.toUpperCase().slice(0, 4) : 'TXT';
  return build(fallbackBadge, 'Text File', 'doc', 'code', {
    hasRenderedPreview: false,
    isTextEditable: true,
    lang: 'text',
  });
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function parseCsvRows(raw: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
