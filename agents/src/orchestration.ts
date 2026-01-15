/**
 * Orchestration module for the Node runner.
 * Handles worktree allocation and thread creation without frontend involvement.
 */
import { NodeFileSystemAdapter } from '@core/adapters/node/fs-adapter.js';
import { NodeGitAdapter } from '@core/adapters/node/git-adapter.js';
import { NodePathLock } from '@core/adapters/node/path-lock.js';
import type { Logger } from '@core/adapters/types.js';
import { RepositorySettingsService } from '@core/services/repository/settings-service.js';
import { MergeBaseService } from '@core/services/git/merge-base-service.js';
import { TaskMetadataService } from '@core/services/task/metadata-service.js';
import { ThreadService } from '@core/services/thread/thread-service.js';
import { WorktreeAllocationService } from '@core/services/worktree/allocation-service.js';
import { BranchManager } from '@core/services/worktree/branch-manager.js';
import { WorktreePoolManager } from '@core/services/worktree/worktree-pool-manager.js';
import { getThreadFolderName } from '@core/types/threads.js';
import { events } from './lib/events.js';
import { logger } from './lib/logger.js';

/**
 * Adapter to convert the agents logger to the core Logger interface.
 */
function createLoggerAdapter(): Logger {
  return {
    info: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        logger.info(message, context);
      } else {
        logger.info(message);
      }
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        logger.warn(message, context);
      } else {
        logger.warn(message);
      }
    },
    error: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        logger.error(message, context);
      } else {
        logger.error(message);
      }
    },
    debug: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        logger.debug(message, context);
      } else {
        logger.debug(message);
      }
    },
  };
}

/**
 * Arguments required for orchestration.
 */
export interface RunnerArgs {
  agent: string;
  prompt: string;
  mortDir: string;
  taskSlug: string;
  threadId: string;
  /** If true, skip thread creation (thread already exists from prior run) */
  resume?: boolean;
}

/**
 * Result of successful orchestration.
 * Contains all information needed to run the agent.
 */
export interface OrchestrationResult {
  taskSlug: string;
  taskId: string;
  threadId: string;
  threadFolderName: string;
  cwd: string;
  mergeBase: string;
  repoName: string;
  branch: string;
}

/**
 * Orchestrate worktree allocation and thread creation.
 * This is the main entry point called by the runner.
 *
 * Workflow:
 * 1. Read task metadata from disk (frontend already created draft)
 * 2. Allocate a worktree for the thread
 * 3. Create the thread entity on disk
 * 4. Return orchestration result with cwd, mergeBase, etc.
 *
 * @param args - Runner arguments
 * @returns Orchestration result with allocated worktree info
 * @throws Error if task has no repositoryName
 * @throws Error if worktree allocation fails
 */
export function orchestrate(args: RunnerArgs): OrchestrationResult {
  // Create adapters (all sync)
  const fs = new NodeFileSystemAdapter();
  const git = new NodeGitAdapter();
  const pathLock = new NodePathLock();
  const loggerAdapter = createLoggerAdapter();

  // Create services
  const settingsService = new RepositorySettingsService(args.mortDir, fs);
  const mergeBaseService = new MergeBaseService(git);
  const taskMetadataService = new TaskMetadataService(args.mortDir, fs);
  const threadService = new ThreadService(args.mortDir, fs);
  const branchManager = new BranchManager(git, loggerAdapter);
  const poolManager = new WorktreePoolManager(git, args.mortDir);
  const allocationService = new WorktreeAllocationService(
    args.mortDir,
    settingsService,
    mergeBaseService,
    git,
    pathLock,
    branchManager,
    poolManager,
    loggerAdapter
  );

  // Read task metadata - frontend already created draft on disk
  const taskMeta = taskMetadataService.get(args.taskSlug);
  const repoName = taskMeta.repositoryName;

  if (!repoName) {
    throw new Error(`Task ${args.taskSlug} has no repositoryName`);
  }

  // Allocate worktree with task affinity and branch attachment
  const allocation = allocationService.allocate(repoName, args.threadId, {
    taskId: taskMeta.id,
    taskBranch: taskMeta.branchName,
  });

  // Use resolved branch (may differ from desired if collision occurred)
  const resolvedBranch = allocation.branch || taskMeta.branchName;

  logger.info('Worktree allocated', {
    worktreePath: allocation.worktree.path,
    mergeBase: allocation.mergeBase,
    desiredBranch: taskMeta.branchName,
    resolvedBranch,
    isResume: allocation.isResume,
  });

  events.worktreeAllocated(
    { path: allocation.worktree.path, currentBranch: allocation.worktree.currentBranch },
    allocation.mergeBase
  );

  // Create thread entity on disk (skip if resuming existing thread)
  if (!args.resume) {
    const thread = threadService.create(args.taskSlug, {
      id: args.threadId,
      taskId: taskMeta.id,
      agentType: args.agent,
      workingDirectory: allocation.worktree.path,
      prompt: args.prompt,
      git: {
        branch: resolvedBranch,
      },
    });
    events.threadCreated(thread.id, taskMeta.id);
  }

  const threadFolderName = getThreadFolderName(args.agent, args.threadId);

  return {
    taskSlug: args.taskSlug,
    taskId: taskMeta.id,
    threadId: args.threadId,
    threadFolderName,
    cwd: allocation.worktree.path,
    mergeBase: allocation.mergeBase,
    repoName,
    branch: resolvedBranch,
  };
}

/**
 * Setup cleanup handlers for graceful shutdown.
 * Releases the worktree claim when the process exits.
 *
 * @param mortDir - Path to .mort directory
 * @param repoName - Repository name for worktree release
 * @param threadId - Thread ID holding the claim
 */
export function setupCleanup(
  mortDir: string,
  repoName: string,
  threadId: string
): void {
  const cleanup = () => {
    try {
      const fs = new NodeFileSystemAdapter();
      const git = new NodeGitAdapter();
      const pathLock = new NodePathLock();
      const loggerAdapter = createLoggerAdapter();
      const settingsService = new RepositorySettingsService(mortDir, fs);
      const mergeBaseService = new MergeBaseService(git);
      const branchManager = new BranchManager(git, loggerAdapter);
      const poolManager = new WorktreePoolManager(git, mortDir);
      const allocationService = new WorktreeAllocationService(
        mortDir,
        settingsService,
        mergeBaseService,
        git,
        pathLock,
        branchManager,
        poolManager,
        loggerAdapter
      );

      allocationService.release(repoName, threadId);
      events.worktreeReleased(threadId);
    } catch {
      // Ignore cleanup errors - process is exiting anyway
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
}
