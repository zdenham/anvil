import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { getCurrentBranch, hasUncommittedChanges } from "../git.js";
import { logger } from "./logger.js";

import { TaskMetadataSchema, type TaskMetadata } from "../core/types.js";

// Re-export TaskMetadata as Task for backwards compatibility
export type Task = TaskMetadata;

export interface GitState {
  currentBranch: string;
  isDirty: boolean;
}

/**
 * Read all tasks from the workspace's .mort/tasks directory.
 * Returns tasks sorted by update time (most recent first).
 * Uses Zod validation to ensure task data integrity.
 */
export function readTasksDirectory(workspaceDir: string): Task[] {
  const tasksDir = join(workspaceDir, ".mort", "tasks");

  if (!existsSync(tasksDir)) {
    return [];
  }

  const files = readdirSync(tasksDir);
  const tasks: Task[] = [];

  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const filePath = join(tasksDir, file);
        const content = readFileSync(filePath, "utf-8");
        const raw = JSON.parse(content);

        // Validate with Zod schema
        const parseResult = TaskMetadataSchema.safeParse(raw);
        if (parseResult.success) {
          tasks.push(parseResult.data);
        } else {
          logger.error(
            `Failed to validate task file ${file}:`,
            parseResult.error.format()
          );
        }
      } catch (error) {
        // Skip malformed task files (JSON parse errors)
        logger.error(`Failed to read task file ${file}:`, error);
      }
    }
  }

  // Sort by updatedAt descending (most recent first)
  return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Get the current git state of the workspace.
 */
export function getGitState(workspaceDir: string): GitState {
  return {
    currentBranch: getCurrentBranch(workspaceDir),
    isDirty: hasUncommittedChanges(workspaceDir),
  };
}
