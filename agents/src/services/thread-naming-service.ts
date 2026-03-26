/**
 * Thread naming service — wraps core naming logic with the agent SDK's auth.
 */

import {
  generateThreadName as coreGenerateThreadName,
  type ThreadNameResult,
} from "@core/lib/naming/thread-name.js";
import { sdkLlmCaller } from "./sdk-llm-caller.js";

export type { ThreadNameResult };

export function generateThreadName(prompt: string): Promise<ThreadNameResult> {
  return coreGenerateThreadName(prompt, sdkLlmCaller);
}
