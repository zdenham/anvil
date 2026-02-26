/**
 * useSearch Hook
 *
 * Manages search state, debouncing, and parallel search execution
 * for both file grep and thread content search.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { searchCommands } from "@/lib/tauri-commands";
import { fsCommands } from "@/lib/tauri-commands";
import { logger } from "@/lib/logger-client";
import type { GrepMatch, ThreadContentMatch } from "@/lib/tauri-commands";
import type { FileGroup } from "./file-result-group";
import type { ThreadGroup } from "./thread-result-group";
import { threadService } from "@/entities/threads/service";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_EXCLUDES = ["archive", "*.lock", "dist", "build"];

export interface SearchState {
  query: string;
  fileGroups: FileGroup[];
  threadGroups: ThreadGroup[];
  isSearching: boolean;
  fileTruncated: boolean;
  threadTruncated: boolean;
  totalFileMatches: number;
}

export function useSearch(opts: {
  includeFiles: boolean;
  worktreePath: string;
  caseSensitive: boolean;
  includePatterns: string;
  excludePatterns: string;
}) {
  const { includeFiles, worktreePath, caseSensitive, includePatterns, excludePatterns } = opts;

  const [query, setQuery] = useState("");
  const [fileGroups, setFileGroups] = useState<FileGroup[]>([]);
  const [threadGroups, setThreadGroups] = useState<ThreadGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [fileTruncated, setFileTruncated] = useState(false);
  const [threadTruncated, setThreadTruncated] = useState(false);

  const requestCounter = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const mortDirRef = useRef<string>("");

  // Resolve mortDir once on mount
  useEffect(() => {
    fsCommands.getDataDir().then((dir) => {
      mortDirRef.current = dir;
    }).catch((err) => {
      logger.error("[useSearch] Failed to get data dir:", err);
    });
  }, []);

  const executeSearch = useCallback(async (q: string, counter: number) => {
    if (q.length < MIN_QUERY_LENGTH) {
      setFileGroups([]);
      setThreadGroups([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const parsedIncludes = parsePatterns(includePatterns);
    const parsedExcludes = parsePatterns(excludePatterns);
    const finalExcludes = parsedExcludes.length > 0 ? parsedExcludes : DEFAULT_EXCLUDES;

    const promises: Promise<void>[] = [];

    // Thread search (always runs)
    promises.push(
      searchCommands.searchThreads(mortDirRef.current, q, { caseSensitive })
        .then((res) => {
          if (requestCounter.current !== counter) return;
          setThreadTruncated(res.truncated);
          setThreadGroups(groupThreadResults(res.matches));
        })
        .catch((err) => {
          if (requestCounter.current !== counter) return;
          logger.error("[useSearch] Thread search failed:", err);
          setThreadGroups([]);
        })
    );

    // File search (only if checkbox is checked)
    if (includeFiles && worktreePath) {
      promises.push(
        searchCommands.grep(worktreePath, q, {
          caseSensitive,
          includePatterns: parsedIncludes.length > 0 ? parsedIncludes : undefined,
          excludePatterns: finalExcludes,
        })
          .then((res) => {
            if (requestCounter.current !== counter) return;
            setFileTruncated(res.truncated);
            setFileGroups(groupFileResults(res.matches));
          })
          .catch((err) => {
            if (requestCounter.current !== counter) return;
            logger.error("[useSearch] File search failed:", err);
            setFileGroups([]);
          })
      );
    } else {
      setFileGroups([]);
      setFileTruncated(false);
    }

    await Promise.allSettled(promises);
    if (requestCounter.current === counter) {
      setIsSearching(false);
    }
  }, [includeFiles, worktreePath, caseSensitive, includePatterns, excludePatterns]);

  // Debounced search trigger
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (query.length < MIN_QUERY_LENGTH) {
      setFileGroups([]);
      setThreadGroups([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const counter = ++requestCounter.current;

    debounceTimer.current = setTimeout(() => {
      executeSearch(query, counter);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, executeSearch]);

  const totalFileMatches = fileGroups.reduce((sum, g) => sum + g.matches.length, 0);

  return {
    query,
    setQuery,
    fileGroups,
    setFileGroups,
    threadGroups,
    setThreadGroups,
    isSearching,
    fileTruncated,
    threadTruncated,
    totalFileMatches,
  };
}

function parsePatterns(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isPlanPath(filePath: string): boolean {
  return filePath.startsWith("plans/") && filePath.endsWith(".md") && !filePath.startsWith("plans/completed/");
}

function groupFileResults(matches: GrepMatch[]): FileGroup[] {
  const map = new Map<string, GrepMatch[]>();
  for (const m of matches) {
    const existing = map.get(m.filePath);
    if (existing) {
      existing.push(m);
    } else {
      map.set(m.filePath, [m]);
    }
  }

  return Array.from(map.entries()).map(([filePath, fileMatches]) => ({
    filePath,
    matches: fileMatches,
    isPlan: isPlanPath(filePath),
    isCollapsed: fileMatches.length > 10,
  }));
}

function groupThreadResults(matches: ThreadContentMatch[]): ThreadGroup[] {
  const map = new Map<string, ThreadContentMatch[]>();
  for (const m of matches) {
    const existing = map.get(m.threadId);
    if (existing) {
      existing.push(m);
    } else {
      map.set(m.threadId, [m]);
    }
  }

  return Array.from(map.entries()).map(([threadId, threadMatches]) => {
    const thread = threadService.get(threadId);
    return {
      threadId,
      name: thread?.name ?? "Untitled Thread",
      matches: threadMatches,
      isCollapsed: threadMatches.length > 10,
    };
  });
}
