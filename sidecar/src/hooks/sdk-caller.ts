/**
 * LLM caller that uses @anthropic-ai/sdk directly.
 * Used by the sidecar for TUI thread naming.
 *
 * Accepts an optional API key so callers can pass the key from settings
 * rather than relying solely on process.env.ANTHROPIC_API_KEY.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LlmCaller } from "@core/lib/naming/llm-fallback.js";

/**
 * Creates an LlmCaller that uses the Anthropic SDK.
 * When `apiKey` is provided it is passed directly to the client;
 * otherwise the SDK falls back to process.env.ANTHROPIC_API_KEY.
 */
export function createAnthropicLlmCaller(apiKey?: string): LlmCaller {
  return async (opts) => {
    const client = new Anthropic(apiKey ? { apiKey } : undefined);
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
  };
}
