import { loadSettings } from "@/lib/app-data-store";
import { useRepoStore } from "@/entities/repositories";
import type { PlanMetadata } from "./types";
import type { RepositorySettings, WorktreeState } from "@/entities/repositories/types";

/**
 * Slugifies a repository name for use in paths.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Finds a worktree by ID within repository settings.
 */
function findWorktreeById(settings: RepositorySettings, worktreeId: string): WorktreeState | undefined {
  return settings.worktrees.find((w) => w.id === worktreeId);
}

/**
 * Finds a repository by its ID from the settings.
 * Note: We need to iterate through repos to find one matching the ID.
 */
async function findRepoByIdFromSettings(repoId: string): Promise<{ settings: RepositorySettings; slug: string } | undefined> {
  const repoNames = useRepoStore.getState().getRepositoryNames();

  for (const name of repoNames) {
    const slug = slugify(name);
    try {
      const settings = await loadSettings(slug);
      if (settings.id === repoId) {
        return { settings, slug };
      }
    } catch {
      // Skip repos that fail to load
      continue;
    }
  }

  return undefined;
}

/**
 * Resolve the absolute path for a plan.
 * Requires looking up the repo/worktree to get the base path.
 *
 * @throws Error if the repository or worktree cannot be found
 */
export async function resolvePlanPath(plan: PlanMetadata): Promise<string> {
  const result = await findRepoByIdFromSettings(plan.repoId);
  if (!result) {
    throw new Error(`Repository not found: ${plan.repoId}`);
  }

  const { settings } = result;
  const worktree = findWorktreeById(settings, plan.worktreeId);
  if (!worktree) {
    throw new Error(`Worktree not found: ${plan.worktreeId}`);
  }

  // relativePath is already relative to worktree root (e.g., "plans/hello-world.md")
  // so we just join worktree.path with relativePath directly
  return `${worktree.path}/${plan.relativePath}`;
}

/**
 * Resolve the absolute path for an archived (completed) plan.
 * Transforms the relativePath from plans/ to plans/completed/.
 *
 * Example: "plans/hello-world.md" -> "{worktree}/plans/completed/hello-world.md"
 *
 * @throws Error if the repository or worktree cannot be found
 */
export async function resolveCompletedPlanPath(plan: PlanMetadata): Promise<string> {
  const result = await findRepoByIdFromSettings(plan.repoId);
  if (!result) {
    throw new Error(`Repository not found: ${plan.repoId}`);
  }

  const { settings } = result;
  const worktree = findWorktreeById(settings, plan.worktreeId);
  if (!worktree) {
    throw new Error(`Worktree not found: ${plan.worktreeId}`);
  }

  const plansDir = settings.plansDirectory ?? 'plans/';
  const completedDir = settings.completedDirectory ?? 'plans/completed/';

  // Clean up trailing slashes
  const cleanPlansDir = plansDir.replace(/\/$/, '');
  const cleanCompletedDir = completedDir.replace(/\/$/, '');

  // relativePath is like "plans/hello-world.md", we need to replace "plans/" with "plans/completed/"
  // Strip the plansDir prefix and use completedDir instead
  let filename = plan.relativePath;
  if (filename.startsWith(cleanPlansDir + '/')) {
    filename = filename.slice(cleanPlansDir.length + 1);
  }

  return `${worktree.path}/${cleanCompletedDir}/${filename}`;
}

/**
 * Resolve the worktree path for a plan.
 * Returns the worktree directory path (without the relativePath appended).
 *
 * @throws Error if the repository or worktree cannot be found
 */
export async function resolveWorktreePath(plan: PlanMetadata): Promise<string> {
  const result = await findRepoByIdFromSettings(plan.repoId);
  if (!result) {
    throw new Error(`Repository not found: ${plan.repoId}`);
  }

  const { settings } = result;
  const worktree = findWorktreeById(settings, plan.worktreeId);
  if (!worktree) {
    throw new Error(`Worktree not found: ${plan.worktreeId}`);
  }

  return worktree.path;
}

/**
 * Get the display name for a plan (filename from relative path).
 */
export function getPlanDisplayName(plan: PlanMetadata): string {
  const parts = plan.relativePath.split('/');
  return parts[parts.length - 1];
}

/**
 * Get the parent directory path from a relative path.
 * Returns undefined if the path is at the root level.
 */
export function getParentPath(relativePath: string): string | undefined {
  const parts = relativePath.split('/');
  if (parts.length <= 1) return undefined;
  return parts.slice(0, -1).join('/');
}
