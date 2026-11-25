'use client';

import React from 'react';
import { AlertOctagon, Check, Copy, RotateCcw } from 'lucide-react';
import type { PipelineStage } from '../types/pipeline';

export interface StageDiagnosticsContext {
  stage: PipelineStage;
  fileCount: number;
  primaryLanguage: string | null;
  profileId: string | null;
  ingestStatus: string;
}

interface StageErrorBoundaryProps {
  stage: PipelineStage;
  diagnosticsContext: StageDiagnosticsContext;
  onStartOver: () => void;
  children: React.ReactNode;
}

interface StageErrorBoundaryState {
  error: Error | null;
  copied: boolean;
}

function scrubDiagnosticsText(raw: string): string {
  // Never leak file contents, tokens, or long strings in diagnostics
  return raw
    .replace(/(?:sk-|ghp_|gho_|AIza|AKIA|xox[bpars]-)[A-Za-z0-9_\-]{6,}/g, '[REDACTED]')
    .replace(/(["'`])(?:\\.|(?!\1).){32,}\1/g, '"[REDACTED_LITERAL]"')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[PATH]')
    .slice(0, 600);
}

export function buildSafeDiagnosticsPayload(
  error: Error,
  context: StageDiagnosticsContext
): string {
  const safePayload = {
    app: 'Zip Upgrader',
    timestamp: new Date().toISOString(),
    stage: context.stage,
    ingestStatus: context.ingestStatus,
    fileCount: context.fileCount,
    primaryLanguage: context.primaryLanguage,
    profileId: context.profileId,
    errorName: scrubDiagnosticsText(error.name || 'Error'),
    errorMessage: scrubDiagnosticsText(error.message || 'Unknown UI error'),
    stackLines: (error.stack || '')
      .split('\n')
      .slice(0, 6)
      .map((line) => scrubDiagnosticsText(line.trim())),
  };
  return JSON.stringify(safePayload, null, 2);
}

export class StageErrorBoundary extends React.Component<
  StageErrorBoundaryProps,
  StageErrorBoundaryState
> {
  constructor(props: StageErrorBoundaryProps) {
    super(props);
    this.state = {
      error: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<StageErrorBoundaryState> {
    return { error, copied: false };
  }

  componentDidUpdate(prevProps: StageErrorBoundaryProps) {
    if (prevProps.stage !== this.props.stage && this.state.error !== null) {
      this.setState({ error: null, copied: false });
    }
  }

  handleCopyDiagnostics = async () => {
    if (!this.state.error) return;
    const payload = buildSafeDiagnosticsPayload(this.state.error, this.props.diagnosticsContext);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        this.setState({ copied: true });
        window.setTimeout(() => {
          this.setState({ copied: false });
        }, 2000);
      }
    } catch {
      // Clipboard blocked; ignore safely
    }
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="rounded-lg border border-red-500/60 bg-red-950/30 p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <AlertOctagon className="mt-0.5 h-5 w-5 text-red-400 shrink-0" aria-hidden="true" />
          <div className="space-y-1.5 min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-red-100">
              Something went wrong on this step
            </h1>
            <p className="text-sm text-red-200">
              This stage hit an unexpected display error. Your original upload was not changed, and
              no file contents are included in copied diagnostics.
            </p>
            <p className="font-mono text-xs text-red-300 break-words">
              {scrubDiagnosticsText(this.state.error.message || this.state.error.name)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pl-8">
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null, copied: false });
              this.props.onStartOver();
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Start over</span>
          </button>
          <button
            type="button"
            onClick={() => void this.handleCopyDiagnostics()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            {this.state.copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>Diagnostics copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Copy diagnostics</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }
}
