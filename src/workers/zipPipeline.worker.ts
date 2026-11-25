import type { NestedArchivePolicy } from '../config/ingestConfig';
import type { ApplyEngineResult } from '../lib/applyEngine';
import { ingestFolderInputs, type FolderFileInput } from '../lib/folderIngest';
import { runVerificationAndBuildArtifacts, type VerifyAndArtifactsResult } from '../lib/verifyEngine';
import type { ProgressEventPayload } from '../lib/workerProtocol';
import { ingestZipBuffer, type ZipIngestOutcome } from '../lib/zipIngest';
import type {
  DeterministicAnalysis,
  IngestResult,
  IntentLockStageState,
} from '../types/pipeline';

export type WorkerRequest =
  | {
      id: string;
      type: 'ingest-zip';
      archiveName: string;
      buffer: ArrayBuffer;
      nestedArchivePolicy: NestedArchivePolicy;
    }
  | {
      id: string;
      type: 'ingest-folder';
      inputs: FolderFileInput[];
      nestedArchivePolicy: NestedArchivePolicy;
    }
  | {
      id: string;
      type: 'verify-and-package';
      ingest: IngestResult;
      analysis: DeterministicAnalysis;
      intent: IntentLockStageState;
      applyResult: ApplyEngineResult;
    };

export type WorkerResponse =
  | {
      id: string;
      type: 'progress';
      payload: ProgressEventPayload;
    }
  | {
      id: string;
      type: 'result';
      payload: ZipIngestOutcome | VerifyAndArtifactsResult;
    }
  | {
      id: string;
      type: 'error';
      name: string;
      message: string;
    };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (!req || typeof req.id !== 'string') return;

  const emitProgress = (payload: ProgressEventPayload) => {
    workerScope.postMessage({
      id: req.id,
      type: 'progress',
      payload,
    });
  };

  try {
    if (req.type === 'ingest-zip') {
      const outcome = await ingestZipBuffer(req.archiveName, req.buffer, {
        nestedArchivePolicy: req.nestedArchivePolicy,
        onProgress: emitProgress,
      });
      workerScope.postMessage({
        id: req.id,
        type: 'result',
        payload: outcome,
      });
      return;
    }

    if (req.type === 'ingest-folder') {
      const outcome = await ingestFolderInputs(req.inputs, {
        nestedArchivePolicy: req.nestedArchivePolicy,
        onProgress: emitProgress,
      });
      workerScope.postMessage({
        id: req.id,
        type: 'result',
        payload: outcome,
      });
      return;
    }

    if (req.type === 'verify-and-package') {
      const result = await runVerificationAndBuildArtifacts(
        req.ingest,
        req.analysis,
        req.intent,
        req.applyResult,
        {
          onProgress: emitProgress,
        }
      );
      workerScope.postMessage({
        id: req.id,
        type: 'result',
        payload: result,
      });
      return;
    }
  } catch (err) {
    workerScope.postMessage({
      id: req.id,
      type: 'error',
      name: err instanceof Error ? err.name : 'WorkerError',
      message: err instanceof Error ? err.message : 'Unexpected worker execution failure.',
    });
  }
};
