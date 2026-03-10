import { eventBus } from "@/entities/events";
import { EventName, type EventPayloads } from "@core/types/events.js";
import { useThreadStore } from "@/entities/threads/store";
import { commentService } from "./service";
import { useCommentStore } from "./store";

export function setupCommentListeners(): () => void {
  const handleResolved = async ({ worktreeId, commentId }: EventPayloads[typeof EventName.COMMENT_RESOLVED]) => {
    if (!useCommentStore.getState().isHydrated(worktreeId)) return;
    const existing = useCommentStore.getState().comments[commentId];
    if (!existing || existing.resolved) return;
    await commentService._resolveFromEvent(worktreeId, commentId);
  };

  const handleReleased = async ({ threadId }: EventPayloads[typeof EventName.WORKTREE_RELEASED]) => {
    const thread = useThreadStore.getState().threads[threadId];
    if (!thread?.worktreeId) return;
    await commentService.clearWorktree(thread.worktreeId);
  };

  eventBus.on(EventName.COMMENT_RESOLVED, handleResolved);
  eventBus.on(EventName.WORKTREE_RELEASED, handleReleased);

  return () => {
    eventBus.off(EventName.COMMENT_RESOLVED, handleResolved);
    eventBus.off(EventName.WORKTREE_RELEASED, handleReleased);
  };
}
