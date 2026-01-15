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
 * Threads are stored at ~/.mort/tasks/{taskSlug}/threads/{agentType}-{id}/
 *
 * This service ONLY:
 * - Creates thread metadata on disk
 * - Reads thread metadata
 * - Updates thread metadata
 * - Lists threads for a task
 *
 * It does NOT:
 * - Allocate worktrees
 * - Manage task metadata
 * - Emit events
 */
export class ThreadService {
  constructor(
    private mortDir: string,
    private fs: FileSystemAdapter
  ) {}

  /**
   * Create a new thread with initial metadata and first turn.
   * @param taskSlug - The slug of the parent task
   * @param input - Thread creation input
   * @returns The created thread metadata
   */
  create(taskSlug: string, input: CreateThreadInput): ThreadMetadata {
    const id = input.id ?? this.generateId();
    const folderName = getThreadFolderName(input.agentType, id);
    const threadDir = this.getThreadDir(taskSlug, folderName);

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
      taskId: input.taskId,
      agentType: input.agentType,
      workingDirectory: input.workingDirectory,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      git: input.git,
      isRead: false, // New threads start as unread since they're running
      pid: process.pid, // Write our own PID for cross-window cancellation
      turns: [initialTurn],
    };

    // Write metadata file
    this.writeMetadata(taskSlug, folderName, metadata);

    return metadata;
  }

  /**
   * Get thread metadata by task slug and folder name.
   * @param taskSlug - The slug of the parent task
   * @param folderName - The thread folder name (e.g., "execution-uuid")
   * @returns The thread metadata
   * @throws If thread does not exist
   */
  get(taskSlug: string, folderName: string): ThreadMetadata {
    const metadataPath = this.getMetadataPath(taskSlug, folderName);
    const content = this.fs.readFile(metadataPath);
    return ThreadMetadataSchema.parse(JSON.parse(content));
  }

  /**
   * Update thread metadata with partial updates.
   * @param taskSlug - The slug of the parent task
   * @param folderName - The thread folder name
   * @param updates - Partial updates to apply
   * @returns The updated thread metadata
   */
  update(
    taskSlug: string,
    folderName: string,
    updates: UpdateThreadInput
  ): ThreadMetadata {
    const metadata = this.get(taskSlug, folderName);
    const updated: ThreadMetadata = {
      ...metadata,
      ...updates,
      updatedAt: Date.now(),
    };

    this.writeMetadata(taskSlug, folderName, updated);
    return updated;
  }

  /**
   * Mark a thread as completed and finalize the current turn.
   * @param taskSlug - The slug of the parent task
   * @param folderName - The thread folder name
   * @param exitCode - Optional exit code for the turn
   * @returns The updated thread metadata
   */
  markCompleted(
    taskSlug: string,
    folderName: string,
    exitCode?: number
  ): ThreadMetadata {
    const metadata = this.get(taskSlug, folderName);
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

    return this.update(taskSlug, folderName, {
      status: 'completed',
      pid: null, // Clear PID - process is exiting
      turns,
    });
  }

  /**
   * Mark a thread as errored and finalize the current turn.
   * @param taskSlug - The slug of the parent task
   * @param folderName - The thread folder name
   * @param exitCode - Optional exit code for the turn
   * @returns The updated thread metadata
   */
  markError(
    taskSlug: string,
    folderName: string,
    exitCode?: number
  ): ThreadMetadata {
    const metadata = this.get(taskSlug, folderName);
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

    return this.update(taskSlug, folderName, {
      status: 'error',
      pid: null, // Clear PID - process is exiting
      turns,
    });
  }

  /**
   * Mark a thread as cancelled and finalize the current turn.
   * @param taskSlug - The slug of the parent task
   * @param folderName - The thread folder name
   * @param exitCode - Optional exit code for the turn (defaults to 130)
   * @returns The updated thread metadata
   */
  markCancelled(
    taskSlug: string,
    folderName: string,
    exitCode?: number
  ): ThreadMetadata {
    const metadata = this.get(taskSlug, folderName);
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

    return this.update(taskSlug, folderName, {
      status: 'cancelled',
      pid: null, // Clear PID - process is exiting
      turns,
    });
  }

  /**
   * Check if a thread exists.
   * @param taskSlug - The slug of the parent task
   * @param folderName - The thread folder name
   * @returns true if thread exists, false otherwise
   */
  exists(taskSlug: string, folderName: string): boolean {
    return this.fs.exists(this.getMetadataPath(taskSlug, folderName));
  }

  /**
   * List all thread folder names for a task.
   * @param taskSlug - The slug of the parent task
   * @returns Array of thread folder names
   */
  list(taskSlug: string): string[] {
    const threadsDir = path.join(this.mortDir, 'tasks', taskSlug, 'threads');
    if (!this.fs.exists(threadsDir)) {
      return [];
    }
    return this.fs.readDir(threadsDir).filter((name) => {
      return this.exists(taskSlug, name);
    });
  }

  private getThreadDir(taskSlug: string, folderName: string): string {
    return path.join(this.mortDir, 'tasks', taskSlug, 'threads', folderName);
  }

  private getMetadataPath(taskSlug: string, folderName: string): string {
    return path.join(this.getThreadDir(taskSlug, folderName), 'metadata.json');
  }

  private writeMetadata(
    taskSlug: string,
    folderName: string,
    metadata: ThreadMetadata
  ): void {
    const metadataPath = this.getMetadataPath(taskSlug, folderName);
    this.fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
