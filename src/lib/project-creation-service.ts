import { open } from "@tauri-apps/plugin-dialog";
import { repoService } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { treeMenuService } from "@/stores/tree-menu/service";
import { logger } from "@/lib/logger-client";
import { toast } from "@/lib/toast";
import { requestNewProjectName } from "@/components/new-project-dialog";

/**
 * Opens the "Create New Project" flow:
 * 1. Modal dialog for project name
 * 2. Folder picker for parent directory
 * 3. git init + register
 *
 * Returns the project path on success, or null if cancelled/failed.
 */
export async function createNewProject(): Promise<string | null> {
  const name = await requestNewProjectName();
  if (!name) return null;

  const parentDir = await open({
    directory: true,
    multiple: false,
    title: `Choose where to create "${name}"`,
  });

  if (!parentDir || typeof parentDir !== "string") {
    return null;
  }

  const projectPath = `${parentDir}/${name}`;

  try {
    await repoService.createProject(parentDir, name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) {
      toast.error(`A folder named "${name}" already exists there`);
    } else if (message.includes("already registered")) {
      toast.error(`A project named "${name}" is already registered`);
    } else {
      toast.error("Failed to create project");
    }
    logger.error(`[project-creation] Failed to create project: ${message}`);
    return null;
  }

  logger.info(`[project-creation] Created new project at ${projectPath}`);
  toast.success(`Project created: ${name}`);
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
