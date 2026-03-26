/**
 * Fire-and-forget naming for TUI threads.
 *
 * Calls shared naming logic from core/lib/naming/ and writes the
 * generated name to metadata.json. Broadcasts the result to the
 * frontend via a WS push event so it can refresh the thread.
 */

import { generateThreadName } from "@core/lib/naming/thread-name.js";
import { generateWorktreeName } from "@core/lib/naming/worktree-name.js";
import { createAnthropicLlmCaller } from "./sdk-caller.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirPath } from "../dispatch/paths.js";
import type { EventBroadcaster } from "../push.js";
import type { SidecarLogger } from "../logger.js";

interface NamingDeps {
  dataDir: string;
  broadcaster: EventBroadcaster;
  log: SidecarLogger;
}

/**
 * Reads the Anthropic API key from the workspace settings file on disk.
 * Returns undefined if not configured or auth method is not "api-key".
 */
function readApiKeyFromSettings(): string | undefined {
  try {
    const settingsPath = join(dataDirPath(), "settings.json");
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (raw.authMethod === "api-key" && typeof raw.anthropicApiKey === "string") {
      return raw.anthropicApiKey;
    }
  } catch {
    // Settings file missing or unreadable — fall through to env
  }
  return undefined;
}

/**
 * Initiate thread + worktree naming in the background.
 * Does not block — errors are logged and swallowed.
 */
export function initiateNaming(
  threadId: string,
  prompt: string,
  deps: NamingDeps,
): void {
  runNaming(threadId, prompt, deps).catch((err) => {
    deps.log.warn(`[naming] Failed to name thread ${threadId}: ${err}`);
  });
}

async function runNaming(
  threadId: string,
  prompt: string,
  deps: NamingDeps,
): Promise<void> {
  const apiKey = readApiKeyFromSettings();
  const llmCaller = createAnthropicLlmCaller(apiKey);

  const [threadResult, worktreeResult] = await Promise.all([
    generateThreadName(prompt, llmCaller),
    generateWorktreeName(prompt, llmCaller),
  ]);

  deps.log.info(
    `[naming] Generated names for ${threadId}: thread="${threadResult.name}", worktree="${worktreeResult.name}"`,
  );

  // Write name to metadata.json on disk (read-modify-write)
  updateMetadataName(threadId, threadResult.name, deps);

  // Broadcast to frontend so it refreshes the thread from disk
  deps.broadcaster.broadcast("tui-thread-named", {
    threadId,
    name: threadResult.name,
    worktreeName: worktreeResult.name,
  });
}

/**
 * Read-modify-write the thread's metadata.json to set the name field.
 */
function updateMetadataName(
  threadId: string,
  name: string,
  deps: NamingDeps,
): void {
  const metadataPath = join(deps.dataDir, "threads", threadId, "metadata.json");
  try {
    const raw = JSON.parse(readFileSync(metadataPath, "utf-8"));
    raw.name = name;
    raw.updatedAt = Date.now();
    writeFileSync(metadataPath, JSON.stringify(raw, null, 2));
  } catch (err) {
    deps.log.warn(`[naming] Failed to update metadata for ${threadId}: ${err}`);
  }
}
