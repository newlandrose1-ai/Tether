import type { Block, CodeBlockData, FileBlockData, TextBlockData } from '../types/model';
import { getMimeType } from './zip';

export type MediaCategoryId =
  | 'media-favicon'
  | 'media-icon'
  | 'media-gallery'
  | 'media-ui'
  | 'media-bg'
  | 'media-asset';

export interface MediaRoleMeta {
  id: MediaCategoryId;
  label: string;
  shortLabel: string;
  defaultFolder: string;
  description: string;
}

export const MEDIA_ROLE_OPTIONS: MediaRoleMeta[] = [
  {
    id: 'media-favicon',
    label: 'Favicon',
    shortLabel: 'Favicon',
    defaultFolder: 'public',
    description: 'Browser tab icon (public/favicon.ico or .png / .svg)',
  },
  {
    id: 'media-gallery',
    label: 'Gallery Image',
    shortLabel: 'Gallery',
    defaultFolder: 'assets/images/gallery',
    description: 'Gallery, carousel, or showcase photos (assets/images/gallery/)',
  },
  {
    id: 'media-icon',
    label: 'App / UI Icon',
    shortLabel: 'Icon',
    defaultFolder: 'assets/icons',
    description: 'Logo or UI button icon (assets/icons/)',
  },
  {
    id: 'media-ui',
    label: 'UI Graphic / Sprite',
    shortLabel: 'UI Asset',
    defaultFolder: 'assets/ui',
    description: 'Badges, avatars, cards, or game sprites (assets/ui/)',
  },
  {
    id: 'media-bg',
    label: 'Background Image',
    shortLabel: 'Background',
    defaultFolder: 'assets/backgrounds',
    description: 'Hero banner or scene backdrop (assets/backgrounds/)',
  },
  {
    id: 'media-asset',
    label: 'General Image',
    shortLabel: 'Asset',
    defaultFolder: 'assets/images',
    description: 'General project picture (assets/images/)',
  },
];

export const MEDIA_FOLDER_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'public/', value: 'public' },
  { label: 'assets/images/', value: 'assets/images' },
  { label: 'assets/images/gallery/', value: 'assets/images/gallery' },
  { label: 'assets/icons/', value: 'assets/icons' },
  { label: 'assets/ui/', value: 'assets/ui' },
  { label: 'assets/backgrounds/', value: 'assets/backgrounds' },
  { label: 'images/', value: 'images' },
  { label: 'media/', value: 'media' },
  { label: 'Root (/)', value: '' },
];

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'svg',
]);

export function getFileExtension(name: string): string {
  const leaf = name.replace(/\\/g, '/').split('/').pop() || name;
  const idx = leaf.lastIndexOf('.');
  return idx > 0 ? leaf.slice(idx + 1).toLowerCase() : '';
}

export function isSvgAsset(fileName: string, mimeType?: string): boolean {
  return (
    getFileExtension(fileName) === 'svg' ||
    mimeType?.toLowerCase() === 'image/svg+xml'
  );
}

export function isImageFilenameOrMime(fileName: string, mimeType?: string): boolean {
  if (mimeType && mimeType.toLowerCase().startsWith('image/')) {
    return true;
  }
  const ext = getFileExtension(fileName);
  return IMAGE_EXTENSIONS.has(ext);
}

export function isImageBlock(block: Block): boolean {
  if (block.kind === 'upload') return false;
  const fData = block.kind === 'file' ? (block.data as FileBlockData) : undefined;
  return isImageFilenameOrMime(block.title, fData?.mimeType);
}

export function getImageBlockPreviewSrc(block: Block): string | undefined {
  if (block.kind !== 'file') return undefined;
  const fData = block.data as FileBlockData;
  if (fData?.dataUrl) return fData.dataUrl;
  if (isSvgAsset(block.title, fData?.mimeType) && fData?.content?.trim()) {
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fData.content)}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function sanitizeFolderPath(rawFolder: string): string {
  return rawFolder
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

export function sanitizeLeafFileName(rawName: string, fallback = 'image.png'): string {
  const leaf = rawName.replace(/\\/g, '/').split('/').pop()?.trim() || '';
  return leaf || fallback;
}

export function buildAssetTargetPath(fileName: string, folderPath: string): string {
  const leaf = sanitizeLeafFileName(fileName);
  const folder = sanitizeFolderPath(folderPath);
  return folder ? `${folder}/${leaf}` : leaf;
}

export function inferMediaRoleAndFolder(fileName: string): {
  categoryId: MediaCategoryId;
  folder: string;
} {
  const lower = sanitizeLeafFileName(fileName).toLowerCase();
  const ext = getFileExtension(lower);

  if (ext === 'ico' || lower.includes('favicon')) {
    return { categoryId: 'media-favicon', folder: 'public' };
  }
  if (
    lower.includes('icon') ||
    lower.includes('logo') ||
    lower.includes('symbol') ||
    lower.includes('mark')
  ) {
    return { categoryId: 'media-icon', folder: 'assets/icons' };
  }
  if (
    lower.includes('gallery') ||
    lower.includes('carousel') ||
    lower.includes('slide') ||
    lower.includes('photo') ||
    lower.includes('shot')
  ) {
    return { categoryId: 'media-gallery', folder: 'assets/images/gallery' };
  }
  if (
    lower.includes('bg') ||
    lower.includes('background') ||
    lower.includes('wallpaper') ||
    lower.includes('banner') ||
    lower.includes('backdrop') ||
    lower.includes('hero')
  ) {
    return { categoryId: 'media-bg', folder: 'assets/backgrounds' };
  }
  if (
    lower.includes('ui') ||
    lower.includes('sprite') ||
    lower.includes('badge') ||
    lower.includes('avatar') ||
    lower.includes('button')
  ) {
    return { categoryId: 'media-ui', folder: 'assets/ui' };
  }
  return { categoryId: 'media-asset', folder: 'assets/images' };
}

export function getMediaRoleMeta(categoryId: string | undefined): MediaRoleMeta {
  return (
    MEDIA_ROLE_OPTIONS.find((r) => r.id === categoryId) ||
    MEDIA_ROLE_OPTIONS[MEDIA_ROLE_OPTIONS.length - 1]
  );
}

/**
 * Computes a clean POSIX relative path from a source file path (e.g. `src/pages/about.html`)
 * to a target asset path (e.g. `assets/images/hero.png` -> `../../assets/images/hero.png`).
 */
export function computeRelativeAssetPath(fromFilePath: string, toAssetPath: string): string {
  const cleanFrom = fromFilePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const cleanTo = toAssetPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const fromDir = cleanFrom.includes('/')
    ? cleanFrom.split('/').slice(0, -1).join('/')
    : '';
  const fromParts = fromDir ? fromDir.split('/').filter(Boolean) : [];
  const toParts = cleanTo.split('/').filter(Boolean);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const ups = fromParts.length - common;
  const relParts = [
    ...Array.from({ length: ups }, () => '..'),
    ...toParts.slice(common),
  ];
  const joined = relParts.join('/');
  return joined.startsWith('.') ? joined : `./${joined}`;
}

export function generateStarterSvgAsset(
  role: MediaCategoryId,
  customTitle?: string
): {
  fileName: string;
  mimeType: string;
  content: string;
  size: number;
} {
  const meta = getMediaRoleMeta(role);
  const rawName = sanitizeLeafFileName(
    customTitle ||
      (role === 'media-favicon'
        ? 'favicon.svg'
        : role === 'media-icon'
        ? 'icon.svg'
        : role === 'media-gallery'
        ? 'gallery-1.svg'
        : role === 'media-ui'
        ? 'ui-graphic.svg'
        : role === 'media-bg'
        ? 'background.svg'
        : 'image.svg')
  );
  const fileName = rawName.toLowerCase().endsWith('.svg')
    ? rawName
    : `${rawName.replace(/\.[^.]+$/, '')}.svg`;

  let svg = '';
  if (role === 'media-favicon') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#18181b"/>
  <circle cx="32" cy="32" r="14" fill="#f97316"/>
</svg>
`;
  } else if (role === 'media-icon') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <rect width="48" height="48" rx="10" fill="#27272a"/>
  <path d="M16 24h16M24 16v16" stroke="#f97316" stroke-width="3.5" stroke-linecap="round"/>
</svg>
`;
  } else if (role === 'media-bg') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675">
  <defs>
    <radialGradient id="bg" cx="30%" cy="25%" r="75%">
      <stop offset="0%" stop-color="#f97316" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#090b0e"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" fill="#090b0e"/>
  <rect width="1200" height="675" fill="url(#bg)"/>
</svg>
`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">
  <rect width="640" height="400" rx="16" fill="#14171c"/>
  <circle cx="200" cy="145" r="42" fill="#f97316" opacity="0.9"/>
  <path d="M80 340L240 200l110 90 95-75 115 125z" fill="#3f3f46"/>
  <text x="32" y="46" fill="#e4e4e7" font-family="monospace" font-size="18">${meta.shortLabel}</text>
</svg>
`;
  }

  return {
    fileName,
    mimeType: 'image/svg+xml',
    content: svg,
    size: new TextEncoder().encode(svg).byteLength,
  };
}

export async function readBrowserImageFile(file: File): Promise<{
  fileName: string;
  mimeType: string;
  size: number;
  binary: boolean;
  dataUrl?: string;
  content?: string;
}> {
  const mimeType = file.type || getMimeType(file.name);
  if (isSvgAsset(file.name, mimeType)) {
    const content = await file.text();
    return {
      fileName: file.name,
      mimeType: 'image/svg+xml',
      size: file.size || new TextEncoder().encode(content).byteLength,
      binary: false,
      content,
    };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`));
    reader.readAsDataURL(file);
  });

  return {
    fileName: file.name,
    mimeType,
    size: file.size,
    binary: true,
    dataUrl,
  };
}

function humanizeAltText(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const clean = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || 'Project image';
}

function getFaviconTypeAttr(path: string, mimeType?: string): string {
  const ext = getFileExtension(path);
  if (ext === 'ico') return 'image/x-icon';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return mimeType || 'image/png';
}

function resolveSnippetLanguage(language?: string, path?: string): string {
  const ext = path ? getFileExtension(path) : '';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css' || ext === 'scss') return 'css';
  if (ext === 'jsx') return 'jsx';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'ts') return 'typescript';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'json') return 'json';
  return (language || 'html').toLowerCase();
}

export interface ImageReferenceEntry {
  path: string;
  title: string;
  mimeType?: string;
}

export function generateImageReferenceSnippet(params: {
  targetFilePath: string;
  targetLanguage?: string;
  imageEntries: ImageReferenceEntry[];
  role: MediaCategoryId;
}): string {
  const { targetFilePath, targetLanguage, imageEntries, role } = params;
  if (imageEntries.length === 0) return '';

  const lang = resolveSnippetLanguage(targetLanguage, targetFilePath);
  const relEntries = imageEntries.map((img) => ({
    ...img,
    relPath: computeRelativeAssetPath(targetFilePath, img.path),
    alt: humanizeAltText(img.title),
  }));

  if (lang === 'html') {
    if (role === 'media-favicon') {
      const first = relEntries[0];
      const iconType = getFaviconTypeAttr(first.path, first.mimeType);
      return `<link rel="icon" type="${iconType}" href="${first.relPath}" />`;
    }

    if (role === 'media-bg') {
      const first = relEntries[0];
      return `<div class="hero-background" style="background-image: url('${first.relPath}'); background-size: cover; background-position: center;"></div>`;
    }

    if (role === 'media-gallery' && relEntries.length > 1) {
      const items = relEntries
        .map(
          (item) =>
            `  <figure class="gallery-item">\n    <img src="${item.relPath}" alt="${item.alt}" loading="lazy" />\n  </figure>`
        )
        .join('\n');
      return `<section class="gallery">\n${items}\n</section>`;
    }

    return relEntries
      .map(
        (item) =>
          `<img src="${item.relPath}" alt="${item.alt}"${
            role === 'media-icon' ? ' width="32" height="32"' : ' loading="lazy"'
          } />`
      )
      .join('\n');
  }

  if (lang === 'css') {
    if (relEntries.length === 1) {
      const item = relEntries[0];
      const selector =
        role === 'media-bg' ? '.hero-background' : role === 'media-icon' ? '.icon-asset' : '.media-asset';
      return `${selector} {\n  background-image: url('${item.relPath}');\n  background-size: cover;\n  background-position: center;\n}`;
    }
    return relEntries
      .map(
        (item, idx) =>
          `.gallery-item-${idx + 1} {\n  background-image: url('${item.relPath}');\n  background-size: cover;\n}`
      )
      .join('\n\n');
  }

  if (lang === 'jsx' || lang === 'tsx') {
    if (role === 'media-gallery' && relEntries.length > 1) {
      const imgs = relEntries
        .map(
          (item) =>
            `  <img key="${item.relPath}" src="${item.relPath}" alt="${item.alt}" loading="lazy" />`
        )
        .join('\n');
      return `<div className="gallery">\n${imgs}\n</div>`;
    }
    return relEntries
      .map(
        (item) =>
          `<img src="${item.relPath}" alt="${item.alt}" />`
      )
      .join('\n');
  }

  if (lang === 'javascript' || lang === 'typescript') {
    if (relEntries.length === 1) {
      const varName =
        role === 'media-favicon'
          ? 'FAVICON_PATH'
          : role === 'media-bg'
          ? 'BACKGROUND_IMAGE'
          : 'IMAGE_ASSET_PATH';
      return `export const ${varName} = '${relEntries[0].relPath}';`;
    }
    const items = relEntries
      .map((item) => `  { src: '${item.relPath}', alt: '${item.alt.replace(/'/g, "\\'")}' },`)
      .join('\n');
    return `export const GALLERY_IMAGES = [\n${items}\n];`;
  }

  if (lang === 'markdown') {
    return relEntries.map((item) => `![${item.alt}](${item.relPath})`).join('\n\n');
  }

  if (lang === 'json') {
    return JSON.stringify(
      relEntries.length === 1
        ? { path: relEntries[0].relPath, alt: relEntries[0].alt }
        : { images: relEntries.map((i) => ({ src: i.relPath, alt: i.alt })) },
      null,
      2
    );
  }

  return relEntries.map((item) => item.relPath).join('\n');
}

export function insertImageReferenceIntoCode(params: {
  code: string;
  language?: string;
  targetFilePath: string;
  imageEntries: ImageReferenceEntry[];
  role: MediaCategoryId;
}): { nextCode: string; snippet: string } {
  const { code, language, targetFilePath, imageEntries, role } = params;
  const snippet = generateImageReferenceSnippet({
    targetFilePath,
    targetLanguage: language,
    imageEntries,
    role,
  });
  if (!snippet) {
    return { nextCode: code, snippet: '' };
  }

  const lang = resolveSnippetLanguage(language, targetFilePath);

  if (lang === 'html') {
    if (role === 'media-favicon') {
      const existingIconRegex = /<link\b[^>]*rel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>/i;
      if (existingIconRegex.test(code)) {
        return {
          nextCode: code.replace(existingIconRegex, snippet),
          snippet,
        };
      }
      const headCloseIdx = code.search(/<\/head>/i);
      if (headCloseIdx !== -1) {
        const prefix = code.slice(0, headCloseIdx);
        const suffix = code.slice(headCloseIdx);
        const needsNewline = prefix.length > 0 && !prefix.endsWith('\n');
        return {
          nextCode: `${prefix}${needsNewline ? '\n' : ''}  ${snippet}\n${suffix}`,
          snippet,
        };
      }
      return {
        nextCode: `${snippet}\n${code}`,
        snippet,
      };
    }

    // For HTML gallery / img / bg: insert cleanly before </main> or </body> if present
    const indentedSnippet = snippet
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');

    const bodyCloseIdx = code.search(/<\/body>/i);
    if (bodyCloseIdx !== -1) {
      const prefix = code.slice(0, bodyCloseIdx);
      const suffix = code.slice(bodyCloseIdx);
      const needsNewline = prefix.length > 0 && !prefix.endsWith('\n');
      return {
        nextCode: `${prefix}${needsNewline ? '\n' : ''}${indentedSnippet}\n${suffix}`,
        snippet,
      };
    }
  }

  const trimmedRight = code.replace(/\s+$/, '');
  const nextCode = trimmedRight ? `${trimmedRight}\n\n${snippet}\n` : `${snippet}\n`;
  return { nextCode, snippet };
}

export function getBlockTextAndLanguage(block: Block): {
  content: string;
  language: string;
  path: string;
} {
  const path = (
    block.sourcePath ||
    (block.data as { path?: string } | undefined)?.path ||
    block.title
  ).replace(/^\/+/, '');

  if (block.kind === 'code') {
    const cData = block.data as CodeBlockData;
    return {
      content: cData?.currentContent ?? '',
      language: cData?.language || resolveSnippetLanguage(undefined, path),
      path,
    };
  }
  if (block.kind === 'text') {
    const tData = block.data as TextBlockData;
    return {
      content: tData?.content ?? '',
      language: resolveSnippetLanguage('markdown', path),
      path,
    };
  }
  if (block.kind === 'file') {
    const fData = block.data as FileBlockData;
    return {
      content: fData?.content ?? '',
      language: resolveSnippetLanguage(undefined, path),
      path,
    };
  }
  return { content: '', language: 'text', path };
}

/**
 * Rewrites local relative image/favicon references inside HTML preview srcDoc
 * so added project pictures render live inside UniversalBlockViewer previews
 * without altering the actual source file contents.
 */
export function resolveHtmlPreviewLocalAssets(
  htmlContent: string,
  htmlFilePath: string,
  allBlocks: Block[]
): string {
  if (!htmlContent || allBlocks.length === 0) return htmlContent;

  const assetMap = new Map<string, string>();
  for (const b of allBlocks) {
    if (!isImageBlock(b)) continue;
    const src = getImageBlockPreviewSrc(b);
    if (!src) continue;
    const p = (
      b.sourcePath ||
      (b.data as FileBlockData | undefined)?.path ||
      b.title
    )
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .toLowerCase();
    assetMap.set(p, src);
  }

  if (assetMap.size === 0) return htmlContent;

  const fromNorm = htmlFilePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const fromDir = fromNorm.includes('/')
    ? fromNorm.split('/').slice(0, -1).join('/')
    : '';

  const resolveLocalRef = (ref: string): string | null => {
    const clean = ref.trim();
    if (
      !clean ||
      clean.startsWith('#') ||
      clean.startsWith('http://') ||
      clean.startsWith('https://') ||
      clean.startsWith('data:')
    ) {
      return null;
    }
    const rawJoined = fromDir ? `${fromDir}/${clean}` : clean;
    const segs: string[] = [];
    for (const part of rawJoined.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') segs.pop();
      else segs.push(part);
    }
    const resolved = segs.join('/').toLowerCase();
    return assetMap.get(resolved) || assetMap.get(clean.replace(/^\.?\//, '').toLowerCase()) || null;
  };

  let out = htmlContent.replace(
    /\b(src|href)\s*=\s*(["'])([^"']+)\2/gi,
    (full, attr, quote, ref) => {
      const replacement = resolveLocalRef(ref);
      return replacement ? `${attr}=${quote}${replacement}${quote}` : full;
    }
  );

  out = out.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (full, quote, ref) => {
    const replacement = resolveLocalRef(ref);
    return replacement ? `url(${quote}${replacement}${quote})` : full;
  });

  return out;
}
