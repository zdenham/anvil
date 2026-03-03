import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events.js";
import { useThreadStore } from "@/entities/threads/store";
import { commentService } from "./service";
import { useCommentStore } from "./store";

export function setupCommentListeners(): void {
  // Agent resolved a comment -- update disk + store.
  // Uses _resolveFromEvent (not commentService.resolve) to avoid re-emitting
  // COMMENT_RESOLVED and creating a circular event loop.
  eventBus.on(EventName.COMMENT_RESOLVED, async ({ worktreeId, commentId }) => {
    // Only process if this worktree is hydrated (we have the comment in store)
    if (!useCommentStore.getState().isHydrated(worktreeId)) return;
    // Skip if already resolved in store (prevent double-processing)
    const existing = useCommentStore.getState().comments[commentId];
    if (!existing || existing.resolved) return;
    await commentService._resolveFromEvent(worktreeId, commentId);
  });

  // Clean up comments when a worktree is released.
  // NOTE: WORKTREE_RELEASED payload is { threadId }, not { worktreeId }.
  // Look up the worktreeId from thread metadata before clearing.
  eventBus.on(EventName.WORKTREE_RELEASED, async ({ threadId }) => {
    const thread = useThreadStore.getState().threads[threadId];
    if (!thread?.worktreeId) return;
    await commentService.clearWorktree(thread.worktreeId);
  });
}
