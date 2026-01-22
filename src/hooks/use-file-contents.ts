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
    const fileChangesArray = Array.from(fileChanges.entries()).map(([path, change]) => ({
      path,
      operation: change.operation,
    }));

    logger.log("[useFileContents] ========== EFFECT TRIGGERED ==========");
    logger.log("[useFileContents] Input params:", {
      fileChangesSize: fileChanges.size,
      workingDirectory,
      workingDirectoryType: typeof workingDirectory,
      workingDirectoryLength: workingDirectory?.length ?? 0,
      pathsToLoad,
    });
    logger.log("[useFileContents] File changes detail:", fileChangesArray);

    // Nothing to load
    if (pathsToLoad.length === 0) {
      logger.log("[useFileContents] No files to load - fileChanges is empty");
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
      logger.log("[useFileContents] Starting async loadContents()");
      setLoading(true);
      setError(null);

      const newContents: Record<string, string[]> = {};

      for (const path of pathsToLoad) {
        if (cancelled) {
          logger.log(`[useFileContents] Cancelled before loading ${path}`);
          break;
        }

        const change = fileChanges.get(path);
        if (!change) {
          logger.warn(`[useFileContents] No change found for path: ${path}`);
          continue;
        }

        logger.log(`[useFileContents] Loading file: ${path}`, {
          operation: change.operation,
          workingDirectory,
        });

        try {
          let content: string;

          if (change.operation === "delete") {
            // Deleted file: get content from git HEAD
            logger.log(`[useFileContents] Fetching deleted file from git HEAD:`, {
              cwd: workingDirectory,
              path,
              ref: "HEAD",
            });
            content = await invoke<string>("git_show_file", {
              cwd: workingDirectory,
              path,
              ref: "HEAD",
            });
            logger.log(`[useFileContents] git_show_file returned:`, {
              path,
              contentLength: content?.length ?? 0,
              contentType: typeof content,
              preview: content?.substring(0, 200) ?? "(null/undefined)",
            });
          } else {
            // Added/modified/renamed: read from disk
            const fullPath = await join(workingDirectory, path);
            logger.log(`[useFileContents] Reading from disk:`, {
              workingDirectory,
              relativePath: path,
              fullPath,
            });
            content = await fsCommands.readFile(fullPath);
            logger.log(`[useFileContents] readTextFile returned:`, {
              path,
              fullPath,
              contentLength: content?.length ?? 0,
              contentType: typeof content,
              preview: content?.substring(0, 200) ?? "(null/undefined)",
            });
          }

          const lines = content.split("\n");
          newContents[path] = lines;
          logger.log(`[useFileContents] ✓ Successfully loaded ${path}:`, {
            lineCount: lines.length,
            firstLine: lines[0]?.substring(0, 100) ?? "(empty)",
            lastLine: lines[lines.length - 1]?.substring(0, 100) ?? "(empty)",
          });
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
        logger.log("[useFileContents] ========== LOAD COMPLETE ==========");
        logger.log("[useFileContents] Final results:", {
          loadedPaths: Object.keys(newContents),
          totalFiles: Object.keys(newContents).length,
          fileSummary: Object.entries(newContents).map(([p, lines]) => ({
            path: p,
            lineCount: lines.length,
            isEmpty: lines.length === 0,
          })),
        });
        setContents(newContents);
        setLoading(false);
      } else {
        logger.log("[useFileContents] Load was cancelled, not updating state");
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
      logger.log("[useFileContents] Cleanup: setting cancelled=true");
      cancelled = true;
    };
  }, [fileChanges, workingDirectory]);

  return { contents, loading, error };
}
