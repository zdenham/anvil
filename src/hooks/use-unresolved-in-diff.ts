import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCommentStore } from "@/entities/comments/store";
import { useChangesViewStore } from "@/stores/changes-view-store";

/**
 * Returns unresolved comments filtered to only files present in the current diff.
 * Falls back to all unresolved if no diff data is available.
 */
export function useUnresolvedInDiff(
  worktreeId: string,
  threadId?: string | null,
) {
  const changedFilePaths = useChangesViewStore((s) => s.changedFilePaths);

  const allUnresolved = useCommentStore(
    useShallow((s) => s.getUnresolved(worktreeId, threadId)),
  );

  const filtered = useMemo(
    () =>
      changedFilePaths.size > 0
        ? allUnresolved.filter((c) => changedFilePaths.has(c.filePath))
        : allUnresolved,
    [allUnresolved, changedFilePaths],
  );

  return filtered;
}
