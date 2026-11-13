'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import type { CodeSection } from '../../lib/codeStructure';
import type { AuditFinding } from '../../types/model';
import { ExpandableSectionHeader } from './ExpandableSectionHeader';
import { EditorView, basicSetup } from 'codemirror';
import { lineNumbers } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  createAuditHighlightExtension,
  setAuditFindingsEffect,
} from '../../lib/cmAuditExtension';

function getLanguageExtension(lang: string) {
  switch (lang.toLowerCase()) {
    case 'javascript':
    case 'js':
    case 'jsx':
      return javascript();
    case 'typescript':
    case 'ts':
    case 'tsx':
      return javascript({ typescript: true });
    case 'html':
      return html();
    case 'css':
      return css();
    case 'json':
      return json();
    case 'markdown':
    case 'md':
      return markdown();
    default:
      return javascript();
  }
}

interface ModularCodeSectionProps {
  section: CodeSection;
  language: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSectionContentChange: (sectionId: string, newContent: string) => void;
  onCursorActivity?: (line: number, col: number) => void;
  findings?: AuditFinding[];
  jumpToLineRequest?: { line: number; token: number } | null;
}

export function ModularCodeSection({
  section,
  language,
  isCollapsed,
  onToggleCollapse,
  onSectionContentChange,
  onCursorActivity,
  findings = [],
  jumpToLineRequest = null,
}: ModularCodeSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());

  // Map global findings into this section's local line numbers
  const localFindings = useMemo(() => {
    const lines = section.content.split('\n');
    const lineStarts: number[] = [0];
    for (let i = 0; i < lines.length - 1; i++) {
      lineStarts.push(lineStarts[i] + lines[i].length + 1);
    }

    return findings
      .filter((f) => {
        const l = f.line ?? 0;
        return l >= section.startLine && l <= section.endLine;
      })
      .map((f) => {
        const localLine = (f.line ?? section.startLine) - section.startLine + 1;
        const localLineIdx = Math.max(0, Math.min(lines.length - 1, localLine - 1));
        const lineStart = lineStarts[localLineIdx] ?? 0;
        const colOffset = Math.max(0, (f.column ?? 1) - 1);
        const from = Math.min(section.content.length, lineStart + colOffset);
        const spanLen =
          typeof f.from === 'number' && typeof f.to === 'number' && f.to > f.from
            ? f.to - f.from
            : Math.max(1, (lines[localLineIdx]?.length ?? 1) - colOffset);
        const to = Math.min(section.content.length, from + spanLen);

        return {
          ...f,
          line: localLine,
          from,
          to,
        };
      });
  }, [findings, section.content, section.startLine, section.endLine]);

  const errorCount = useMemo(
    () => localFindings.filter((f) => f.severity === 'error').length,
    [localFindings]
  );
  const warningCount = useMemo(
    () => localFindings.filter((f) => f.severity === 'warning').length,
    [localFindings]
  );

  // Mount CodeMirror when expanded
  useEffect(() => {
    if (isCollapsed || !containerRef.current) {
      if (editorViewRef.current) {
        editorViewRef.current.destroy();
        editorViewRef.current = null;
      }
      return;
    }

    const startState = EditorState.create({
      doc: section.content,
      extensions: [
        basicSetup,
        oneDark,
        languageCompartment.current.of(getLanguageExtension(language)),
        createAuditHighlightExtension(localFindings),
        lineNumbers({
          formatNumber: (n) => String(n + section.startLine - 1),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const nextText = update.state.doc.toString();
            onSectionContentChange(section.id, nextText);
          }
          if (update.selectionSet && onCursorActivity) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursorActivity(line.number + section.startLine - 1, head - line.from + 1);
          }
        }),
        EditorView.theme({
          '&': {
            height: 'auto',
            minHeight: '28px',
            fontSize: '13px',
            fontFamily: 'monospace',
            backgroundColor: '#090A0D',
          },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-gutters': {
            backgroundColor: '#0D0F14',
            color: '#52525b',
            borderRight: '1px solid #1c2028',
          },
          '.cm-activeLine': {
            backgroundColor: '#141822',
          },
          '.cm-activeLineGutter': {
            backgroundColor: '#181D2A',
            color: '#93c5fd',
          },
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCollapsed, section.id]);

  // Synchronize external changes if needed
  useEffect(() => {
    if (editorViewRef.current && !isCollapsed) {
      const currentDoc = editorViewRef.current.state.doc.toString();
      if (currentDoc !== section.content) {
        editorViewRef.current.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: section.content },
        });
      }
    }
  }, [section.content, isCollapsed]);

  // Push updated audit highlights to CodeMirror
  useEffect(() => {
    if (editorViewRef.current && !isCollapsed) {
      editorViewRef.current.dispatch({
        effects: setAuditFindingsEffect.of(localFindings),
      });
    }
  }, [localFindings, isCollapsed]);

  // Jump to line if requested for this section
  useEffect(() => {
    if (
      !isCollapsed &&
      editorViewRef.current &&
      jumpToLineRequest &&
      jumpToLineRequest.line >= section.startLine &&
      jumpToLineRequest.line <= section.endLine
    ) {
      const localLine = Math.max(
        1,
        Math.min(
          editorViewRef.current.state.doc.lines,
          jumpToLineRequest.line - section.startLine + 1
        )
      );
      const lineObj = editorViewRef.current.state.doc.line(localLine);
      editorViewRef.current.dispatch({
        selection: { anchor: lineObj.from },
        effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
      });
      editorViewRef.current.focus();
    }
  }, [jumpToLineRequest, isCollapsed, section.startLine, section.endLine]);

  return (
    <div
      className={`border rounded-md overflow-hidden bg-[#090A0D] shadow-sm my-2 transition-all ${
        errorCount > 0 ? 'border-red-900/80' : 'border-zinc-800/60'
      }`}
    >
      {/* Interactive One-Line Summary Header */}
      <ExpandableSectionHeader
        section={section}
        isCollapsed={isCollapsed}
        onToggle={onToggleCollapse}
        errorCount={errorCount}
        warningCount={warningCount}
      />

      {/* Expanded Syntax-Highlighted Editor */}
      {!isCollapsed && (
        <div
          ref={containerRef}
          className="w-full bg-[#090A0D] border-t border-zinc-800/40"
        />
      )}
    </div>
  );
}
