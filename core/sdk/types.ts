// ============================================================================
// SDK Type Definitions for Quick Actions
// ============================================================================
// These types define the context passed to actions and the services available
// via the SDK. Quick action scripts import these types for type safety.
// ============================================================================

// ============================================================================
// Context passed to quick action scripts
// ============================================================================

/**
 * The execution context passed to a quick action when it is invoked.
 * Contains information about the current state of the application.
 *
 * Named "ExecutionContext" to avoid collision with QuickActionContext enum.
 *
 * @remarks
 * The `contextType` is the runtime value indicating where the action was invoked.
 * It is always one of 'thread', 'plan', or 'empty' - never 'all'.
 * The 'all' value is only used in QuickActionDefinition.contexts as a registration shorthand.
 */
export interface QuickActionExecutionContext {
  /**
   * The context type where this action was invoked.
   * - 'thread': Action invoked from a thread view
   * - 'plan': Action invoked from a plan view
   * - 'empty': Action invoked from the empty state (no thread/plan selected)
   */
  contextType: 'thread' | 'plan' | 'empty';

  /** Current thread ID (if in thread context) */
  threadId?: string;

  /** Current plan ID (if in plan context) */
  planId?: string;

  /**
   * Active repository info.
   * May be null if no repository is currently active.
   */
  repository: {
    id: string;
    name: string;
    path: string;
  } | null;

  /**
   * Active worktree info.
   * May be null if no worktree is currently active.
   */
  worktree: {
    id: string;
    path: string;
    branch: string | null;
  } | null;

  /**
   * Current thread state (only present in thread context).
   * Provides additional information about the thread's current status.
   */
  threadState?: {
    status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
    messageCount: number;
    fileChanges: Array<{ path: string; operation: string }>;
  };
}

// ============================================================================
// SDK Services available to quick actions
// ============================================================================

/**
 * The main SDK object passed to quick actions.
 * Provides access to all available services for interacting with Mort.
 *
 * @example
 * ```typescript
 * export default defineAction({
 *   id: 'my-action',
 *   title: 'My Action',
 *   contexts: ['thread'],
 *   execute: async (context, sdk) => {
 *     const branch = await sdk.git.getCurrentBranch(context.worktree!.path);
 *     sdk.log.info('Current branch:', { branch });
 *   }
 * });
 * ```
 */
export interface MortSDK {
  /** Git operations service */
  git: GitService;

  /** Thread operations service */
  threads: ThreadService;

  /** Plan operations service */
  plans: PlanService;

  /** UI control service */
  ui: UIService;

  /** Logging service */
  log: LogService;
}

/**
 * Service for performing Git operations.
 * All operations are read-only and return information about the repository state.
 */
export interface GitService {
  /**
   * Get the current branch name for a worktree.
   * @param worktreePath - The path to the worktree
   * @returns The branch name, or null if in detached HEAD state
   */
  getCurrentBranch(worktreePath: string): Promise<string | null>;

  /**
   * Get the default branch for a repository (typically 'main' or 'master').
   * @param repoPath - The path to the repository
   * @returns The default branch name
   */
  getDefaultBranch(repoPath: string): Promise<string>;

  /**
   * Get the HEAD commit hash.
   * @param repoPath - The path to the repository
   * @returns The full commit hash of HEAD
   */
  getHeadCommit(repoPath: string): Promise<string>;

  /**
   * Check if a branch exists in the repository.
   * @param repoPath - The path to the repository
   * @param branch - The branch name to check
   * @returns True if the branch exists
   */
  branchExists(repoPath: string, branch: string): Promise<boolean>;

  /**
   * List all branches in the repository.
   * @param repoPath - The path to the repository
   * @returns Array of branch names
   */
  listBranches(repoPath: string): Promise<string[]>;

  /**
   * Get the diff from a base commit to HEAD.
   * @param repoPath - The path to the repository
   * @param baseCommit - The base commit hash to diff from
   * @returns The diff as a string
   */
  getDiff(repoPath: string, baseCommit: string): Promise<string>;
}

/**
 * Service for managing threads.
 * Provides read access to thread metadata and write operations for state changes.
 *
 * @remarks
 * Write operations (archive, markRead, markUnread) emit events to Mort
 * rather than writing directly to disk.
 */
export interface ThreadService {
  /**
   * Get thread metadata by ID.
   * @param threadId - The thread ID
   * @returns The thread info, or null if not found
   */
  get(threadId: string): Promise<ThreadInfo | null>;

  /**
   * List all threads across all repositories.
   * @returns Array of all thread info objects
   */
  list(): Promise<ThreadInfo[]>;

  /**
   * Get all threads for a specific repository.
   * @param repoId - The repository ID
   * @returns Array of thread info objects for the repository
   */
  getByRepo(repoId: string): Promise<ThreadInfo[]>;

  /**
   * Get all unread threads.
   * @returns Array of unread thread info objects
   */
  getUnread(): Promise<ThreadInfo[]>;

  /**
   * Archive a thread.
   * This emits an event to Mort which handles the actual archiving.
   * @param threadId - The thread ID to archive
   */
  archive(threadId: string): Promise<void>;

  /**
   * Mark a thread as read.
   * This emits an event to Mort which handles the state update.
   * @param threadId - The thread ID to mark as read
   */
  markRead(threadId: string): Promise<void>;

  /**
   * Mark a thread as unread.
   * This emits an event to Mort which handles the state update.
   * @param threadId - The thread ID to mark as unread
   */
  markUnread(threadId: string): Promise<void>;
}

/**
 * Thread information returned by the ThreadService.
 */
export interface ThreadInfo {
  /** Unique thread identifier */
  id: string;

  /** ID of the repository this thread belongs to */
  repoId: string;

  /** ID of the worktree this thread is associated with */
  worktreeId: string;

  /** Current status of the thread */
  status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

  /** Unix timestamp (milliseconds) when the thread was created */
  createdAt: number;

  /** Unix timestamp (milliseconds) when the thread was last updated */
  updatedAt: number;

  /** Whether the thread has been read */
  isRead: boolean;

  /** Number of turns (user prompts) in the thread */
  turnCount: number;
}

/**
 * Service for managing plans.
 * Provides read access to plan metadata and content, plus write operations.
 *
 * @remarks
 * Write operations (archive) emit events to Mort rather than writing directly to disk.
 */
export interface PlanService {
  /**
   * Get plan metadata by ID.
   * @param planId - The plan ID
   * @returns The plan info, or null if not found
   */
  get(planId: string): Promise<PlanInfo | null>;

  /**
   * List all plans across all repositories.
   * @returns Array of all plan info objects
   */
  list(): Promise<PlanInfo[]>;

  /**
   * Get all plans for a specific repository.
   * @param repoId - The repository ID
   * @returns Array of plan info objects for the repository
   */
  getByRepo(repoId: string): Promise<PlanInfo[]>;

  /**
   * Read the content of a plan (markdown).
   * @param planId - The plan ID
   * @returns The plan content as a markdown string
   */
  readContent(planId: string): Promise<string>;

  /**
   * Archive a plan.
   * This emits an event to Mort which handles the actual archiving.
   * @param planId - The plan ID to archive
   */
  archive(planId: string): Promise<void>;
}

/**
 * Plan information returned by the PlanService.
 */
export interface PlanInfo {
  /** Unique plan identifier */
  id: string;

  /** ID of the repository this plan belongs to */
  repoId: string;

  /** ID of the worktree this plan is associated with */
  worktreeId: string;

  /** Path to the plan file relative to the repository root */
  relativePath: string;

  /** Whether the plan has been read */
  isRead: boolean;

  /** Unix timestamp (milliseconds) when the plan was created */
  createdAt: number;

  /** Unix timestamp (milliseconds) when the plan was last updated */
  updatedAt: number;
}

/**
 * Service for controlling the UI.
 * Provides methods to manipulate the input field, navigate, and show notifications.
 */
export interface UIService {
  /**
   * Set the content of the input field, replacing any existing content.
   * @param content - The content to set
   */
  setInputContent(content: string): Promise<void>;

  /**
   * Append content to the input field after any existing content.
   * @param content - The content to append
   */
  appendInputContent(content: string): Promise<void>;

  /**
   * Clear the input field.
   */
  clearInput(): Promise<void>;

  /**
   * Focus the input field.
   */
  focusInput(): Promise<void>;

  /**
   * Navigate to a specific thread.
   * @param threadId - The thread ID to navigate to
   */
  navigateToThread(threadId: string): Promise<void>;

  /**
   * Navigate to a specific plan.
   * @param planId - The plan ID to navigate to
   */
  navigateToPlan(planId: string): Promise<void>;

  /**
   * Navigate to the next unread item (thread or plan).
   * If no unread items exist, navigates to the empty state (closes current view).
   */
  navigateToNextUnread(): Promise<void>;

  /**
   * Show a toast notification to the user.
   * @param message - The message to display
   * @param type - The type of toast: 'info', 'success', or 'error'. Defaults to 'info'.
   */
  showToast(message: string, type?: 'info' | 'success' | 'error'): Promise<void>;

  /**
   * Close the current panel and navigate to the empty state.
   */
  closePanel(): Promise<void>;
}

/**
 * Service for logging messages.
 * Log calls route to Mort's main logger for consistent logging across the application.
 */
export interface LogService {
  /**
   * Log an informational message.
   * @param message - The message to log
   * @param data - Optional structured data to include
   */
  info(message: string, data?: Record<string, unknown>): void;

  /**
   * Log a warning message.
   * @param message - The message to log
   * @param data - Optional structured data to include
   */
  warn(message: string, data?: Record<string, unknown>): void;

  /**
   * Log an error message.
   * @param message - The message to log
   * @param data - Optional structured data to include
   */
  error(message: string, data?: Record<string, unknown>): void;

  /**
   * Log a debug message.
   * Debug messages are only logged in development mode.
   * @param message - The message to log
   * @param data - Optional structured data to include
   */
  debug(message: string, data?: Record<string, unknown>): void;
}

// ============================================================================
// Quick Action Definition
// ============================================================================

/**
 * The function signature for a quick action's execute method.
 * Quick actions receive the execution context and SDK, and may return void or a Promise.
 */
export type QuickActionFn = (
  context: QuickActionExecutionContext,
  sdk: MortSDK
) => Promise<void> | void;

/**
 * The definition of a quick action.
 * This is the structure that quick action files export using defineAction().
 *
 * @remarks
 * The `contexts` array can include 'all' as a shorthand for ['thread', 'plan', 'empty'].
 * This is expanded at registration time - at runtime, the action will be invoked
 * with the actual context type ('thread', 'plan', or 'empty').
 *
 * @example
 * ```typescript
 * export default defineAction({
 *   id: 'archive-and-next',
 *   title: 'Archive & Next',
 *   description: 'Archive the current thread and navigate to the next unread',
 *   contexts: ['thread'],
 *   execute: async (context, sdk) => {
 *     await sdk.threads.archive(context.threadId!);
 *     await sdk.ui.navigateToNextUnread();
 *   }
 * });
 * ```
 */
export interface QuickActionDefinition {
  /**
   * Unique ID within the project (slug format, e.g., 'archive-and-next').
   * Used for invoking the action and in the manifest.
   */
  id: string;

  /** Display title shown in the UI */
  title: string;

  /** Optional description explaining what the action does */
  description?: string;

  /**
   * Contexts where this action is available.
   * - 'thread': Available when viewing a thread
   * - 'plan': Available when viewing a plan
   * - 'empty': Available when no thread/plan is selected
   * - 'all': Shorthand for ['thread', 'plan', 'empty']
   */
  contexts: ('thread' | 'plan' | 'empty' | 'all')[];

  /** The action implementation */
  execute: QuickActionFn;
}

/**
 * Helper function to define a quick action with full type safety.
 * Use this when exporting your quick action definition.
 *
 * @param def - The quick action definition
 * @returns The same definition, typed as QuickActionDefinition
 *
 * @example
 * ```typescript
 * import { defineAction } from '@mort/sdk';
 *
 * export default defineAction({
 *   id: 'hello-world',
 *   title: 'Hello World',
 *   contexts: ['all'],
 *   execute: (context, sdk) => {
 *     sdk.ui.showToast('Hello, World!', 'info');
 *   }
 * });
 * ```
 */
export function defineAction(def: QuickActionDefinition): QuickActionDefinition {
  return def;
}
