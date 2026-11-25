export interface ProgressEventPayload {
  phase: string;
  label: string;
  completed: number;
  total: number;
  percent: number;
  currentPath?: string;
}

export type ProgressCallback = (update: ProgressEventPayload) => void;

export class OperationCancelledError extends Error {
  constructor(message = 'Operation cancelled by user.') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}

export function isCancelledError(err: unknown): boolean {
  return (
    err instanceof OperationCancelledError ||
    (err instanceof Error && err.name === 'OperationCancelledError')
  );
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new OperationCancelledError();
  }
}

export async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
