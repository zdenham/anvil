/**
 * Shared LLM fallback logic for naming services.
 * Importable by both agents/ and sidecar/.
 *
 * Uses @ai-sdk/anthropic + ai for model calls with Haiku→Sonnet fallback.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const MODELS = {
  primary: "claude-haiku-4-5-20251001",
  fallback: "claude-sonnet-4-6-20260217",
} as const;

export interface FallbackOptions {
  apiKey: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
}

export interface FallbackResult {
  text: string;
  usedFallback: boolean;
}

/**
 * Generate text with automatic model fallback.
 * Tries Haiku first, falls back to Sonnet if Haiku fails.
 * Throws if both models fail.
 */
export async function generateWithFallback(
  options: FallbackOptions,
): Promise<FallbackResult> {
  const anthropic = createAnthropic({ apiKey: options.apiKey });

  try {
    const result = await generateText({
      model: anthropic(MODELS.primary),
      system: options.system,
      prompt: options.prompt,
      maxOutputTokens: options.maxOutputTokens,
    });
    return { text: result.text, usedFallback: false };
  } catch {
    // Primary model failed — try fallback
  }

  const result = await generateText({
    model: anthropic(MODELS.fallback),
    system: options.system,
    prompt: options.prompt,
    maxOutputTokens: options.maxOutputTokens,
  });

  return { text: result.text, usedFallback: true };
}
