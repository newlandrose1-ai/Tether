import type {
  Block,
  BlockData,
  BlockKind,
  CodeBlockData,
  FileBlockData,
  TextBlockData,
} from '../types/model';
import { getMimeType } from './zip';

export type ProjectCategoryGroup = 'docs' | 'deps' | 'entry' | 'folders' | 'media';

export interface ProjectCategoryDefinition {
  id: string;
  label: string;
  group: ProjectCategoryGroup;
  isFolderCategory: boolean;
  /** Folder prefix for folder categories (e.g., 'src', 'assets', 'config', 'dist') */
  folderPrefix?: string;
  /** Default filename when creating a new block or converting an unnamed placeholder */
  defaultFileName: string;
  /** Default full path when placed at project root */
  defaultPath: string;
  preferredKind: 'code' | 'file';
  language: string;
  mimeType: string;
  description: string;
  template: string;
}

export const PROJECT_CATEGORY_GROUP_LABELS: Record<ProjectCategoryGroup, string> = {
  docs: 'Docs & Legal',
  deps: 'Dependencies & Ignore',
  entry: 'Entry Points',
  folders: 'Project Folders',
  media: 'Media & Images',
};

export const PROJECT_CATEGORIES: ProjectCategoryDefinition[] = [
  // Docs & Legal
  {
    id: 'readme-md',
    label: 'README.md',
    group: 'docs',
    isFolderCategory: false,
    defaultFileName: 'README.md',
    defaultPath: 'README.md',
    preferredKind: 'code',
    language: 'markdown',
    mimeType: 'text/markdown',
    description: 'Project documentation and setup guide',
    template: `# Project Name

Overview of the application or game project.

## Structure

- \`src/\` — Source code and modules
- \`assets/\` — Sprites, audio, shaders, and media
- \`config/\` — Runtime and build configuration

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`
`,
  },
  {
    id: 'readme-txt',
    label: 'README.txt',
    group: 'docs',
    isFolderCategory: false,
    defaultFileName: 'README.txt',
    defaultPath: 'README.txt',
    preferredKind: 'code',
    language: 'text',
    mimeType: 'text/plain',
    description: 'Plain-text README overview',
    template: `PROJECT README
==============

Overview:
  Describe what this project does and how to run it.

Quick Start:
  1. Install dependencies
  2. Configure settings in config/
  3. Run the main entry point
`,
  },
  {
    id: 'license',
    label: 'LICENSE',
    group: 'docs',
    isFolderCategory: false,
    defaultFileName: 'LICENSE',
    defaultPath: 'LICENSE',
    preferredKind: 'code',
    language: 'text',
    mimeType: 'text/plain',
    description: 'Standard MIT open-source license',
    template: `MIT License

Copyright (c) ${new Date().getFullYear()} Project Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
  {
    id: 'license-md',
    label: 'LICENSE.md',
    group: 'docs',
    isFolderCategory: false,
    defaultFileName: 'LICENSE.md',
    defaultPath: 'LICENSE.md',
    preferredKind: 'code',
    language: 'markdown',
    mimeType: 'text/markdown',
    description: 'Markdown-formatted MIT license',
    template: `# MIT License

Copyright (c) ${new Date().getFullYear()} Project Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
`,
  },

  // Dependencies & Ignore
  {
    id: 'package-json',
    label: 'package.json',
    group: 'deps',
    isFolderCategory: false,
    defaultFileName: 'package.json',
    defaultPath: 'package.json',
    preferredKind: 'code',
    language: 'json',
    mimeType: 'application/json',
    description: 'Node / Web JavaScript project manifest',
    template: `{
  "name": "tether-project",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node main.js",
    "build": "node scripts/build.js"
  },
  "dependencies": {}
}
`,
  },
  {
    id: 'cargo-toml',
    label: 'Cargo.toml',
    group: 'deps',
    isFolderCategory: false,
    defaultFileName: 'Cargo.toml',
    defaultPath: 'Cargo.toml',
    preferredKind: 'code',
    language: 'toml',
    mimeType: 'text/plain',
    description: 'Rust / Cargo package manifest',
    template: `[package]
name = "tether_project"
version = "0.1.0"
edition = "2021"

[dependencies]
`,
  },
  {
    id: 'requirements-txt',
    label: 'requirements.txt',
    group: 'deps',
    isFolderCategory: false,
    defaultFileName: 'requirements.txt',
    defaultPath: 'requirements.txt',
    preferredKind: 'code',
    language: 'text',
    mimeType: 'text/plain',
    description: 'Python pip dependencies',
    template: `# Python dependencies
# Add packages below, one per line
requests>=2.31.0
`,
  },
  {
    id: 'gitignore',
    label: '.gitignore',
    group: 'deps',
    isFolderCategory: false,
    defaultFileName: '.gitignore',
    defaultPath: '.gitignore',
    preferredKind: 'code',
    language: 'text',
    mimeType: 'text/plain',
    description: 'Git ignore patterns for build & local files',
    template: `# Dependencies
node_modules/
.venv/
__pycache__/
target/

# Build outputs
build/
dist/
out/

# Environment & OS files
.env
.env.local
.DS_Store
Thumbs.db
`,
  },

  // Entry Points
  {
    id: 'index-html',
    label: 'index.html',
    group: 'entry',
    isFolderCategory: false,
    defaultFileName: 'index.html',
    defaultPath: 'index.html',
    preferredKind: 'code',
    language: 'html',
    mimeType: 'text/html',
    description: 'Web app or HTML5 game entry page',
    template: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Project Entry</title>
</head>
<body>
  <main id="app">
    <h1>Project Ready</h1>
  </main>
  <script type="module" src="./main.js"></script>
</body>
</html>
`,
  },
  {
    id: 'main-js',
    label: 'main.js',
    group: 'entry',
    isFolderCategory: false,
    defaultFileName: 'main.js',
    defaultPath: 'main.js',
    preferredKind: 'code',
    language: 'javascript',
    mimeType: 'text/javascript',
    description: 'JavaScript application entry point',
    template: `export function main() {
  console.log('Application started');
}

main();
`,
  },
  {
    id: 'main-ts',
    label: 'src/main.ts',
    group: 'entry',
    isFolderCategory: false,
    defaultFileName: 'main.ts',
    defaultPath: 'src/main.ts',
    preferredKind: 'code',
    language: 'typescript',
    mimeType: 'text/typescript',
    description: 'TypeScript source entry point',
    template: `export function main(): void {
  console.log('TypeScript entry ready');
}

main();
`,
  },
  {
    id: 'main-py',
    label: 'main.py',
    group: 'entry',
    isFolderCategory: false,
    defaultFileName: 'main.py',
    defaultPath: 'main.py',
    preferredKind: 'code',
    language: 'python',
    mimeType: 'text/x-python',
    description: 'Python application or game entry point',
    template: `def main() -> None:
    print("Application started")


if __name__ == "__main__":
    main()
`,
  },

  // Standard Folders
  {
    id: 'folder-src',
    label: 'src/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'src',
    defaultFileName: 'index.js',
    defaultPath: 'src/index.js',
    preferredKind: 'code',
    language: 'javascript',
    mimeType: 'text/javascript',
    description: 'Primary source code directory',
    template: `export function initSource() {
  return { ready: true };
}
`,
  },
  {
    id: 'folder-scripts',
    label: 'scripts/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'scripts',
    defaultFileName: 'game.js',
    defaultPath: 'scripts/game.js',
    preferredKind: 'code',
    language: 'javascript',
    mimeType: 'text/javascript',
    description: 'Gameplay or automation scripts folder',
    template: `export function update(deltaTime) {
  return deltaTime;
}
`,
  },
  {
    id: 'folder-source',
    label: 'source/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'source',
    defaultFileName: 'main.ts',
    defaultPath: 'source/main.ts',
    preferredKind: 'code',
    language: 'typescript',
    mimeType: 'text/typescript',
    description: 'Source files directory',
    template: `export const SOURCE_READY = true;
`,
  },
  {
    id: 'folder-assets',
    label: 'assets/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'assets',
    defaultFileName: 'manifest.json',
    defaultPath: 'assets/manifest.json',
    preferredKind: 'code',
    language: 'json',
    mimeType: 'application/json',
    description: 'Game or app assets directory',
    template: `{
  "sprites": [],
  "audio": [],
  "fonts": []
}
`,
  },
  {
    id: 'folder-resources',
    label: 'resources/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'resources',
    defaultFileName: 'resources.json',
    defaultPath: 'resources/resources.json',
    preferredKind: 'code',
    language: 'json',
    mimeType: 'application/json',
    description: 'Static resources directory',
    template: `{
  "resources": []
}
`,
  },
  {
    id: 'folder-media',
    label: 'media/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'media',
    defaultFileName: '.gitkeep',
    defaultPath: 'media/.gitkeep',
    preferredKind: 'file',
    language: 'text',
    mimeType: 'text/plain',
    description: 'Media images, audio, and video directory',
    template: '',
  },
  {
    id: 'folder-config',
    label: 'config/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'config',
    defaultFileName: 'settings.json',
    defaultPath: 'config/settings.json',
    preferredKind: 'code',
    language: 'json',
    mimeType: 'application/json',
    description: 'Project configuration directory',
    template: `{
  "environment": "development",
  "debug": true
}
`,
  },
  {
    id: 'folder-settings',
    label: 'settings/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'settings',
    defaultFileName: 'app.json',
    defaultPath: 'settings/app.json',
    preferredKind: 'code',
    language: 'json',
    mimeType: 'application/json',
    description: 'Application or game settings directory',
    template: `{
  "title": "Project Settings",
  "version": "1.0.0"
}
`,
  },
  {
    id: 'folder-build',
    label: 'build/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'build',
    defaultFileName: '.gitkeep',
    defaultPath: 'build/.gitkeep',
    preferredKind: 'file',
    language: 'text',
    mimeType: 'text/plain',
    description: 'Compiled build output directory',
    template: '',
  },
  {
    id: 'folder-dist',
    label: 'dist/',
    group: 'folders',
    isFolderCategory: true,
    folderPrefix: 'dist',
    defaultFileName: '.gitkeep',
    defaultPath: 'dist/.gitkeep',
    preferredKind: 'file',
    language: 'text',
    mimeType: 'text/plain',
    description: 'Distribution output directory',
    template: '',
  },

  // Media & Images
  {
    id: 'media-favicon',
    label: 'Favicon (public/)',
    group: 'media',
    isFolderCategory: true,
    folderPrefix: 'public',
    defaultFileName: 'favicon.svg',
    defaultPath: 'public/favicon.svg',
    preferredKind: 'file',
    language: 'svg',
    mimeType: 'image/svg+xml',
    description: 'Browser tab favicon placed in public/ (supports .ico, .png, .svg)',
    template: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#18181b"/>
  <circle cx="32" cy="32" r="14" fill="#f97316"/>
</svg>
`,
  },
  {
    id: 'media-icon',
    label: 'App / UI Icon',
    group: 'media',
    isFolderCategory: true,
    folderPrefix: 'assets/icons',
    defaultFileName: 'icon.svg',
    defaultPath: 'assets/icons/icon.svg',
    preferredKind: 'file',
    language: 'svg',
    mimeType: 'image/svg+xml',
    description: 'UI or brand icon placed in assets/icons/',
    template: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <rect width="48" height="48" rx="10" fill="#27272a"/>
  <path d="M16 24h16M24 16v16" stroke="#f97316" stroke-width="3.5" stroke-linecap="round"/>
</svg>
`,
  },
  {
    id: 'media-gallery',
    label: 'Gallery Image',
    group: 'media',
    isFolderCategory: true,
    folderPrefix: 'assets/images/gallery',
    defaultFileName: 'gallery-1.svg',
    defaultPath: 'assets/images/gallery/gallery-1.svg',
    preferredKind: 'file',
    language: 'svg',
    mimeType: 'image/svg+xml',
    description: 'Gallery or carousel picture placed in assets/images/gallery/',
    template: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#27272a"/>
    </linearGradient>
  </defs>
  <rect width="640" height="400" fill="url(#g)"/>
  <circle cx="200" cy="150" r="46" fill="#f97316" opacity="0.85"/>
  <path d="M80 340L240 200l110 90 95-75 115 125z" fill="#3f3f46"/>
</svg>
`,
  },
  {
    id: 'media-ui',
    label: 'UI Graphic / Sprite',
    group: 'media',
    isFolderCategory: true,
    folderPrefix: 'assets/ui',
    defaultFileName: 'ui-graphic.svg',
    defaultPath: 'assets/ui/ui-graphic.svg',
    preferredKind: 'file',
    language: 'svg',
    mimeType: 'image/svg+xml',
    description: 'UI illustration, badge, or game sprite placed in assets/ui/',
    template: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <rect x="10" y="10" width="100" height="100" rx="20" fill="#18181b" stroke="#f97316" stroke-width="4"/>
  <circle cx="60" cy="60" r="22" fill="#f97316"/>
</svg>
`,
  },
  {
    id: 'media-bg',
    label: 'Background Image',
    group: 'media',
    isFolderCategory: true,
    folderPrefix: 'assets/backgrounds',
    defaultFileName: 'background.svg',
    defaultPath: 'assets/backgrounds/background.svg',
    preferredKind: 'file',
    language: 'svg',
    mimeType: 'image/svg+xml',
    description: 'Hero or scene background placed in assets/backgrounds/',
    template: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675">
  <defs>
    <radialGradient id="bg" cx="30%" cy="25%" r="75%">
      <stop offset="0%" stop-color="#f97316" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#090b0e"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" fill="#090b0e"/>
  <rect width="1200" height="675" fill="url(#bg)"/>
</svg>
`,
  },
  {
    id: 'media-asset',
    label: 'Project Image (assets/images/)',
    group: 'media',
    isFolderCategory: true,
    folderPrefix: 'assets/images',
    defaultFileName: 'image.svg',
    defaultPath: 'assets/images/image.svg',
    preferredKind: 'file',
    language: 'svg',
    mimeType: 'image/svg+xml',
    description: 'General project image asset placed in assets/images/',
    template: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <rect width="400" height="300" fill="#14171c"/>
  <rect x="40" y="40" width="320" height="220" rx="16" fill="#1e222a" stroke="#3f3f46"/>
  <circle cx="135" cy="115" r="24" fill="#f97316"/>
  <path d="M70 230l85-70 65 50 50-38 60 58z" fill="#52525b"/>
</svg>
`,
  },
];

export function getProjectCategoryById(
  categoryId: string | undefined
): ProjectCategoryDefinition | undefined {
  if (!categoryId) return undefined;
  return PROJECT_CATEGORIES.find((c) => c.id === categoryId);
}

function isPlaceholderTitle(title: string): boolean {
  const clean = title.trim();
  return (
    !clean ||
    /^Note \d+$/i.test(clean) ||
    /^script-\d+\.js$/i.test(clean) ||
    /^Untitled/i.test(clean)
  );
}

export function extractBlockTextContent(block: Block): string {
  if (block.kind === 'code') {
    return (block.data as CodeBlockData)?.currentContent ?? '';
  }
  if (block.kind === 'text') {
    return (block.data as TextBlockData)?.content ?? '';
  }
  if (block.kind === 'file') {
    return (block.data as FileBlockData)?.content ?? '';
  }
  return '';
}

function inferLanguageFromFilename(fileName: string, fallback: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return 'javascript';
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.txt') || lower.startsWith('.')) return 'text';
  return fallback;
}

export interface CategoryApplicationPatch {
  kind: BlockKind;
  title: string;
  sourcePath: string;
  originalSourcePath: string;
  projectCategory: string;
  data: BlockData;
}

/**
 * Computes the updated title, folder path, kind, and content template (if empty or forced)
 * when a block is converted to a standard project file or folder category.
 */
export function buildCategoryApplicationPatch(
  block: Block,
  categoryId: string,
  options?: { applyTemplateIfNonEmpty?: boolean }
): CategoryApplicationPatch | null {
  const category = getProjectCategoryById(categoryId);
  if (!category || block.kind === 'upload') return null;

  const existingContent = extractBlockTextContent(block);
  const isBinaryFile =
    block.kind === 'file' && Boolean((block.data as FileBlockData)?.binary);
  const hasContent = existingContent.trim().length > 0;

  let nextTitle = category.defaultFileName;
  let nextPath = category.defaultPath;

  const hasImageExt = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i.test(block.title);

  if (category.isFolderCategory && category.folderPrefix) {
    const keepCurrentName =
      !isPlaceholderTitle(block.title) &&
      (hasContent || isBinaryFile || (category.group === 'media' && hasImageExt));
    const leaf = keepCurrentName
      ? block.title.replace(/^\/+/, '').split('/').pop() || category.defaultFileName
      : category.defaultFileName;
    nextTitle = leaf;
    nextPath = `${category.folderPrefix}/${leaf}`;
  }

  const shouldFillTemplate =
    !isBinaryFile && (!hasContent || Boolean(options?.applyTemplateIfNonEmpty));
  const nextContent = shouldFillTemplate ? category.template : existingContent;
  const nextLanguage = category.isFolderCategory
    ? inferLanguageFromFilename(nextTitle, category.language)
    : category.language;
  const nextMime = category.isFolderCategory ? getMimeType(nextTitle) : category.mimeType;

  if (block.kind === 'file') {
    const prevFile = block.data as FileBlockData;
    const nextData: FileBlockData = {
      ...prevFile,
      path: nextPath,
      mimeType: isBinaryFile ? prevFile.mimeType : nextMime,
      size: isBinaryFile
        ? prevFile.size
        : new TextEncoder().encode(nextContent).byteLength,
      content: isBinaryFile ? prevFile.content : nextContent,
    };
    return {
      kind: 'file',
      title: nextTitle,
      sourcePath: nextPath,
      originalSourcePath: nextPath,
      projectCategory: category.id,
      data: nextData,
    };
  }

  if (category.preferredKind === 'file' && block.kind !== 'code') {
    const nextData: FileBlockData = {
      path: nextPath,
      mimeType: nextMime,
      size: new TextEncoder().encode(nextContent).byteLength,
      binary: false,
      content: nextContent,
    };
    return {
      kind: 'file',
      title: nextTitle,
      sourcePath: nextPath,
      originalSourcePath: nextPath,
      projectCategory: category.id,
      data: nextData,
    };
  }

  const prevRevisions =
    block.kind === 'code' ? (block.data as CodeBlockData)?.revisions ?? [] : [];
  const nextData: CodeBlockData = {
    path: nextPath,
    language: nextLanguage,
    currentContent: nextContent,
    revisions: prevRevisions,
  };

  return {
    kind: 'code',
    title: nextTitle,
    sourcePath: nextPath,
    originalSourcePath: nextPath,
    projectCategory: category.id,
    data: nextData,
  };
}
