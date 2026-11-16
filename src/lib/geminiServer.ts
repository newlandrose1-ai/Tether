import { GoogleGenAI } from '@google/genai';

export const GEMINI_AUDIT_MODEL = 'gemini-4-hydrogen';

export function getConfiguredGeminiApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return apiKey;
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

export function formatGeminiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown Gemini API error');
  const upper = raw.toUpperCase();
  if (
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('API KEY')
  ) {
    return 'Gemini API authentication failed. Please check or select your key in Settings > Secrets.';
  }
  if (upper.includes('RESOURCE_EXHAUSTED') || upper.includes('429')) {
    return 'Gemini API rate limit or quota reached. Please wait briefly or check your key quota in Settings > Secrets.';
  }
  if (upper.includes('NOT_FOUND') || upper.includes('404')) {
    return `Gemini model "${GEMINI_AUDIT_MODEL}" returned NOT_FOUND. Verify model availability.`;
  }
  return raw;
}

function isRetryableError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err || '');
  return /\b(429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|ECONNRESET|ETIMEDOUT)\b/i.test(
    raw
  );
}

export async function withGeminiRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryableError(err)) {
        throw err;
      }
      const delayMs = 450 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
