/**
 * LLM caller that uses @anthropic-ai/sdk directly.
 * Used by the sidecar which runs in a TUI context where the Anthropic API key
 * is available in the environment.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LlmCaller } from "@core/lib/naming/llm-fallback.js";

export const anthropicLlmCaller: LlmCaller = async (opts) => {
  const client = new Anthropic();
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
