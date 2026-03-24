/**
 * Thread Disk Reader
 *
 * Reads thread state and metadata from disk on-demand.
 * Used by the event debugger to inspect raw disk state
 * without going through the Zustand store.
 *
 * Uses fsCommands (Rust backend) for all filesystem access.
 * Do NOT use @tauri-apps/plugin-fs — it is not configured.
 */

import { fsCommands } from "@/lib/tauri-commands";
import { logger } from "@/lib/logger-client";

export interface ThreadDiskSnapshot {
  metadata: Record<string, unknown> | null;
  state: Record<string, unknown> | null;
}

/**
 * Reads thread metadata and state from disk.
 *
 * Thread data lives at: ~/.anvil/threads/{threadId}/
 *   - metadata.json: thread metadata (name, status, turns, etc.)
 *   - state.json: full thread state (messages, file changes, tool states)
 *
 * @param threadId - The thread UUID to read
 * @returns Parsed metadata and state, with null for missing files
 */
export async function readThreadFromDisk(
  threadId: string,
): Promise<ThreadDiskSnapshot> {
  const dataDir = await fsCommands.getDataDir();
  const threadDir = `${dataDir}/threads/${threadId}`;

  const [metadata, state] = await Promise.all([
    readJsonFile(`${threadDir}/metadata.json`),
    readJsonFile(`${threadDir}/state.json`),
  ]);

  return { metadata, state };
}

/**
 * Reads and parses a JSON file, returning null if missing or invalid.
 */
async function readJsonFile(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const exists = await fsCommands.pathExists(path);
    if (!exists) return null;

    const content = await fsCommands.readFile(path);
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    logger.warn(`[thread-disk-reader] Failed to read ${path}:`, err);
    return null;
  }
}
