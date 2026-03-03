import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { logger } from "../lib/logger.js";

const MODELS = {
  primary: "claude-haiku-4-5-20251001",
  fallback: "claude-sonnet-4-6-20260217",
} as const;

interface FallbackOptions {
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
  options: FallbackOptions
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
  } catch (primaryError) {
    logger.warn(
      `[llm-fallback] Primary model (${MODELS.primary}) failed: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`
    );
  }

  const result = await generateText({
    model: anthropic(MODELS.fallback),
    system: options.system,
    prompt: options.prompt,
    maxOutputTokens: options.maxOutputTokens,
  });

  logger.info(
    `[llm-fallback] Fallback model (${MODELS.fallback}) succeeded`
  );
  return { text: result.text, usedFallback: true };
}
