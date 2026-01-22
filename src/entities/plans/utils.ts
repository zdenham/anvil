import { loadSettings } from "@/lib/persistence";
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

  const plansDirectory = settings.plansDirectory ?? 'plans/';
  // Ensure plansDirectory doesn't have trailing slash for clean path joining
  const cleanPlansDir = plansDirectory.replace(/\/$/, '');

  return `${worktree.path}/${cleanPlansDir}/${plan.relativePath}`;
}

/**
 * Resolve the absolute path for an archived (completed) plan.
 * The completed directory is typically `{basePath}/plans/completed/{relativePath}`.
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

  const completedDir = settings.completedDirectory ?? 'plans/completed/';
  // Ensure completedDir doesn't have trailing slash for clean path joining
  const cleanCompletedDir = completedDir.replace(/\/$/, '');

  return `${worktree.path}/${cleanCompletedDir}/${plan.relativePath}`;
}

/**
 * Get the display name for a plan (filename without extension).
 */
export function getPlanDisplayName(plan: PlanMetadata): string {
  const parts = plan.relativePath.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
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
