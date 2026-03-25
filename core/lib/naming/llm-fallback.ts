/**
 * Shared LLM fallback logic for naming services.
 * Importable by both agents/ and sidecar/.
 *
 * Uses @anthropic-ai/sdk for model calls with Haiku→Sonnet fallback.
 * The SDK auto-discovers auth (API key or OAuth login token).
 */

import Anthropic from "@anthropic-ai/sdk";

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

/**
 * Generate text with automatic model fallback.
 * Tries Haiku first, falls back to Sonnet if Haiku fails.
 * Throws if both models fail.
 */
export async function generateWithFallback(
  options: FallbackOptions,
): Promise<FallbackResult> {
  const client = new Anthropic();

  try {
    const text = await callModel(client, { ...options, model: MODELS.primary });
    return { text, usedFallback: false };
  } catch {
    // Primary model failed — try fallback
  }

  const text = await callModel(client, { ...options, model: MODELS.fallback });
  return { text, usedFallback: true };
}

async function callModel(
  client: Anthropic,
  opts: { system: string; prompt: string; maxOutputTokens: number; model: string },
): Promise<string> {
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxOutputTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") {
      text += block.text;
    }
  }
  return text;
}
