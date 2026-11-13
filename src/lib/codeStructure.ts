export interface CodeSection {
  id: string;
  type: 'imports' | 'constants' | 'function' | 'class' | 'component' | 'block';
  label: string;
  detail?: string;
  preview?: string;
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
  lineCount: number;
  collapsed: boolean;
  content: string;
}

export interface CodeSymbol {
  id: string;
  name: string;
  kind: 'function' | 'class' | 'component' | 'variable' | 'interface' | 'export';
  line: number;
  signature?: string;
}

/**
 * Exhaustively analyzes code content and splits it into logical, modular expandable sections:
 * - Imports (all import/require statements)
 * - Constants, Config & Types
 * - Functions & Methods
 * - Classes
 * - React / UI Components
 * - Surrounding logical blocks
 */
export function analyzeCodeStructure(code: string, language: string): {
  sections: CodeSection[];
  symbols: CodeSymbol[];
} {
  const lines = code.split('\n');
  const sections: CodeSection[] = [];
  const symbols: CodeSymbol[] = [];

  if (lines.length === 0 || code.trim().length === 0) {
    return { sections, symbols };
  }

  // Regex patterns
  const importRegex = /^\s*(import\s+|export\s+.*\s+from\s+|const\s+.*\s*=\s*require\()/;
  const functionRegex = /^\s*(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/;
  const arrowFunctionRegex = /^\s*(export\s+)?(const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\([^)]*\)\s*=>/;
  const componentRegex = /^\s*(export\s+)?(default\s+)?(function|const)\s+([A-Z][A-Za-z0-9_$]*)/;
  const classRegex = /^\s*(export\s+)?(abstract\s+)?class\s+([A-Za-z0-9_$]+)/;
  const constConfigRegex = /^\s*(export\s+)?(const|let|var)\s+([A-Z0-9_]{3,}|[A-Za-z0-9_$]*(?:CONFIG|OPTIONS|SETTINGS|THEME|DEFAULT|CONSTANTS))\b/;
  const interfaceTypeRegex = /^\s*(export\s+)?(interface|type)\s+([A-Za-z0-9_$]+)/;

  let lineIdx = 0;

  // 1. Check for leading imports
  let importStart = -1;
  let importEnd = -1;
  let hasImports = false;

  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const l = lines[i];
    const isCommentOrEmpty = /^\s*(\/\/|\/\*|\*|\*\/)?\s*$/.test(l);
    if (importRegex.test(l)) {
      if (importStart === -1) importStart = i;
      importEnd = i;
      hasImports = true;
    } else if (hasImports && !isCommentOrEmpty && importEnd !== -1) {
      break;
    }
  }

  if (hasImports && importStart !== -1 && importEnd >= importStart) {
    // If there were comments immediately before imports, include them
    let actualStart = importStart;
    while (actualStart > 0 && /^\s*(\/\/|\/\*|\*|\*\/)/.test(lines[actualStart - 1])) {
      actualStart--;
    }

    const chunk = lines.slice(actualStart, importEnd + 1);
    const count = importEnd - actualStart + 1;
    const preview = chunk.find((c) => importRegex.test(c))?.trim() || 'import ...';

    sections.push({
      id: `section-imports-${actualStart + 1}`,
      type: 'imports',
      label: `Imports (${count} lines)`,
      detail: `L${actualStart + 1}–L${importEnd + 1}`,
      preview,
      startLine: actualStart + 1,
      endLine: importEnd + 1,
      lineCount: count,
      collapsed: false,
      content: chunk.join('\n'),
    });

    symbols.push({
      id: `sym-imports-${actualStart + 1}`,
      name: 'Imports Block',
      kind: 'export',
      line: actualStart + 1,
      signature: `${count} lines`,
    });

    lineIdx = importEnd + 1;
  }

  // 2. Scan rest of document into contiguous sections
  let pendingBlockStart = -1;

  const flushPendingBlock = (endIdx: number) => {
    if (pendingBlockStart !== -1 && endIdx > pendingBlockStart) {
      const chunk = lines.slice(pendingBlockStart, endIdx);
      const text = chunk.join('\n');
      if (text.trim().length > 0) {
        const firstNonEmpty = chunk.find((c) => c.trim().length > 0)?.trim() || 'Declarations';
        sections.push({
          id: `section-block-${pendingBlockStart + 1}`,
          type: 'block',
          label: `Declarations & Logic`,
          detail: `L${pendingBlockStart + 1}–L${endIdx}`,
          preview: firstNonEmpty.length > 50 ? firstNonEmpty.slice(0, 50) + '...' : firstNonEmpty,
          startLine: pendingBlockStart + 1,
          endLine: endIdx,
          lineCount: endIdx - pendingBlockStart,
          collapsed: false,
          content: text,
        });
      }
      pendingBlockStart = -1;
    }
  };

  while (lineIdx < lines.length) {
    const line = lines[lineIdx];
    const trimmed = line.trim();

    if (!trimmed) {
      if (pendingBlockStart === -1) pendingBlockStart = lineIdx;
      lineIdx++;
      continue;
    }

    // Check React Component (must start with capital letter)
    const compMatch = line.match(componentRegex);
    if (compMatch && compMatch[4] && /^[A-Z]/.test(compMatch[4])) {
      flushPendingBlock(lineIdx);
      const compName = compMatch[4];
      const { endLine, content } = extractBlockRange(lines, lineIdx);
      sections.push({
        id: `section-comp-${lineIdx + 1}`,
        type: 'component',
        label: `Component: <${compName} />`,
        detail: `L${lineIdx + 1}–L${endLine}`,
        preview: trimmed.length > 60 ? trimmed.slice(0, 60) + '...' : trimmed,
        startLine: lineIdx + 1,
        endLine,
        lineCount: endLine - lineIdx,
        collapsed: false,
        content,
      });
      symbols.push({
        id: `sym-comp-${lineIdx + 1}`,
        name: `<${compName} />`,
        kind: 'component',
        line: lineIdx + 1,
      });
      lineIdx = endLine;
      continue;
    }

    // Check Class
    const classMatch = line.match(classRegex);
    if (classMatch) {
      flushPendingBlock(lineIdx);
      const className = classMatch[3];
      const { endLine, content } = extractBlockRange(lines, lineIdx);
      sections.push({
        id: `section-class-${lineIdx + 1}`,
        type: 'class',
        label: `Class: ${className}`,
        detail: `L${lineIdx + 1}–L${endLine}`,
        preview: trimmed.length > 60 ? trimmed.slice(0, 60) + '...' : trimmed,
        startLine: lineIdx + 1,
        endLine,
        lineCount: endLine - lineIdx,
        collapsed: false,
        content,
      });
      symbols.push({
        id: `sym-class-${lineIdx + 1}`,
        name: className,
        kind: 'class',
        line: lineIdx + 1,
      });
      lineIdx = endLine;
      continue;
    }

    // Check Function (named or arrow)
    const fnMatch = line.match(functionRegex);
    const arrowMatch = line.match(arrowFunctionRegex);
    if (fnMatch || arrowMatch) {
      flushPendingBlock(lineIdx);
      const fnName = fnMatch ? fnMatch[3] : arrowMatch ? arrowMatch[3] : 'function';
      const { endLine, content } = extractBlockRange(lines, lineIdx);
      sections.push({
        id: `section-fn-${lineIdx + 1}`,
        type: 'function',
        label: `Function: ${fnName}()`,
        detail: `L${lineIdx + 1}–L${endLine}`,
        preview: trimmed.length > 60 ? trimmed.slice(0, 60) + '...' : trimmed,
        startLine: lineIdx + 1,
        endLine,
        lineCount: endLine - lineIdx,
        collapsed: false,
        content,
      });
      symbols.push({
        id: `sym-fn-${lineIdx + 1}`,
        name: `${fnName}()`,
        kind: 'function',
        line: lineIdx + 1,
      });
      lineIdx = endLine;
      continue;
    }

    // Check Constants / Config / Types
    const constMatch = line.match(constConfigRegex);
    const typeMatch = line.match(interfaceTypeRegex);
    if (constMatch || typeMatch) {
      flushPendingBlock(lineIdx);
      const identifier = constMatch ? constMatch[3] : typeMatch ? `${typeMatch[2]} ${typeMatch[3]}` : 'config';
      const { endLine, content } = extractBlockRange(lines, lineIdx);
      sections.push({
        id: `section-const-${lineIdx + 1}`,
        type: 'constants',
        label: `Config/Type: ${identifier}`,
        detail: `L${lineIdx + 1}–L${endLine}`,
        preview: trimmed.length > 60 ? trimmed.slice(0, 60) + '...' : trimmed,
        startLine: lineIdx + 1,
        endLine,
        lineCount: endLine - lineIdx,
        collapsed: false,
        content,
      });
      symbols.push({
        id: `sym-const-${lineIdx + 1}`,
        name: identifier,
        kind: typeMatch ? 'interface' : 'variable',
        line: lineIdx + 1,
      });
      lineIdx = endLine;
      continue;
    }

    // Accumulate other lines into pending block
    if (pendingBlockStart === -1) pendingBlockStart = lineIdx;
    lineIdx++;
  }

  flushPendingBlock(lines.length);

  // Fallback: If no sections were identified, create single main block
  if (sections.length === 0) {
    sections.push({
      id: 'section-main',
      type: 'block',
      label: `Main Code Block`,
      detail: `L1–L${lines.length}`,
      preview: lines[0]?.trim() || '',
      startLine: 1,
      endLine: lines.length,
      lineCount: lines.length,
      collapsed: false,
      content: code,
    });
  }

  return { sections, symbols };
}

/**
 * Helper to scan curly brace scope balance to find the boundary of a block
 */
function extractBlockRange(lines: string[], startIdx: number): { endLine: number; content: string } {
  let openBraces = 0;
  let seenBrace = false;
  let curr = startIdx;

  for (; curr < lines.length; curr++) {
    const l = lines[curr];
    for (let charIdx = 0; charIdx < l.length; charIdx++) {
      const char = l[charIdx];
      if (char === '{') {
        openBraces++;
        seenBrace = true;
      } else if (char === '}') {
        openBraces--;
      }
    }

    if (seenBrace && openBraces <= 0) {
      curr++; // Include closing brace
      break;
    }

    // Safety fallback: if no braces found within 40 lines and line ends with semicolon
    if (!seenBrace && (l.includes(';') || curr - startIdx > 40)) {
      curr++;
      break;
    }
  }

  const endLine = Math.min(curr, lines.length);
  const blockLines = lines.slice(startIdx, endLine);
  return {
    endLine: Math.max(endLine, startIdx + 1),
    content: blockLines.join('\n'),
  };
}
