import * as path from 'path';
import type { FileSystemAdapter } from '@core/adapters/types';
import type { TaskMetadata } from '@core/types/tasks';

/**
 * Options for creating a draft task.
 */
export interface CreateDraftOptions {
  id: string;
  repositoryName: string;
  title: string;
  type?: "work" | "investigate";
}

/**
 * Convert a title to a URL-friendly slug.
 * Converts to lowercase, replaces non-alphanumeric with dashes,
 * trims leading/trailing dashes, and limits to 50 characters.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/**
 * Service responsible for creating draft tasks.
 *
 * Single responsibility: Creates new draft tasks on disk.
 * Does NOT manage threads, worktrees, or validate repositories.
 */
export class TaskDraftService {
  constructor(
    private mortDir: string,
    private fs: FileSystemAdapter
  ) {}

  /**
   * Create a new draft task with the given options.
   * Creates the task directory and metadata file.
   *
   * @param options - Task creation options (id, repositoryName, title, type)
   * @returns The created TaskMetadata
   */
  create(options: CreateDraftOptions): TaskMetadata {
    const slug = slugify(options.title);
    const taskDir = this.getTaskDir(slug);

    // Create task directory
    this.fs.mkdir(taskDir, { recursive: true });

    // Create metadata with all required fields
    const now = Date.now();
    const metadata: TaskMetadata = {
      id: options.id,
      slug,
      title: options.title,
      branchName: `task/${slug}`,
      type: options.type ?? "work",
      subtasks: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      parentId: null,
      tags: [],
      sortOrder: now,
      repositoryName: options.repositoryName,
      pendingReviews: [],
    };

    // Write metadata file
    const metadataPath = path.join(taskDir, 'metadata.json');
    this.fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    return metadata;
  }

  private getTaskDir(slug: string): string {
    return path.join(this.mortDir, 'tasks', slug);
  }
}
