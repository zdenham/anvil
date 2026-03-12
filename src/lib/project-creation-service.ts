import { open } from "@tauri-apps/plugin-dialog";
import { repoService } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { treeMenuService } from "@/stores/tree-menu/service";
import { logger } from "@/lib/logger-client";

/**
 * Opens the "Create New Project" flow:
 * 1. Folder picker for parent directory
 * 2. Prompt for project name
 * 3. git init + register
 *
 * Returns the project path on success, or null if cancelled.
 */
export async function createNewProject(): Promise<string | null> {
  const parentDir = await open({
    directory: true,
    multiple: false,
    title: "Choose where to create your project",
  });

  if (!parentDir || typeof parentDir !== "string") {
    return null;
  }

  const projectName = window.prompt("Enter a name for your new project:");
  if (!projectName?.trim()) {
    return null;
  }

  const name = projectName.trim();
  const projectPath = `${parentDir}/${name}`;

  await repoService.createProject(parentDir, name);
  logger.info(`[project-creation] Created new project at ${projectPath}`);

  return projectPath;
}

/**
 * Creates a new project and refreshes all stores.
 * Use this from the main window where stores need hydration after creation.
 */
export async function createNewProjectAndHydrate(): Promise<string | null> {
  const projectPath = await createNewProject();
  if (!projectPath) return null;

  await repoService.hydrate();

  const repos = repoService.getAll();
  await Promise.all(repos.map((repo) => worktreeService.sync(repo.name)));
  await useRepoWorktreeLookupStore.getState().hydrate();
  await treeMenuService.hydrate();

  return projectPath;
}
