import type { NestedArchivePolicy } from '../config/ingestConfig';
import type { ApplyEngineResult } from './applyEngine';
import { ingestFolderInputs, type FolderFileInput } from './folderIngest';
import { runVerificationAndBuildArtifacts, type VerifyAndArtifactsResult } from './verifyEngine';
import {
  OperationCancelledError,
  type ProgressCallback,
  type ProgressEventPayload,
} from './workerProtocol';
import { ingestZipBuffer, type ZipIngestOutcome } from './zipIngest';
import type {
  DeterministicAnalysis,
  IngestResult,
  IntentLockStageState,
} from '../types/pipeline';
import type { WorkerRequest, WorkerResponse } from '../workers/zipPipeline.worker';

export interface ActiveTaskHandle<T> {
  promise: Promise<T>;
  cancel: () => void;
}

function createRequestId(): string {
  return `wrk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function canUseBrowserWorker(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined';
}

function runInDedicatedWorker<T>(
  buildRequest: (id: string) => { request: WorkerRequest; transfer?: Transferable[] },
  fallbackRun: (signal: AbortSignal, onProgress?: ProgressCallback) => Promise<T>,
  onProgress?: ProgressCallback
): ActiveTaskHandle<T> {
  const controller = new AbortController();
  let terminated = false;
  let activeWorker: Worker | null = null;
  let rejectPending: ((reason?: unknown) => void) | null = null;

  const cancel = () => {
    if (terminated) return;
    terminated = true;
    controller.abort();
    if (activeWorker) {
      try {
        activeWorker.terminate();
      } catch {
        // Ignore terminate error
      }
      activeWorker = null;
    }
    if (rejectPending) {
      rejectPending(new OperationCancelledError());
      rejectPending = null;
    }
  };

  const promise = new Promise<T>((resolve, reject) => {
    rejectPending = reject;

    if (controller.signal.aborted) {
      reject(new OperationCancelledError());
      rejectPending = null;
      return;
    }

    if (canUseBrowserWorker()) {
      try {
        const worker = new Worker(
          new URL('../workers/zipPipeline.worker.ts', import.meta.url),
          { type: 'module' }
        );
        activeWorker = worker;
        const id = createRequestId();

        const cleanup = () => {
          worker.onmessage = null;
          worker.onerror = null;
          try {
            worker.terminate();
          } catch {
            // Ignore cleanup terminate error
          }
          if (activeWorker === worker) {
            activeWorker = null;
          }
          rejectPending = null;
        };

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          if (!msg || msg.id !== id || terminated) return;
          if (msg.type === 'progress') {
            onProgress?.(msg.payload);
            return;
          }
          if (msg.type === 'result') {
            cleanup();
            resolve(msg.payload as T);
            return;
          }
          if (msg.type === 'error') {
            cleanup();
            const err = new Error(msg.message);
            err.name = msg.name || 'WorkerError';
            reject(err);
          }
        };

        worker.onerror = (errEvent) => {
          cleanup();
          if (terminated) {
            reject(new OperationCancelledError());
            return;
          }
          // Fall back gracefully if worker script loading is blocked in environment
          void fallbackRun(controller.signal, onProgress).then(resolve, reject);
          void errEvent;
        };

        const { request, transfer } = buildRequest(id);
        if (transfer && transfer.length > 0) {
          worker.postMessage(request, transfer);
        } else {
          worker.postMessage(request);
        }
        return;
      } catch {
        // Worker construction failed (e.g. restricted environment); fall back cleanly
        activeWorker = null;
      }
    }

    void fallbackRun(controller.signal, (p: ProgressEventPayload) => {
      if (!terminated) onProgress?.(p);
    }).then(
      (res) => {
        rejectPending = null;
        if (terminated) {
          reject(new OperationCancelledError());
          return;
        }
        resolve(res);
      },
      (err) => {
        rejectPending = null;
        reject(err);
      }
    );
  });

  return { promise, cancel };
}

export function startIngestZipTask(
  archiveName: string,
  buffer: ArrayBuffer,
  nestedArchivePolicy: NestedArchivePolicy,
  onProgress?: ProgressCallback
): ActiveTaskHandle<ZipIngestOutcome> {
  return runInDedicatedWorker<ZipIngestOutcome>(
    (id) => ({
      request: {
        id,
        type: 'ingest-zip',
        archiveName,
        buffer,
        nestedArchivePolicy,
      },
      transfer: canUseBrowserWorker() ? [buffer] : undefined,
    }),
    (signal, progressCb) =>
      ingestZipBuffer(archiveName, buffer, {
        nestedArchivePolicy,
        signal,
        onProgress: progressCb,
      }),
    onProgress
  );
}

export function startIngestFolderTask(
  inputs: FolderFileInput[],
  nestedArchivePolicy: NestedArchivePolicy,
  onProgress?: ProgressCallback
): ActiveTaskHandle<ZipIngestOutcome> {
  const workerCompatible =
    canUseBrowserWorker() &&
    inputs.every((item) => typeof File !== 'undefined' && item.file instanceof File);

  if (!workerCompatible) {
    const controller = new AbortController();
    let cancelled = false;
    let rejectPending: ((reason?: unknown) => void) | null = null;

    const promise = new Promise<ZipIngestOutcome>((resolve, reject) => {
      rejectPending = reject;
      void ingestFolderInputs(inputs, {
        nestedArchivePolicy,
        signal: controller.signal,
        onProgress: (p) => {
          if (!cancelled) onProgress?.(p);
        },
      }).then(
        (res) => {
          rejectPending = null;
          if (cancelled) {
            reject(new OperationCancelledError());
            return;
          }
          resolve(res);
        },
        (err) => {
          rejectPending = null;
          reject(err);
        }
      );
    });

    return {
      promise,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        controller.abort();
        if (rejectPending) {
          rejectPending(new OperationCancelledError());
          rejectPending = null;
        }
      },
    };
  }

  return runInDedicatedWorker<ZipIngestOutcome>(
    (id) => ({
      request: {
        id,
        type: 'ingest-folder',
        inputs,
        nestedArchivePolicy,
      },
    }),
    (signal, progressCb) =>
      ingestFolderInputs(inputs, {
        nestedArchivePolicy,
        signal,
        onProgress: progressCb,
      }),
    onProgress
  );
}

export function startVerifyAndPackageTask(
  ingest: IngestResult,
  analysis: DeterministicAnalysis,
  intent: IntentLockStageState,
  applyResult: ApplyEngineResult,
  onProgress?: ProgressCallback
): ActiveTaskHandle<VerifyAndArtifactsResult> {
  return runInDedicatedWorker<VerifyAndArtifactsResult>(
    (id) => ({
      request: {
        id,
        type: 'verify-and-package',
        ingest,
        analysis,
        intent,
        applyResult,
      },
    }),
    (signal, progressCb) =>
      runVerificationAndBuildArtifacts(ingest, analysis, intent, applyResult, {
        signal,
        onProgress: progressCb,
      }),
    onProgress
  );
}
