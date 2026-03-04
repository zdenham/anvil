import { useState, useEffect } from "react";
import { loadSettings } from "@/lib/app-data-store";
import { useRepoStore } from "@/entities/repositories";
import { deriveWorkingDirectory } from "@/entities/threads/utils";
import type { ThreadMetadata } from "@/entities/threads/types";
import { logger } from "@/lib/logger-client";

/**
 * Slugifies a repository name for use in paths.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Module-level cache to prevent flash on re-mount (e.g. virtualizer recycle) */
const resolvedCache = new Map<string, string>();

/**
 * Hook to derive the working directory for a thread.
 *
 * Asynchronously loads repository settings and derives the working directory
 * from the thread's worktreeId.
 *
 * @param thread - The thread metadata, or undefined if not yet loaded
 * @returns The working directory path, or empty string if not yet resolved
 */
export function useWorkingDirectory(thread: ThreadMetadata | undefined): string {
  const cacheKey = thread?.id ?? "";
  const [workingDirectory, setWorkingDirectory] = useState(
    () => resolvedCache.get(cacheKey) ?? ""
  );

  useEffect(() => {
    if (!thread) {
      setWorkingDirectory("");
      return;
    }

    const resolveWorkingDir = async () => {
      const repoNames = useRepoStore.getState().getRepositoryNames();

      for (const name of repoNames) {
        const slug = slugify(name);
        try {
          const settings = await loadSettings(slug);
          if (settings.id === thread.repoId) {
            const dir = deriveWorkingDirectory(thread, settings);
            resolvedCache.set(thread.id, dir);
            setWorkingDirectory(dir);
            return;
          }
        } catch (err) {
          // Skip repos that fail to load
          logger.debug(`[useWorkingDirectory] Failed to load settings for ${name}:`, err);
          continue;
        }
      }

      // Fallback: no matching repo found
      logger.warn(`[useWorkingDirectory] No repo found for repoId: ${thread.repoId}`);
      setWorkingDirectory("");
    };

    resolveWorkingDir();
  }, [thread?.id, thread?.repoId, thread?.worktreeId]);

  return workingDirectory;
}
