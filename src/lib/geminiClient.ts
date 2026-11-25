import { GoogleGenAI, ThinkingLevel, type Schema } from '@google/genai';

export const GEMINI_RELIABILITY_MODEL = 'gemini-3.1-flash-lite';
export const GEMINI_LOW_TEMPERATURE = 0.1;
export const DEFAULT_AI_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_TRANSIENT_RETRIES = 2;
export const DEFAULT_BACKOFF_BASE_MS = 350;
export const DEFAULT_JOB_REQUEST_BUDGET = 6;

export type GeminiErrorCode =
  | 'NOT_CONFIGURED'
  | 'AI_DISABLED'
  | 'BUDGET_EXCEEDED'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'TRANSIENT_ERROR'
  | 'VALIDATION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UPSTREAM_ERROR';

export class GeminiClientError extends Error {
  public readonly code: GeminiErrorCode;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly attempts: number;
  public readonly causeDetail?: string;

  constructor(
    code: GeminiErrorCode,
    message: string,
    options: {
      status?: number;
      retryable?: boolean;
      attempts?: number;
      causeDetail?: string;
    } = {}
  ) {
    super(message);
    this.name = 'GeminiClientError';
    this.code = code;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
    this.attempts = options.attempts ?? 1;
    this.causeDetail = options.causeDetail;
  }
}

export function getConfiguredGeminiApiKey(): string | undefined {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export function createServerGeminiClient(): GoogleGenAI | null {
  const apiKey = getConfiguredGeminiApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Per-job request budget tracking (bounded LRU-style Map)
const jobRequestCounts = new Map<string, number>();
const MAX_TRACKED_JOBS = 200;

export function getJobBudgetStatus(
  jobId: string,
  budgetLimit: number = DEFAULT_JOB_REQUEST_BUDGET
): { used: number; limit: number; remaining: number } {
  const used = jobRequestCounts.get(jobId) ?? 0;
  return {
    used,
    limit: budgetLimit,
    remaining: Math.max(0, budgetLimit - used),
  };
}

export function consumeJobBudget(
  jobId: string,
  budgetLimit: number = DEFAULT_JOB_REQUEST_BUDGET
): { allowed: boolean; used: number; limit: number } {
  const current = jobRequestCounts.get(jobId) ?? 0;
  if (current >= budgetLimit) {
    return { allowed: false, used: current, limit: budgetLimit };
  }
  if (jobRequestCounts.size >= MAX_TRACKED_JOBS && !jobRequestCounts.has(jobId)) {
    const oldestKey = jobRequestCounts.keys().next().value;
    if (oldestKey) jobRequestCounts.delete(oldestKey);
  }
  const next = current + 1;
  jobRequestCounts.set(jobId, next);
  return { allowed: true, used: next, limit: budgetLimit };
}

export function resetJobBudget(jobId?: string): void {
  if (jobId) {
    jobRequestCounts.delete(jobId);
  } else {
    jobRequestCounts.clear();
  }
}

// Server-side cache keyed by promptVersion + file SHA-256 content hash
const serverResponseCache = new Map<string, unknown>();
const MAX_CACHE_ENTRIES = 150;

export function getServerAiCache<T>(cacheKey: string): T | undefined {
  return serverResponseCache.get(cacheKey) as T | undefined;
}

export function setServerAiCache<T>(cacheKey: string, value: T): void {
  if (!cacheKey) return;
  if (serverResponseCache.size >= MAX_CACHE_ENTRIES && !serverResponseCache.has(cacheKey)) {
    const oldestKey = serverResponseCache.keys().next().value;
    if (oldestKey) serverResponseCache.delete(oldestKey);
  }
  serverResponseCache.set(cacheKey, value);
}

export function clearServerAiCache(): void {
  serverResponseCache.clear();
}

export function classifyUpstreamError(err: unknown, attempts: number): GeminiClientError {
  if (err instanceof GeminiClientError) return err;

  const message =
    err instanceof Error && err.message ? err.message : 'Gemini request failed.';
  const lower = message.toLowerCase();

  const statusProp =
    typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;

  if (
    statusProp === 429 ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  ) {
    return new GeminiClientError(
      'RATE_LIMITED',
      'Gemini quota or rate limit reached; falling back to deterministic rules.',
      { status: 429, retryable: true, attempts, causeDetail: message }
    );
  }

  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('aborted')) {
    return new GeminiClientError(
      'TIMEOUT',
      'Gemini request timed out; falling back to deterministic rules.',
      { status: 504, retryable: true, attempts, causeDetail: message }
    );
  }

  if (
    statusProp === 500 ||
    statusProp === 502 ||
    statusProp === 503 ||
    statusProp === 504 ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('500') ||
    lower.includes('unavailable') ||
    lower.includes('econnreset') ||
    lower.includes('fetch failed') ||
    lower.includes('network')
  ) {
    return new GeminiClientError(
      'TRANSIENT_ERROR',
      'Gemini service temporarily unavailable; falling back to deterministic rules.',
      { status: statusProp ?? 503, retryable: true, attempts, causeDetail: message }
    );
  }

  if (
    statusProp === 401 ||
    statusProp === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied')
  ) {
    return new GeminiClientError(
      'NOT_CONFIGURED',
      'Gemini API key is invalid or unauthorized; check Settings > Secrets.',
      { status: statusProp ?? 403, retryable: false, attempts, causeDetail: message }
    );
  }

  return new GeminiClientError('UPSTREAM_ERROR', message, {
    status: statusProp ?? 500,
    retryable: false,
    attempts,
    causeDetail: message,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new GeminiClientError('TIMEOUT', `Timed out after ${timeoutMs}ms.`, { status: 504, retryable: true }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type GenerateTextFn = (params: {
  model: string;
  contents: string;
  systemInstruction: string;
  responseSchema: Schema;
  temperature: number;
}) => Promise<string>;

export type StructuredCallResult<T> =
  | {
      ok: true;
      status: 'success' | 'cached';
      data: T;
      model: string;
      promptVersion: string;
      cacheHit: boolean;
      attempts: number;
      budget: { used: number; limit: number; remaining: number };
    }
  | {
      ok: false;
      status: 'skipped' | 'fallback';
      skipReason: string;
      errorCode: GeminiErrorCode;
      model: string;
      promptVersion: string;
      cacheHit: boolean;
      attempts: number;
      budget: { used: number; limit: number; remaining: number };
    };

export async function executeStructuredGeminiCall<T>(options: {
  callType: 'intent-classify' | 'gap-analysis';
  promptVersion: string;
  cacheKey: string;
  jobId: string;
  aiEnabled?: boolean;
  jobBudgetLimit?: number;
  responseSchema: Schema;
  systemInstruction: string;
  buildPrompt: (validationRetryError?: string) => string;
  validate: (parsed: unknown) => { ok: true; data: T } | { ok: false; error: string };
  timeoutMs?: number;
  maxTransientRetries?: number;
  baseDelayMs?: number;
  model?: string;
  temperature?: number;
  generateFn?: GenerateTextFn;
}): Promise<StructuredCallResult<T>> {
  const model = options.model ?? GEMINI_RELIABILITY_MODEL;
  const temperature = options.temperature ?? GEMINI_LOW_TEMPERATURE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  const maxTransientRetries = options.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BACKOFF_BASE_MS;
  const budgetLimit = options.jobBudgetLimit ?? DEFAULT_JOB_REQUEST_BUDGET;
  const fullCacheKey = `${options.callType}:${options.promptVersion}:${options.cacheKey}`;

  // 1. Check user AI toggle
  if (options.aiEnabled === false) {
    const budget = getJobBudgetStatus(options.jobId, budgetLimit);
    console.info(`[gemini] call=${options.callType} promptVersion=${options.promptVersion} status=skipped reason=AI_DISABLED`);
    return {
      ok: false,
      status: 'skipped',
      skipReason: 'AI assistance is turned off; completed with deterministic rules.',
      errorCode: 'AI_DISABLED',
      model,
      promptVersion: options.promptVersion,
      cacheHit: false,
      attempts: 0,
      budget,
    };
  }

  // 2. Check content-hash cache (no network request or budget spent)
  const cached = getServerAiCache<T>(fullCacheKey);
  if (cached !== undefined) {
    const budget = getJobBudgetStatus(options.jobId, budgetLimit);
    console.info(`[gemini] call=${options.callType} promptVersion=${options.promptVersion} status=cached cacheKey=${options.cacheKey}`);
    return {
      ok: true,
      status: 'cached',
      data: cached,
      model,
      promptVersion: options.promptVersion,
      cacheHit: true,
      attempts: 0,
      budget,
    };
  }

  // 3. Ensure server AI client (or injected test generator) is available
  let invokeGenerate: GenerateTextFn;
  if (options.generateFn) {
    invokeGenerate = options.generateFn;
  } else {
    const ai = createServerGeminiClient();
    if (!ai) {
      const budget = getJobBudgetStatus(options.jobId, budgetLimit);
      console.info(`[gemini] call=${options.callType} promptVersion=${options.promptVersion} status=skipped reason=NOT_CONFIGURED`);
      return {
        ok: false,
        status: 'skipped',
        skipReason:
          'GEMINI_API_KEY is not configured on the server; completed with deterministic rules.',
        errorCode: 'NOT_CONFIGURED',
        model,
        promptVersion: options.promptVersion,
        cacheHit: false,
        attempts: 0,
        budget,
      };
    }
    invokeGenerate = async (params) => {
      const response = await ai.models.generateContent({
        model: params.model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: params.temperature,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
        },
      });
      return (response.text ?? '').trim();
    };
  }

  // 4. Enforce per-job request budget
  const consumed = consumeJobBudget(options.jobId, budgetLimit);
  if (!consumed.allowed) {
    const budget = getJobBudgetStatus(options.jobId, budgetLimit);
    console.info(`[gemini] call=${options.callType} promptVersion=${options.promptVersion} status=skipped reason=BUDGET_EXCEEDED`);
    return {
      ok: false,
      status: 'skipped',
      skipReason: `Per-job AI request budget (${budgetLimit} calls) reached; continuing with deterministic rules.`,
      errorCode: 'BUDGET_EXCEEDED',
      model,
      promptVersion: options.promptVersion,
      cacheHit: false,
      attempts: 0,
      budget,
    };
  }

  let totalAttempts = 0;

  const invokeWithTransientRetry = async (promptText: string): Promise<string> => {
    let lastErr: GeminiClientError | null = null;
    for (let attempt = 0; attempt <= maxTransientRetries; attempt += 1) {
      totalAttempts += 1;
      try {
        return await withTimeout(
          invokeGenerate({
            model,
            contents: promptText,
            systemInstruction: options.systemInstruction,
            responseSchema: options.responseSchema,
            temperature,
          }),
          timeoutMs
        );
      } catch (err) {
        const classified = classifyUpstreamError(err, totalAttempts);
        lastErr = classified;
        if (!classified.retryable || attempt >= maxTransientRetries) {
          throw classified;
        }
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        await sleep(delayMs);
      }
    }
    throw lastErr ?? new GeminiClientError('UPSTREAM_ERROR', 'Gemini request failed.');
  };

  try {
    // 5. Initial call
    const rawText1 = await invokeWithTransientRetry(options.buildPrompt());
    let validationError = '';

    try {
      const parsed1 = JSON.parse(rawText1) as unknown;
      const check1 = options.validate(parsed1);
      if (check1.ok) {
        setServerAiCache(fullCacheKey, check1.data);
        const budget = getJobBudgetStatus(options.jobId, budgetLimit);
        console.info(
          `[gemini] call=${options.callType} promptVersion=${options.promptVersion} status=success attempts=${totalAttempts}`
        );
        return {
          ok: true,
          status: 'success',
          data: check1.data,
          model,
          promptVersion: options.promptVersion,
          cacheHit: false,
          attempts: totalAttempts,
          budget,
        };
      }
      validationError = check1.error;
    } catch (parseErr) {
      validationError =
        parseErr instanceof Error
          ? `Malformed JSON output (${parseErr.message})`
          : 'Malformed JSON output';
    }

    // 6. Schema/parse failure: retry ONCE with validation error appended
    const rawText2 = await invokeWithTransientRetry(options.buildPrompt(validationError));
    let retryValidationError = '';

    try {
      const parsed2 = JSON.parse(rawText2) as unknown;
      const check2 = options.validate(parsed2);
      if (check2.ok) {
        setServerAiCache(fullCacheKey, check2.data);
        const budget = getJobBudgetStatus(options.jobId, budgetLimit);
        console.info(
          `[gemini] call=${options.callType} promptVersion=${options.promptVersion} status=success_after_schema_retry attempts=${totalAttempts}`
        );
        return {
          ok: true,
          status: 'success',
          data: check2.data,
          model,
          promptVersion: options.promptVersion,
          cacheHit: false,
          attempts: totalAttempts,
          budget,
        };
      }
      retryValidationError = check2.error;
    } catch (parseErr2) {
      retryValidationError =
        parseErr2 instanceof Error
          ? `Malformed JSON output (${parseErr2.message})`
          : 'Malformed JSON output';
    }

    const budget = getJobBudgetStatus(options.jobId, budgetLimit);
    console.warn(
      `[gemini] call=${options.callType} promptVersion=${options.promptVersion} status=fallback error=${retryValidationError}`
    );
    return {
      ok: false,
      status: 'fallback',
      skipReason: `Gemini output failed schema validation twice (${retryValidationError}); fell back to deterministic rules.`,
      errorCode: 'VALIDATION_FAILED',
      model,
      promptVersion: options.promptVersion,
      cacheHit: false,
      attempts: totalAttempts,
      budget,
    };
  } catch (err) {
    const classified = classifyUpstreamError(err, totalAttempts);
    const budget = getJobBudgetStatus(options.jobId, budgetLimit);
    console.warn(
      `[gemini] call=${options.callType} promptVersion=${options.promptVersion} status=fallback code=${classified.code} attempts=${classified.attempts}`
    );
    return {
      ok: false,
      status: 'fallback',
      skipReason: classified.message,
      errorCode: classified.code,
      model,
      promptVersion: options.promptVersion,
      cacheHit: false,
      attempts: totalAttempts,
      budget,
    };
  }
}
