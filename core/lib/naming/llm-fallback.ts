/**
 * Shared LLM fallback logic for naming services.
 * Importable by both agents/ and sidecar/.
 *
 * Accepts an injectable `LlmCaller` so consumers can provide their own
 * model-calling strategy (e.g. agent SDK query(), direct Anthropic client, etc.).
 */

const MODELS = {
  primary: "claude-haiku-4-5-20251001",
  fallback: "claude-sonnet-4-6-20260217",
} as const;

export interface FallbackOptions {
  system: string;
  prompt: string;
  maxOutputTokens: number;
}

export interface FallbackResult {
  text: string;
  usedFallback: boolean;
}

/** A function that calls an LLM and returns the text response. */
export type LlmCaller = (opts: {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  model: string;
}) => Promise<string>;

/**
 * Generate text with automatic model fallback.
 * Tries Haiku first, falls back to Sonnet if Haiku fails.
 * Throws if both models fail.
 *
 * @param options - System prompt, user prompt, and max output tokens.
 * @param caller - Function that calls the LLM. Must be provided by the consumer.
 */
export async function generateWithFallback(
  options: FallbackOptions,
  caller: LlmCaller,
): Promise<FallbackResult> {
  try {
    const text = await caller({ ...options, model: MODELS.primary });
    return { text, usedFallback: false };
  } catch {
    // Primary model failed — try fallback
  }

  const text = await caller({ ...options, model: MODELS.fallback });
  return { text, usedFallback: true };
}
