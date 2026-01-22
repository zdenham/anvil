import { planService } from "../plans/service";
import { relationService } from "./service";
import { useThreadStore } from "../threads/store";
import { usePlanStore } from "../plans/store";
import { useRepoStore } from "../repositories/store";
import { loadSettings } from "@/lib/persistence";
import { logger } from "@/lib/logger-client";
import type { PlanMetadata } from "../plans/types";
import type { RepositorySettings } from "../repositories/types";

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
 * Finds a repository settings by its ID.
 * Note: We need to iterate through repos to find one matching the ID.
 */
async function findRepoSettingsById(repoId: string): Promise<RepositorySettings | undefined> {
  const repoNames = useRepoStore.getState().getRepositoryNames();

  for (const name of repoNames) {
    const slug = slugify(name);
    try {
      const settings = await loadSettings(slug);
      if (settings.id === repoId) {
        return settings;
      }
    } catch {
      // Skip repos that fail to load
      continue;
    }
  }

  return undefined;
}

class RelationDetector {
  /**
   * Called when a file is created/modified by a thread.
   * Checks if the file is a plan file and creates/upgrades the relation.
   */
  async onFileChange(
    threadId: string,
    filePath: string,
    changeType: 'created' | 'modified'
  ): Promise<void> {
    // Get the thread to find its repoId
    const thread = useThreadStore.getState().getThread(threadId);
    if (!thread) {
      logger.debug(`[relationDetector:onFileChange] Thread not found: ${threadId}`);
      return;
    }

    // Find the plan using relative path lookup
    const plan = await this.findPlanByAbsolutePath(thread.repoId, filePath);
    if (plan) {
      logger.debug(`[relationDetector:onFileChange] Found plan ${plan.id} for file ${filePath}, creating ${changeType} relation`);
      await relationService.createOrUpgrade({
        threadId,
        planId: plan.id,
        type: changeType,  // 'created' or 'modified'
      });
    }
  }

  /**
   * Called when user sends a message.
   * Detects plan references and creates 'mentioned' relations.
   */
  async onUserMessage(
    threadId: string,
    message: string
  ): Promise<void> {
    const thread = useThreadStore.getState().getThread(threadId);
    if (!thread) {
      logger.debug(`[relationDetector:onUserMessage] Thread not found: ${threadId}`);
      return;
    }

    const referencedPlans = await this.detectPlanReferences(thread.repoId, message);
    for (const plan of referencedPlans) {
      logger.debug(`[relationDetector:onUserMessage] Found plan reference ${plan.id} in message, creating mentioned relation`);
      await relationService.createOrUpgrade({
        threadId,
        planId: plan.id,
        type: 'mentioned',
      });
    }
  }

  /**
   * Find a plan by its absolute file path.
   * Converts the absolute path to a relative path and uses findByRelativePath.
   */
  private async findPlanByAbsolutePath(repoId: string, absolutePath: string): Promise<PlanMetadata | undefined> {
    // Get repository settings to find the plans directory
    const settings = await findRepoSettingsById(repoId);
    if (!settings) {
      logger.debug(`[relationDetector:findPlanByAbsolutePath] Repository settings not found for ${repoId}`);
      return undefined;
    }

    // Find the worktree that contains this file
    const worktree = settings.worktrees.find((w) => absolutePath.startsWith(w.path));
    if (!worktree) {
      logger.debug(`[relationDetector:findPlanByAbsolutePath] No matching worktree for ${absolutePath}`);
      return undefined;
    }

    // Get the plans directory (with proper path handling)
    const plansDir = settings.plansDirectory?.replace(/\/$/, '') ?? 'plans';
    const fullPlansDir = `${worktree.path}/${plansDir}`;

    // Check if the path is within the plans directory
    if (!absolutePath.startsWith(fullPlansDir)) {
      logger.debug(`[relationDetector:findPlanByAbsolutePath] File ${absolutePath} is not in plans directory ${fullPlansDir}`);
      return undefined;
    }

    // Extract the relative path
    const relativePath = absolutePath.slice(fullPlansDir.length).replace(/^\//, '');

    // Use the findByRelativePath method
    return planService.findByRelativePath(repoId, relativePath);
  }

  /**
   * Detect plan references in a message.
   * Looks for:
   * - Plan file paths (e.g., "plans/feature-x.md")
   * - Plan names mentioned in text
   */
  private async detectPlanReferences(repoId: string, message: string): Promise<PlanMetadata[]> {
    const allPlans = usePlanStore.getState().getByRepository(repoId);
    const referenced: PlanMetadata[] = [];

    for (const plan of allPlans) {
      // Check for relative path references
      if (plan.relativePath && message.includes(plan.relativePath)) {
        referenced.push(plan);
        continue;
      }

      // Check for plan filename (e.g., "feature-x.md")
      const filename = plan.relativePath?.split("/").pop();
      if (filename && message.includes(filename)) {
        referenced.push(plan);
      }
    }

    return referenced;
  }
}

export const relationDetector = new RelationDetector();
