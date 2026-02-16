import { useState, useCallback, useEffect, useRef } from "react";
import { FilesystemClient, type DirEntry } from "@/lib/filesystem-client";
import { fileWatcherClient } from "@/lib/file-watcher-client";
import { logger } from "@/lib/logger-client";
import { sortDirEntries } from "./dir-utils";

const fsClient = new FilesystemClient();

export interface FileTreeState {
  /** Children of the root directory (always visible) */
  rootChildren: DirEntry[];
  /** Set of expanded folder paths */
  expandedPaths: Set<string>;
  /** Cached children for each loaded directory */
  childrenCache: Map<string, DirEntry[]>;
  /** Paths currently being fetched */
  loadingPaths: Set<string>;
  /** Error message if root load failed */
  error: string | null;
  /** Toggle a folder expanded/collapsed */
  toggleFolder: (path: string) => void;
  /** Re-fetch all currently expanded directories */
  refreshAll: () => void;
}

/**
 * Hook managing expandable folder tree state.
 *
 * Loads root directory contents on mount and supports toggling
 * subdirectories open/closed. Integrates with the file watcher
 * to auto-refresh directories when their contents change.
 */
export function useFileTree(rootPath: string, worktreeId: string): FileTreeState {
  const [rootChildren, setRootChildren] = useState<DirEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = useState<Map<string, DirEntry[]>>(new Map());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Track mounted state to avoid updates after unmount
  const mountedRef = useRef(true);
  // Track watcher unlisteners for expanded directories
  const watcherUnlistenersRef = useRef<Map<string, () => void>>(new Map());

  // Reset everything when rootPath changes
  useEffect(() => {
    setExpandedPaths(new Set());
    setChildrenCache(new Map());
    setLoadingPaths(new Set());
    setError(null);
  }, [rootPath]);

  // Load root directory contents
  useEffect(() => {
    let cancelled = false;
    setError(null);

    fsClient
      .listDir(rootPath)
      .then((raw) => {
        if (cancelled) return;
        setRootChildren(sortDirEntries(raw));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error("[useFileTree] Failed to list root directory:", err);
        setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  // Fetch children for a single directory and cache them
  const fetchChildren = useCallback(
    async (dirPath: string) => {
      setLoadingPaths((prev) => new Set(prev).add(dirPath));
      try {
        const raw = await fsClient.listDir(dirPath);
        if (!mountedRef.current) return;
        const sorted = sortDirEntries(raw);
        setChildrenCache((prev) => new Map(prev).set(dirPath, sorted));
      } catch (err: unknown) {
        logger.warn("[useFileTree] Failed to list directory:", dirPath, err);
      } finally {
        if (mountedRef.current) {
          setLoadingPaths((prev) => {
            const next = new Set(prev);
            next.delete(dirPath);
            return next;
          });
        }
      }
    },
    []
  );

  // Start watching a directory for changes
  const startDirWatch = useCallback(
    (dirPath: string) => {
      const watchId = `file-tree-${worktreeId}-${dirPath}`;
      let unlisten: (() => void) | null = null;
      let tornDown = false;

      fileWatcherClient
        .startWatch(watchId, dirPath, false)
        .then(() => {
          if (tornDown) {
            fileWatcherClient.stopWatch(watchId);
            return;
          }
          return fileWatcherClient.onChanged(watchId, () => {
            fetchChildren(dirPath);
          });
        })
        .then((unlistenFn) => {
          if (unlistenFn) unlisten = unlistenFn;
        })
        .catch((err: unknown) => {
          logger.warn("[useFileTree] File watcher failed for:", dirPath, err);
        });

      // Return a teardown function
      const teardown = () => {
        tornDown = true;
        unlisten?.();
        fileWatcherClient.stopWatch(watchId);
      };
      watcherUnlistenersRef.current.set(dirPath, teardown);
    },
    [worktreeId, fetchChildren]
  );

  // Stop watching a directory
  const stopDirWatch = useCallback((dirPath: string) => {
    const teardown = watcherUnlistenersRef.current.get(dirPath);
    if (teardown) {
      teardown();
      watcherUnlistenersRef.current.delete(dirPath);
    }
  }, []);

  // Watch root directory
  useEffect(() => {
    const watchId = `file-tree-${worktreeId}-root`;
    let unlisten: (() => void) | null = null;
    let tornDown = false;

    fileWatcherClient
      .startWatch(watchId, rootPath, false)
      .then(() => {
        if (tornDown) {
          fileWatcherClient.stopWatch(watchId);
          return;
        }
        return fileWatcherClient.onChanged(watchId, () => {
          fsClient.listDir(rootPath).then((raw) => {
            if (!mountedRef.current) return;
            setRootChildren(sortDirEntries(raw));
          }).catch((err: unknown) => {
            logger.warn("[useFileTree] Root refresh failed:", err);
          });
        });
      })
      .then((unlistenFn) => {
        if (unlistenFn) unlisten = unlistenFn;
      })
      .catch((err: unknown) => {
        logger.warn("[useFileTree] Root watcher failed:", err);
      });

    return () => {
      tornDown = true;
      unlisten?.();
      fileWatcherClient.stopWatch(watchId);
    };
  }, [rootPath, worktreeId]);

  // Toggle a folder expanded/collapsed
  const toggleFolder = useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
          stopDirWatch(path);
        } else {
          next.add(path);
          // Fetch children if not cached, otherwise just expand
          if (!childrenCache.has(path)) {
            fetchChildren(path);
          }
          startDirWatch(path);
        }
        return next;
      });
    },
    [childrenCache, fetchChildren, startDirWatch, stopDirWatch]
  );

  // Refresh all expanded directories + root
  const refreshAll = useCallback(() => {
    fsClient
      .listDir(rootPath)
      .then((raw) => {
        if (!mountedRef.current) return;
        setRootChildren(sortDirEntries(raw));
      })
      .catch((err: unknown) => {
        logger.warn("[useFileTree] Root refresh failed:", err);
      });

    for (const dirPath of expandedPaths) {
      fetchChildren(dirPath);
    }
  }, [rootPath, expandedPaths, fetchChildren]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Stop all directory watchers
      for (const teardown of watcherUnlistenersRef.current.values()) {
        teardown();
      }
      watcherUnlistenersRef.current.clear();
    };
  }, []);

  return {
    rootChildren,
    expandedPaths,
    childrenCache,
    loadingPaths,
    error,
    toggleFolder,
    refreshAll,
  };
}
