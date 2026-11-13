export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  hasChanges: boolean;
}

/**
 * Computes a line-by-line diff using a clean LCS algorithm.
 * Extremely fast, zero external dependencies, perfect for browser inspector diffs.
 */
export function computeLineDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];

  if (oldText === newText) {
    return {
      lines: newLines.map((text, idx) => ({
        type: 'unchanged',
        text,
        oldLineNumber: idx + 1,
        newLineNumber: idx + 1,
      })),
      additions: 0,
      deletions: 0,
      hasChanges: false,
    };
  }

  const n = oldLines.length;
  const m = newLines.length;

  // Build LCS matrix (bounded to prevent huge memory for massive files)
  const maxLines = 1500;
  if (n > maxLines || m > maxLines) {
    // Fallback simple line comparison if file is enormous
    return fallbackDiff(oldLines, newLines);
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = n;
  let j = m;
  let additions = 0;
  let deletions = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({
        type: 'unchanged',
        text: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({
        type: 'added',
        text: newLines[j - 1],
        newLineNumber: j,
      });
      additions++;
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      result.unshift({
        type: 'removed',
        text: oldLines[i - 1],
        oldLineNumber: i,
      });
      deletions++;
      i--;
    }
  }

  return {
    lines: result,
    additions,
    deletions,
    hasChanges: additions > 0 || deletions > 0,
  };
}

function fallbackDiff(oldLines: string[], newLines: string[]): DiffResult {
  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      lines.push({ type: 'unchanged', text: o, oldLineNumber: i + 1, newLineNumber: i + 1 });
    } else {
      if (o !== undefined) {
        lines.push({ type: 'removed', text: o, oldLineNumber: i + 1 });
        deletions++;
      }
      if (n !== undefined) {
        lines.push({ type: 'added', text: n, newLineNumber: i + 1 });
        additions++;
      }
    }
  }

  return {
    lines,
    additions,
    deletions,
    hasChanges: additions > 0 || deletions > 0,
  };
}
