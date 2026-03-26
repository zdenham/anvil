/**
 * Worktree naming service — wraps core naming logic with the agent SDK's auth.
 */

import {
  generateWorktreeName as coreGenerateWorktreeName,
  sanitizeWorktreeName,
  type WorktreeNameResult,
} from "@core/lib/naming/worktree-name.js";
import { sdkLlmCaller } from "./sdk-llm-caller.js";

export { sanitizeWorktreeName };
export type { WorktreeNameResult };

export function generateWorktreeName(prompt: string): Promise<WorktreeNameResult> {
  return coreGenerateWorktreeName(prompt, sdkLlmCaller);
}
