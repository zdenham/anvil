import * as path from 'path';
import type { FileSystemAdapter } from '@core/adapters/types';
import type { TaskMetadata, UpdateTaskInput } from '@core/types/tasks';
import { TaskMetadataSchema } from '@core/types/tasks';

/**
 * Service responsible for reading, updating, and listing task metadata.
 *
 * Single responsibility: CRUD operations on task metadata files.
 * Does NOT manage threads, worktrees, or validate repositories.
 */
export class TaskMetadataService {
  constructor(
    private mortDir: string,
    private fs: FileSystemAdapter
  ) {}

  /**
   * Get task metadata by slug.
   *
   * @param taskSlug - The task slug (directory name)
   * @returns The parsed TaskMetadata
   * @throws If metadata file does not exist or cannot be parsed
   */
  get(taskSlug: string): TaskMetadata {
    const metadataPath = this.getMetadataPath(taskSlug);
    const content = this.fs.readFile(metadataPath);
    return TaskMetadataSchema.parse(JSON.parse(content));
  }

  /**
   * Update task metadata with partial updates.
   * Automatically updates the updatedAt timestamp.
   *
   * @param taskSlug - The task slug (directory name)
   * @param updates - Partial updates to apply
   * @returns The updated TaskMetadata
   * @throws If metadata file does not exist
   */
  update(taskSlug: string, updates: UpdateTaskInput): TaskMetadata {
    const metadata = this.get(taskSlug);
    const updated: TaskMetadata = {
      ...metadata,
      ...updates,
      updatedAt: Date.now(),
    };

    const metadataPath = this.getMetadataPath(taskSlug);
    this.fs.writeFile(metadataPath, JSON.stringify(updated, null, 2));

    return updated;
  }

  /**
   * Check if a task exists by slug.
   *
   * @param taskSlug - The task slug (directory name)
   * @returns true if task metadata exists, false otherwise
   */
  exists(taskSlug: string): boolean {
    return this.fs.exists(this.getMetadataPath(taskSlug));
  }

  /**
   * List all task slugs that have valid metadata files.
   *
   * @returns Array of task slugs
   */
  list(): string[] {
    const tasksDir = path.join(this.mortDir, 'tasks');
    if (!this.fs.exists(tasksDir)) {
      return [];
    }
    return this.fs.readDir(tasksDir).filter(name => {
      return this.exists(name);
    });
  }

  private getMetadataPath(taskSlug: string): string {
    return path.join(this.mortDir, 'tasks', taskSlug, 'metadata.json');
  }
}
