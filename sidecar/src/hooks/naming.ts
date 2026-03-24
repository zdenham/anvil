/**
 * Fire-and-forget naming for TUI threads.
 *
 * Calls shared naming logic from core/lib/naming/ and writes the
 * generated name to metadata.json. Broadcasts the result to the
 * frontend via a WS push event so it can refresh the thread.
 */

import { generateThreadName } from "@core/lib/naming/thread-name.js";
import { generateWorktreeName } from "@core/lib/naming/worktree-name.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventBroadcaster } from "../push.js";
import type { SidecarLogger } from "../logger.js";

interface NamingDeps {
  dataDir: string;
  broadcaster: EventBroadcaster;
  log: SidecarLogger;
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    deps.log.warn("[naming] ANTHROPIC_API_KEY not set, skipping naming");
    return;
  }

  runNaming(threadId, prompt, apiKey, deps).catch((err) => {
    deps.log.warn(`[naming] Failed to name thread ${threadId}: ${err}`);
  });
}

async function runNaming(
  threadId: string,
  prompt: string,
  apiKey: string,
  deps: NamingDeps,
): Promise<void> {
  const [threadResult, worktreeResult] = await Promise.all([
    generateThreadName(prompt, apiKey),
    generateWorktreeName(prompt, apiKey),
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
