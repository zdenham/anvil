import { useState, useEffect } from "react";
import { join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { FileChange } from "@/lib/types/agent-messages";
import { logger } from "@/lib/logger-client";
import { fsCommands } from "@/lib/tauri-commands";

export interface UseFileContentsResult {
  /** File contents keyed by path (array of lines) */
  contents: Record<string, string[]>;
  /** Whether contents are being loaded */
  loading: boolean;
  /** Error message if loading failed */
  error: string | null;
}

/**
 * Hook to load file contents for all changed files.
 *
 * This hook loads file contents upfront to enable:
 * 1. Virtualization: All data available for windowed rendering
 * 2. Consistent UX: No loading spinners when expanding collapsed regions
 * 3. Simpler state management: No async operations in the diff viewer itself
 *
 * @param fileChanges - Map of file changes from the agent
 * @param workingDirectory - Working directory for the repository
 */
export function useFileContents(
  fileChanges: Map<string, FileChange>,
  workingDirectory: string
): UseFileContentsResult {
  const [contents, setContents] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pathsToLoad = Array.from(fileChanges.keys());
    // Nothing to load
    if (pathsToLoad.length === 0) {
      setContents({});
      setLoading(false);
      return;
    }

    if (!workingDirectory) {
      logger.error("[useFileContents] ERROR: workingDirectory is empty/falsy!", { workingDirectory });
      setError("Working directory not set");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadContents() {
      setLoading(true);
      setError(null);

      const newContents: Record<string, string[]> = {};

      for (const path of pathsToLoad) {
        if (cancelled) break;

        const change = fileChanges.get(path);
        if (!change) continue;

        try {
          let content: string;

          if (change.operation === "delete") {
            // Deleted file: get content from git HEAD
            content = await invoke<string>("git_show_file", {
              cwd: workingDirectory,
              path,
              gitRef: "HEAD",
            });
          } else {
            // Added/modified/renamed: read from disk
            const fullPath = await join(workingDirectory, path);
            content = await fsCommands.readFile(fullPath);
          }

          const lines = content.split("\n");
          newContents[path] = lines;
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorStack = err instanceof Error ? err.stack : undefined;
          logger.error(`[useFileContents] ✗ FAILED to load ${path}:`, {
            error: errorMessage,
            stack: errorStack,
            workingDirectory,
            path,
          });
          newContents[path] = []; // Empty array signals load failure
        }
      }

      if (!cancelled) {
        setContents(newContents);
        setLoading(false);
      }
    }

    loadContents().catch((err) => {
      logger.error("[useFileContents] loadContents() threw:", err);
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load files");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fileChanges, workingDirectory]);

  return { contents, loading, error };
}
