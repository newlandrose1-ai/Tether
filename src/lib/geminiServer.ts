export {
  GEMINI_RELIABILITY_MODEL as GEMINI_INTENT_MODEL,
  GEMINI_RELIABILITY_MODEL,
  GeminiClientError,
  createServerGeminiClient,
  getConfiguredGeminiApiKey,
  classifyUpstreamError,
} from './geminiClient';

export function formatGeminiErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return 'Gemini request failed.';
}
