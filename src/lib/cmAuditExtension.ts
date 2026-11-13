import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import type { AuditFinding } from '../types/model';

export const setAuditFindingsEffect = StateEffect.define<AuditFinding[]>();

const errorLineDecoration = Decoration.line({
  attributes: { class: 'cm-audit-error-line' },
});

const warningLineDecoration = Decoration.line({
  attributes: { class: 'cm-audit-warning-line' },
});

const errorMarkDecoration = Decoration.mark({
  class: 'cm-audit-error-mark',
});

const warningMarkDecoration = Decoration.mark({
  class: 'cm-audit-warning-mark',
});

function buildDecorations(docLength: number, docLines: number, docLineAt: (n: number) => { from: number; to: number }, findings: AuditFinding[]): DecorationSet {
  const items: Array<{ from: number; to: number; isLine: boolean; deco: Decoration }> = [];
  const decoratedLines = new Set<number>();

  for (const f of findings) {
    if (!f.line || f.line < 1 || f.line > docLines) continue;
    const lineObj = docLineAt(f.line);
    const isError = f.severity === 'error';

    if (!decoratedLines.has(f.line)) {
      decoratedLines.add(f.line);
      items.push({
        from: lineObj.from,
        to: lineObj.from,
        isLine: true,
        deco: isError ? errorLineDecoration : warningLineDecoration,
      });
    }

    const markFrom =
      typeof f.from === 'number' && f.from >= 0 && f.from <= docLength
        ? f.from
        : lineObj.from;
    const markTo =
      typeof f.to === 'number' && f.to > markFrom && f.to <= docLength
        ? f.to
        : Math.min(docLength, Math.max(markFrom + 1, lineObj.to));

    if (markTo > markFrom) {
      items.push({
        from: markFrom,
        to: markTo,
        isLine: false,
        deco: isError ? errorMarkDecoration : warningMarkDecoration,
      });
    }
  }

  // RangeSetBuilder requires decorations sorted by `from`, then `startSide` (line decorations come first)
  items.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.isLine !== b.isLine) return a.isLine ? -1 : 1;
    return a.to - b.to;
  });

  const builder = new RangeSetBuilder<Decoration>();
  for (const item of items) {
    builder.add(item.from, item.to, item.deco);
  }
  return builder.finish();
}

export function createAuditHighlightExtension(initialFindings: AuditFinding[] = []) {
  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(
        state.doc.length,
        state.doc.lines,
        (n) => state.doc.line(n),
        initialFindings
      );
    },
    update(decorations, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setAuditFindingsEffect)) {
          return buildDecorations(
            tr.state.doc.length,
            tr.state.doc.lines,
            (n) => tr.state.doc.line(n),
            effect.value
          );
        }
      }
      if (tr.docChanged) {
        return decorations.map(tr.changes);
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const theme = EditorView.baseTheme({
    '.cm-audit-error-line': {
      backgroundColor: 'rgba(239, 68, 68, 0.14)',
      boxShadow: 'inset 2px 0 0 #ef4444',
    },
    '.cm-audit-warning-line': {
      backgroundColor: 'rgba(245, 158, 11, 0.10)',
      boxShadow: 'inset 2px 0 0 #f59e0b',
    },
    '.cm-audit-error-mark': {
      textDecoration: 'underline wavy #f87171',
      textUnderlineOffset: '3px',
      backgroundColor: 'rgba(239, 68, 68, 0.18)',
      borderRadius: '2px',
    },
    '.cm-audit-warning-mark': {
      textDecoration: 'underline wavy #fbbf24',
      textUnderlineOffset: '3px',
    },
  });

  return [field, theme];
}
