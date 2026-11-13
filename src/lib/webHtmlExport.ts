import JSZip from 'jszip';
import type { Project, Block, CodeBlockData, FileBlockData, TextBlockData, Tether } from '../types/model';

export interface WebExportFileItem {
  id: string;
  name: string;
  path: string;
  kind: 'code' | 'text' | 'file';
  language: string;
  content: string;
  size: number;
  lineCount: number;
  lastModified?: number;
}

export function extractProjectExportFiles(project: Project, blocks: Block[]): WebExportFileItem[] {
  const projectBlocks = blocks.filter((b) => b.projectId === project.id && b.kind !== 'upload');

  return projectBlocks.map((b) => {
    let content = '';
    let language = 'text';
    let path = b.title;

    if (b.kind === 'code') {
      const data = b.data as CodeBlockData;
      content = data?.currentContent || '';
      language = data?.language || 'typescript';
      path = data?.path || b.title;
    } else if (b.kind === 'text') {
      const data = b.data as TextBlockData;
      content = data?.content || '';
      language = 'markdown';
      path = b.title.endsWith('.md') || b.title.endsWith('.txt') ? b.title : `${b.title}.md`;
    } else if (b.kind === 'file') {
      const data = b.data as FileBlockData;
      content = data?.content || '';
      path = data?.path || b.title;
      const ext = path.split('.').pop()?.toLowerCase();
      if (ext === 'json') language = 'json';
      else if (ext === 'ts' || ext === 'tsx') language = 'typescript';
      else if (ext === 'js' || ext === 'jsx') language = 'javascript';
      else if (ext === 'html') language = 'html';
      else if (ext === 'css') language = 'css';
      else if (ext === 'md') language = 'markdown';
      else language = 'text';
    }

    path = path.replace(/^\/+/, '');
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    const lineCount = content ? content.split('\n').length : 0;
    const size = new Blob([content]).size;

    return {
      id: b.id,
      name,
      path,
      kind: b.kind as 'code' | 'text' | 'file',
      language,
      content,
      size,
      lineCount,
      lastModified: b.updatedAt || b.createdAt,
    };
  });
}

/**
 * Generates a completely self-contained standalone HTML application that can be opened in any browser
 * offline, containing interactive folder tree navigation, code viewing, syntax styling, search, and copy.
 */
export function generateStandaloneWebHtml(
  project: Project,
  files: WebExportFileItem[],
  tethers: Tether[] = []
): string {
  const safeProjectName = project.name.replace(/[<>&"]/g, '');
  const encodedFilesJson = JSON.stringify(files)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  const totalLines = files.reduce((acc, f) => acc + f.lineCount, 0);
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeProjectName} - Web Code Explorer</title>
  <style>
    :root {
      --bg: #0B0D0E;
      --surface: #101216;
      --surface-hover: #161920;
      --border: #22262B;
      --border-subtle: #1C2025;
      --text-main: #E2E8F0;
      --text-muted: #94A3B8;
      --accent-sky: #38BDF8;
      --accent-emerald: #34D399;
      --accent-amber: #FBBF24;
      --active-line: rgba(56, 189, 248, 0.08);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 13px;
    }
    header {
      height: 48px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      flex-shrink: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 700;
      letter-spacing: 0.05em;
    }
    .brand-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent-sky);
    }
    .project-title {
      color: var(--text-muted);
      font-weight: 400;
      font-size: 12px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn {
      background: #181B20;
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    .btn:hover {
      background: #20242B;
      border-color: #38BDF8;
      color: #FFF;
    }
    .btn-primary {
      background: #0284C7;
      border-color: #38BDF8;
      color: #FFF;
      font-weight: 600;
    }
    .btn-primary:hover {
      background: #0369A1;
    }
    .main-layout {
      flex: 1;
      display: flex;
      min-height: 0;
      overflow: hidden;
    }
    /* Explorer Sidebar */
    .sidebar {
      width: 280px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .sidebar-search {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    .search-input {
      width: 100%;
      background: #090A0D;
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--accent-sky);
    }
    .tree-container {
      flex: 1;
      overflow-y: auto;
      padding: 8px 6px;
    }
    .tree-folder-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      color: #CBD5E1;
      font-family: ui-monospace, monospace;
      font-size: 12px;
      user-select: none;
    }
    .tree-folder-header:hover {
      background: var(--surface-hover);
    }
    .tree-folder-content {
      padding-left: 14px;
      border-left: 1px solid #1C2025;
      margin-left: 8px;
    }
    .tree-file-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 8px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--text-muted);
      font-family: ui-monospace, monospace;
      font-size: 12px;
      user-select: none;
    }
    .tree-file-item:hover {
      background: var(--surface-hover);
      color: var(--text-main);
    }
    .tree-file-item.active {
      background: rgba(56, 189, 248, 0.12);
      color: #38BDF8;
      font-weight: 600;
    }
    .file-badge {
      font-size: 10px;
      color: #64748B;
    }
    .chevron {
      display: inline-block;
      width: 12px;
      font-size: 10px;
      text-align: center;
      transition: transform 0.15s ease;
    }
    .chevron.open {
      transform: rotate(90deg);
    }
    /* Editor Area */
    .editor-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      background: var(--bg);
      overflow: hidden;
    }
    .editor-topbar {
      height: 40px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-family: ui-monospace, monospace;
      font-size: 12px;
    }
    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .breadcrumb .current {
      color: var(--text-main);
      font-weight: 600;
    }
    .code-container {
      flex: 1;
      overflow: auto;
      padding: 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    .code-table {
      width: 100%;
      border-collapse: collapse;
    }
    .code-table td {
      vertical-align: top;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .line-number {
      width: 44px;
      text-align: right;
      padding-right: 16px;
      color: #475569;
      user-select: none;
      font-size: 12px;
    }
    .line-text {
      color: #E2E8F0;
    }
    /* Syntax Highlights */
    .kw { color: #F43F5E; font-weight: 600; }
    .fn { color: #38BDF8; }
    .str { color: #34D399; }
    .num { color: #FBBF24; }
    .comm { color: #64748B; font-style: italic; }
    .typ { color: #A78BFA; }
    /* Empty State */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      gap: 12px;
      font-family: ui-monospace, monospace;
    }
    /* Footer */
    footer {
      height: 28px;
      background: var(--surface);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-size: 11px;
      color: #64748B;
      font-family: ui-monospace, monospace;
    }
    @media (max-width: 768px) {
      .sidebar { width: 100%; height: 240px; border-right: none; border-bottom: 1px solid var(--border); }
      .main-layout { flex-direction: column; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-dot"></div>
      <span>TETHER</span>
      <span class="project-title">/ ${safeProjectName}</span>
    </div>
    <div class="header-actions">
      <button id="toggle-all-folders" class="btn">Expand All</button>
      <button id="copy-file-btn" class="btn">Copy Code</button>
      <button id="download-active-btn" class="btn">Save File</button>
    </div>
  </header>

  <div class="main-layout">
    <aside class="sidebar">
      <div class="sidebar-search">
        <input type="text" id="search-input" class="search-input" placeholder="Search files and folders...">
      </div>
      <div class="tree-container" id="file-tree"></div>
    </aside>

    <main class="editor-pane">
      <div class="editor-topbar">
        <div class="breadcrumb" id="breadcrumb-display">
          <span>${safeProjectName}</span>
        </div>
        <div id="file-meta" style="color: #64748B;"></div>
      </div>
      <div class="code-container" id="code-display">
        <div class="empty-state">
          <div>Select a file from the explorer to view its contents</div>
        </div>
      </div>
    </main>
  </div>

  <footer>
    <div id="status-left">${files.length} files · ${totalLines.toLocaleString()} total lines · ${(totalBytes / 1024).toFixed(1)} KB</div>
    <div>Self-Contained Web Code Export</div>
  </footer>

  <script>
    const FILES = ${encodedFilesJson};
    let activeFileId = FILES.length > 0 ? FILES[0].id : null;
    let folderCollapseState = {};

    function escapeHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function highlightSyntax(line, lang) {
      let escaped = escapeHtml(line);
      // Comments
      if (escaped.trim().startsWith('//') || escaped.trim().startsWith('#')) {
        return '<span class="comm">' + escaped + '</span>';
      }
      // Strings
      escaped = escaped.replace(/(["'\`].*?["'\`])/g, '<span class="str">$1</span>');
      // Numbers
      escaped = escaped.replace(/\\b(\\d+)\\b/g, '<span class="num">$1</span>');
      // Keywords
      escaped = escaped.replace(/\\b(import|export|from|const|let|var|function|return|if|else|switch|case|class|interface|type|extends|implements|async|await|try|catch|new|this|typeof|default)\\b/g, '<span class="kw">$1</span>');
      return escaped;
    }

    function buildTreeData(files) {
      const root = { name: '', path: '', isFolder: true, children: {}, files: [] };
      files.forEach(f => {
        const parts = f.path.split('/');
        let curr = root;
        for (let i = 0; i < parts.length - 1; i++) {
          const seg = parts[i];
          const currPath = parts.slice(0, i + 1).join('/');
          if (!curr.children[seg]) {
            curr.children[seg] = { name: seg, path: currPath, isFolder: true, children: {}, files: [] };
          }
          curr = curr.children[seg];
        }
        curr.files.push(f);
      });
      return root;
    }

    function renderTree(node, container, query = '') {
      // Render subfolders
      Object.keys(node.children).sort().forEach(folderName => {
        const folder = node.children[folderName];
        const isCollapsed = Boolean(folderCollapseState[folder.path]);
        
        const folderEl = document.createElement('div');
        const headerEl = document.createElement('div');
        headerEl.className = 'tree-folder-header';
        headerEl.innerHTML = '<span class="chevron ' + (isCollapsed ? '' : 'open') + '">▶</span> 📁 <span>' + escapeHtml(folderName) + '</span>';
        headerEl.onclick = () => {
          folderCollapseState[folder.path] = !isCollapsed;
          renderAllTree();
        };

        const contentEl = document.createElement('div');
        contentEl.className = 'tree-folder-content';
        if (isCollapsed) contentEl.style.display = 'none';

        renderTree(folder, contentEl, query);

        folderEl.appendChild(headerEl);
        folderEl.appendChild(contentEl);
        container.appendChild(folderEl);
      });

      // Render files
      node.files.sort((a,b) => a.name.localeCompare(b.name)).forEach(f => {
        if (query && !f.path.toLowerCase().includes(query.toLowerCase())) {
          return;
        }
        const fileEl = document.createElement('div');
        fileEl.className = 'tree-file-item ' + (f.id === activeFileId ? 'active' : '');
        fileEl.innerHTML = '<span>📄 ' + escapeHtml(f.name) + '</span><span class="file-badge">' + f.lineCount + 'L</span>';
        fileEl.onclick = () => {
          activeFileId = f.id;
          renderActiveFile();
          renderAllTree();
        };
        container.appendChild(fileEl);
      });
    }

    function renderAllTree() {
      const treeEl = document.getElementById('file-tree');
      treeEl.innerHTML = '';
      const query = document.getElementById('search-input').value.trim();
      const tree = buildTreeData(FILES);
      renderTree(tree, treeEl, query);
    }

    function renderActiveFile() {
      const active = FILES.find(f => f.id === activeFileId);
      const breadcrumbEl = document.getElementById('breadcrumb-display');
      const metaEl = document.getElementById('file-meta');
      const codeEl = document.getElementById('code-display');

      if (!active) {
        codeEl.innerHTML = '<div class="empty-state">No file selected</div>';
        breadcrumbEl.innerHTML = '<span>${safeProjectName}</span>';
        metaEl.innerText = '';
        return;
      }

      breadcrumbEl.innerHTML = '<span>${safeProjectName}</span> / <span class="current">' + escapeHtml(active.path) + '</span>';
      metaEl.innerText = active.language.toUpperCase() + ' · ' + active.lineCount + ' lines · ' + (active.size < 1024 ? active.size + ' B' : (active.size / 1024).toFixed(1) + ' KB');

      const lines = active.content.split('\\n');
      let html = '<table class="code-table"><tbody>';
      lines.forEach((line, idx) => {
        html += '<tr><td class="line-number">' + (idx + 1) + '</td><td class="line-text">' + highlightSyntax(line, active.language) + '</td></tr>';
      });
      html += '</tbody></table>';
      codeEl.innerHTML = html;
    }

    // Actions
    document.getElementById('search-input').addEventListener('input', () => {
      renderAllTree();
    });

    document.getElementById('copy-file-btn').addEventListener('click', () => {
      const active = FILES.find(f => f.id === activeFileId);
      if (!active) return;
      navigator.clipboard.writeText(active.content).then(() => {
        const btn = document.getElementById('copy-file-btn');
        btn.innerText = 'Copied!';
        setTimeout(() => btn.innerText = 'Copy Code', 1500);
      });
    });

    document.getElementById('download-active-btn').addEventListener('click', () => {
      const active = FILES.find(f => f.id === activeFileId);
      if (!active) return;
      const blob = new Blob([active.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = active.name;
      a.click();
      URL.revokeObjectURL(url);
    });

    let allCollapsed = false;
    document.getElementById('toggle-all-folders').addEventListener('click', () => {
      allCollapsed = !allCollapsed;
      const tree = buildTreeData(FILES);
      function setCollapseRecursive(node) {
        Object.values(node.children).forEach(child => {
          folderCollapseState[child.path] = allCollapsed;
          setCollapseRecursive(child);
        });
      }
      setCollapseRecursive(tree);
      document.getElementById('toggle-all-folders').innerText = allCollapsed ? 'Expand All' : 'Collapse All';
      renderAllTree();
    });

    // Initial render
    renderAllTree();
    renderActiveFile();
  </script>
</body>
</html>`;
}

/**
 * Downloads a standalone single-file HTML web application of the project
 */
export function exportProjectToSingleHtml(project: Project, blocks: Block[]): void {
  const files = extractProjectExportFiles(project, blocks);
  const html = generateStandaloneWebHtml(project, files);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const cleanName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cleanName}-web-explorer.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a complete Web Folder as a ZIP archive containing:
 * 1) index.html (the interactive web application viewer)
 * 2) All raw source files preserved in their folder hierarchy
 */
export async function exportProjectToWebZip(project: Project, blocks: Block[]): Promise<void> {
  const files = extractProjectExportFiles(project, blocks);
  const html = generateStandaloneWebHtml(project, files);

  const zip = new JSZip();
  // Add root index.html web viewer
  zip.file('index.html', html);

  // Add all files into their actual nested folder structure inside a project folder
  const cleanName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const projectFolder = zip.folder(cleanName) || zip;

  for (const f of files) {
    projectFolder.file(f.path, f.content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${cleanName}-web-folder.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
