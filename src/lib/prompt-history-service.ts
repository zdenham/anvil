import { z } from "zod";
import { FilesystemClient } from "./filesystem-client";

const STORAGE_FILE = "prompt-history.json";
const MAX_ENTRIES = 100;

/**
 * Schema for a single prompt history entry.
 */
export const PromptHistoryEntrySchema = z.object({
  prompt: z.string(),
  timestamp: z.number(),
  taskId: z.string().optional(),
});
export type PromptHistoryEntry = z.infer<typeof PromptHistoryEntrySchema>;

/**
 * Schema for the prompt history data file.
 */
const PromptHistoryDataSchema = z.object({
  version: z.literal(1),
  entries: z.array(PromptHistoryEntrySchema),
});
type PromptHistoryData = z.infer<typeof PromptHistoryDataSchema>;

/**
 * Service for managing prompt history persistence.
 * Stores prompts in ~/.anvil-dev/prompt-history.json.
 */
export class PromptHistoryService {
  private fs: FilesystemClient;
  private storagePath: string | null = null;

  constructor(fs: FilesystemClient) {
    this.fs = fs;
  }

  private async getStoragePath(): Promise<string> {
    if (!this.storagePath) {
      const dataDir = await this.fs.getDataDir();
      this.storagePath = this.fs.joinPath(dataDir, STORAGE_FILE);
    }
    return this.storagePath;
  }

  private async load(): Promise<PromptHistoryData> {
    const path = await this.getStoragePath();

    if (!(await this.fs.exists(path))) {
      return { version: 1, entries: [] };
    }

    try {
      const raw = await this.fs.readJsonFile<unknown>(path);
      return PromptHistoryDataSchema.parse(raw);
    } catch {
      // Return empty data on validation failure - corrupted data is non-critical
      return { version: 1, entries: [] };
    }
  }

  private async save(data: PromptHistoryData): Promise<void> {
    const path = await this.getStoragePath();
    await this.fs.writeJsonFile(path, data);
  }

  /**
   * Add a prompt to history.
   * If the same prompt already exists, moves it to the front with updated timestamp.
   */
  async add(prompt: string, taskId?: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    const data = await this.load();

    // Remove existing entry with same prompt (deduplication)
    data.entries = data.entries.filter((e) => e.prompt !== trimmed);

    // Add new entry at the front (most recent first)
    data.entries.unshift({
      prompt: trimmed,
      timestamp: Date.now(),
      taskId,
    });

    // Trim to max entries
    if (data.entries.length > MAX_ENTRIES) {
      data.entries = data.entries.slice(0, MAX_ENTRIES);
    }

    await this.save(data);
  }

  /**
   * Get all entries, most recent first.
   */
  async getAll(): Promise<PromptHistoryEntry[]> {
    const data = await this.load();
    return data.entries;
  }

  /**
   * Get entry at index (0 = most recent).
   */
  async get(index: number): Promise<PromptHistoryEntry | null> {
    const data = await this.load();
    return data.entries[index] ?? null;
  }

  /**
   * Get total count of entries.
   */
  async count(): Promise<number> {
    const data = await this.load();
    return data.entries.length;
  }

  /**
   * Add a draft prompt to history (without taskId).
   * If the same prompt already exists, does nothing to avoid duplicates.
   */
  async addDraft(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // Check if prompt already exists to avoid duplicates
    if (await this.exists(trimmed)) {
      return;
    }

    const data = await this.load();

    // Add new draft entry at the front (most recent first)
    data.entries.unshift({
      prompt: trimmed,
      timestamp: Date.now(),
      // threadId is undefined for drafts (stored as taskId for backwards compatibility)
    });

    // Trim to max entries
    if (data.entries.length > MAX_ENTRIES) {
      data.entries = data.entries.slice(0, MAX_ENTRIES);
    }

    await this.save(data);
  }

  /**
   * Check if a prompt already exists in history.
   */
  async exists(prompt: string): Promise<boolean> {
    const trimmed = prompt.trim();
    if (!trimmed) return false;

    const data = await this.load();
    return data.entries.some((entry) => entry.prompt === trimmed);
  }
}

// Singleton instance
const filesystemClient = new FilesystemClient();
export const promptHistoryService = new PromptHistoryService(filesystemClient);
