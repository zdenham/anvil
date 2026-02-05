import { promptHistoryService } from "./prompt-history-service";
import { logger } from "./logger-client";

/**
 * Save a submitted prompt to history.
 * Call this after successfully submitting a prompt from any input source.
 */
export async function savePromptToHistory(
  prompt: string,
  taskId?: string
): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;

  try {
    await promptHistoryService.add(trimmed, taskId);
  } catch (error) {
    logger.error("[PromptHistory] Failed to save prompt to history:", error);
  }
}

/**
 * Save a draft prompt to history (e.g., when input loses focus).
 * Uses addDraft which only saves if not already in history.
 */
export async function saveDraftToHistory(prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;

  try {
    await promptHistoryService.addDraft(trimmed);
  } catch (error) {
    logger.error("[PromptHistory] Failed to save draft to history:", error);
  }
}
