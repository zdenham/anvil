/**
 * LLM caller that uses the Claude Agent SDK's query() function.
 * This ensures naming requests use the same auth as the main agent thread
 * (keychain/OAuth), rather than requiring ANTHROPIC_API_KEY in the environment.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { LlmCaller } from "@core/lib/naming/llm-fallback.js";

/**
 * Call an LLM via the agent SDK's query() function.
 * Uses tools: [] and maxTurns: 1 to keep it lightweight.
 */
export const sdkLlmCaller: LlmCaller = async (opts) => {
  const q = query({
    prompt: opts.prompt,
    options: {
      systemPrompt: opts.system,
      model: opts.model,
      tools: [],
      maxTurns: 1,
      thinking: { type: "disabled" },
      persistSession: false,
      permissionMode: "plan",
    },
  });

  let result = "";
  for await (const message of q) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        result = message.result;
      } else {
        throw new Error(`SDK query failed: ${message.subtype}`);
      }
    }
  }

  return result;
};
