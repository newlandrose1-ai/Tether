import JSZip from 'jszip';

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'css',
  'scss',
  'html',
  'htm',
  'svg',
  'csv',
  'tsv',
  'yml',
  'yaml',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'sh',
  'sql',
  'env',
  'xml',
  'toml',
  'ini',
  'log',
  'vue',
  'svelte',
  'php',
  'swift',
  'kt',
  'conf',
]);

const MIME_MAP: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  js: 'text/javascript',
  jsx: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  css: 'text/css',
  scss: 'text/x-scss',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  py: 'text/x-python',
  rb: 'text/x-ruby',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c-header',
  sh: 'application/x-sh',
  sql: 'application/sql',
  xml: 'application/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

const MAX_INLINE_DATAURL_BYTES = 12 * 1024 * 1024; // 12 MB safety cap for IndexedDB inline previews

export interface ExtractedZipEntry {
  path: string;
  name: string;
  parentFolderPath: string;
  mimeType: string;
  size: number;
  binary: boolean;
  content?: string;
  dataUrl?: string;
  isPdf?: boolean;
}

export function isTextFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext) return false;
  return TEXT_EXTENSIONS.has(ext);
}

export function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext && MIME_MAP[ext]) {
    return MIME_MAP[ext];
  }
  return isTextFile(fileName) ? 'text/plain' : 'application/octet-stream';
}

export async function extractZipArchive(file: File): Promise<ExtractedZipEntry[]> {
  const zip = await JSZip.loadAsync(file);
  const results: ExtractedZipEntry[] = [];

  const entries = Object.keys(zip.files);

  for (const relativePath of entries) {
    const entry = zip.files[relativePath];

    // Skip directories and macOS resource fork metadata
    if (entry.dir) continue;
    if (relativePath.startsWith('__MACOSX/') || relativePath.includes('/.DS_Store') || relativePath === '.DS_Store') {
      continue;
    }

    const pathParts = relativePath.split('/');
    const name = pathParts[pathParts.length - 1] || relativePath;
    const parentFolderPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';

    const isText = isTextFile(name);
    const mimeType = getMimeType(name);
    const isPdf = mimeType === 'application/pdf';

    if (isText) {
      try {
        const textContent = await entry.async('string');
        const size = new Blob([textContent]).size;
        results.push({
          path: relativePath,
          name,
          parentFolderPath,
          mimeType,
          size,
          binary: false,
          content: textContent,
        });
      } catch {
        const uint8 = await entry.async('uint8array');
        let dataUrl: string | undefined;
        if (uint8.byteLength <= MAX_INLINE_DATAURL_BYTES) {
          const base64 = await entry.async('base64');
          dataUrl = `data:${mimeType};base64,${base64}`;
        }
        results.push({
          path: relativePath,
          name,
          parentFolderPath,
          mimeType,
          size: uint8.byteLength,
          binary: true,
          isPdf,
          dataUrl,
        });
      }
    } else {
      const uint8 = await entry.async('uint8array');
      let dataUrl: string | undefined;
      if (uint8.byteLength <= MAX_INLINE_DATAURL_BYTES) {
        const base64 = await entry.async('base64');
        dataUrl = `data:${mimeType};base64,${base64}`;
      }
      results.push({
        path: relativePath,
        name,
        parentFolderPath,
        mimeType,
        size: uint8.byteLength,
        binary: true,
        isPdf,
        dataUrl,
      });
    }
  }

  return results;
}
