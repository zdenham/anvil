import * as path from 'path';
import type { FileSystemAdapter } from '@core/adapters/types';
import type {
  ThreadMetadata,
  CreateThreadInput,
  UpdateThreadInput,
  ThreadTurn,
} from '@core/types/threads.js';
import { getThreadFolderName, ThreadMetadataSchema } from '@core/types/threads.js';

/**
 * Service for creating, reading, and updating thread metadata.
 * Threads are stored at ~/.mort/threads/{threadId}/
 *
 * This service ONLY:
 * - Creates thread metadata on disk
 * - Reads thread metadata
 * - Updates thread metadata
 * - Lists threads
 *
 * It does NOT:
 * - Allocate worktrees
 * - Emit events
 */
export class ThreadService {
  constructor(
    private mortDir: string,
    private fs: FileSystemAdapter
  ) {}

  /**
   * Create a new thread with initial metadata and first turn.
   * @param input - Thread creation input
   * @returns The created thread metadata
   */
  create(input: CreateThreadInput): ThreadMetadata {
    const id = input.id ?? this.generateId();
    const folderName = getThreadFolderName(id);
    const threadDir = this.getThreadDir(folderName);

    // Create thread directory
    this.fs.mkdir(threadDir, { recursive: true });

    // Create initial turn
    const now = Date.now();
    const initialTurn: ThreadTurn = {
      index: 0,
      prompt: input.prompt,
      startedAt: now,
      completedAt: null,
    };

    // Create metadata
    const metadata: ThreadMetadata = {
      id,
      repoId: input.repoId,
      worktreeId: input.worktreeId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      git: input.git,
      isRead: false, // New threads start as unread since they're running
      pid: process.pid, // Write our own PID for cross-window cancellation
      turns: [initialTurn],
    };

    // Write metadata file
    this.writeMetadata(folderName, metadata);

    return metadata;
  }

  /**
   * Get thread metadata by thread ID.
   * @param threadId - The thread ID
   * @returns The thread metadata
   * @throws If thread does not exist
   */
  get(threadId: string): ThreadMetadata {
    const folderName = getThreadFolderName(threadId);
    const metadataPath = this.getMetadataPath(folderName);
    const content = this.fs.readFile(metadataPath);
    return ThreadMetadataSchema.parse(JSON.parse(content));
  }

  /**
   * Update thread metadata with partial updates.
   * @param threadId - The thread ID
   * @param updates - Partial updates to apply
   * @returns The updated thread metadata
   */
  update(threadId: string, updates: UpdateThreadInput): ThreadMetadata {
    const metadata = this.get(threadId);
    const folderName = getThreadFolderName(threadId);

    const updated: ThreadMetadata = {
      ...metadata,
      ...updates,
      updatedAt: Date.now(),
    };

    this.writeMetadata(folderName, updated);
    return updated;
  }

  /**
   * Mark a thread as completed and finalize the current turn.
   * @param threadId - The thread ID
   * @param exitCode - Optional exit code for the turn
   * @returns The updated thread metadata
   */
  markCompleted(threadId: string, exitCode?: number): ThreadMetadata {
    const metadata = this.get(threadId);
    const turns = [...metadata.turns];

    // Complete the current turn if any
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1];
      if (lastTurn.completedAt === null) {
        turns[turns.length - 1] = {
          ...lastTurn,
          completedAt: Date.now(),
          exitCode,
        };
      }
    }

    return this.update(threadId, {
      status: 'completed',
      pid: null, // Clear PID - process is exiting
      turns,
    });
  }

  /**
   * Mark a thread as errored and finalize the current turn.
   * @param threadId - The thread ID
   * @param exitCode - Optional exit code for the turn
   * @returns The updated thread metadata
   */
  markError(threadId: string, exitCode?: number): ThreadMetadata {
    const metadata = this.get(threadId);
    const turns = [...metadata.turns];

    // Complete the current turn if any
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1];
      if (lastTurn.completedAt === null) {
        turns[turns.length - 1] = {
          ...lastTurn,
          completedAt: Date.now(),
          exitCode,
        };
      }
    }

    return this.update(threadId, {
      status: 'error',
      pid: null, // Clear PID - process is exiting
      turns,
    });
  }

  /**
   * Mark a thread as cancelled and finalize the current turn.
   * @param threadId - The thread ID
   * @param exitCode - Optional exit code for the turn (defaults to 130)
   * @returns The updated thread metadata
   */
  markCancelled(threadId: string, exitCode?: number): ThreadMetadata {
    const metadata = this.get(threadId);
    const turns = [...metadata.turns];

    // Complete the current turn if any
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1];
      if (lastTurn.completedAt === null) {
        turns[turns.length - 1] = {
          ...lastTurn,
          completedAt: Date.now(),
          exitCode: exitCode ?? 130, // Standard cancelled exit code (128 + SIGINT)
        };
      }
    }

    return this.update(threadId, {
      status: 'cancelled',
      pid: null, // Clear PID - process is exiting
      turns,
    });
  }

  /**
   * Check if a thread exists.
   * @param threadId - The thread ID
   * @returns true if thread exists, false otherwise
   */
  exists(threadId: string): boolean {
    const folderName = getThreadFolderName(threadId);
    return this.fs.exists(this.getMetadataPath(folderName));
  }

  /**
   * List all thread IDs.
   * @returns Array of thread IDs
   */
  list(): string[] {
    const threadsDir = path.join(this.mortDir, 'threads');
    if (!this.fs.exists(threadsDir)) {
      return [];
    }
    return this.fs.readDir(threadsDir).filter((name) => {
      return this.exists(name);
    });
  }

  private getThreadDir(folderName: string): string {
    return path.join(this.mortDir, 'threads', folderName);
  }

  private getMetadataPath(folderName: string): string {
    return path.join(this.getThreadDir(folderName), 'metadata.json');
  }

  private writeMetadata(folderName: string, metadata: ThreadMetadata): void {
    const metadataPath = this.getMetadataPath(folderName);
    this.fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
