/**
 * Result of resolving a task by ID.
 */
export interface TaskResolution {
  /** The task's unique ID (stable, never changes) */
  taskId: string;
  /** Current slug (directory name, may change on rename) */
  slug: string;
  /** Full path to task directory */
  taskDir: string;
  /** Git branch name for this task (null for simple tasks) */
  branchName: string | null;
}

/**
 * Result of resolving a thread by ID.
 */
export interface ThreadResolution {
  /** The thread's unique ID */
  threadId: string;
  /** Parent task's ID */
  taskId: string;
  /** Parent task's current slug */
  taskSlug: string;
  /** Full path to thread directory */
  threadDir: string;
  /** Agent type (e.g., "execution", "research") */
  agentType: string;
}
