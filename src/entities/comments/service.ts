// NOTE: Use crypto.randomUUID() -- no uuid package in this codebase
import { logger } from "@/lib/logger-client";
import { appData } from "@/lib/app-data-store";
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events.js";
import { CommentsFileSchema, type InlineComment } from "@core/types/comments.js";
import { useCommentStore } from "./store";

const RESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const UNRESOLVED_WARN_THRESHOLD = 200;

function commentsPath(worktreeId: string): string {
  return `comments/${worktreeId}.json`;
}

function archivePath(worktreeId: string): string {
  return `comments/${worktreeId}.archive.json`;
}

/** Separate stale resolved comments from active ones. */
function partitionStale(comments: InlineComment[]): {
  active: InlineComment[];
  stale: InlineComment[];
} {
  const cutoff = Date.now() - RESOLVED_TTL_MS;
  const active: InlineComment[] = [];
  const stale: InlineComment[] = [];
  for (const c of comments) {
    if (c.resolved && c.resolvedAt !== null && c.resolvedAt <= cutoff) {
      stale.push(c);
    } else {
      active.push(c);
    }
  }
  return { active, stale };
}

/** Append stale comments to the archive file (never loaded into store). */
async function appendToArchive(
  worktreeId: string,
  stale: InlineComment[],
): Promise<void> {
  const path = archivePath(worktreeId);
  const raw = await appData.readJson<unknown>(path);
  const parsed = raw ? CommentsFileSchema.safeParse(raw) : null;
  const existing = parsed?.success ? parsed.data.comments : [];
  await appData.writeJson(path, {
    version: 1,
    comments: [...existing, ...stale],
  });
}

/** Read-modify-write helper. Reads current file, applies mutation, writes back. */
async function readModifyWrite(
  worktreeId: string,
  mutate: (comments: InlineComment[]) => InlineComment[],
): Promise<void> {
  const path = commentsPath(worktreeId);
  const raw = await appData.readJson<unknown>(path);
  const parsed = raw ? CommentsFileSchema.safeParse(raw) : null;
  const existing = parsed?.success ? parsed.data.comments : [];
  const updated = mutate(existing);
  await appData.writeJson(path, { version: 1, comments: updated });
}

export const commentService = {
  /** Lazy-load comments for a worktree from disk. No-op if already hydrated. */
  async loadForWorktree(worktreeId: string): Promise<void> {
    if (useCommentStore.getState().isHydrated(worktreeId)) return;

    const raw = await appData.readJson<unknown>(commentsPath(worktreeId));
    if (!raw) {
      useCommentStore.getState().hydrate(worktreeId, []);
      return;
    }

    const parsed = CommentsFileSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("[CommentService] Invalid comments file, resetting", {
        worktreeId,
        error: parsed.error.message,
      });
      useCommentStore.getState().hydrate(worktreeId, []);
      return;
    }

    // Archive stale resolved comments to separate file
    const { active, stale } = partitionStale(parsed.data.comments);
    if (stale.length > 0) {
      await appendToArchive(worktreeId, stale);
      await appData.writeJson(commentsPath(worktreeId), {
        version: 1,
        comments: active,
      });
    }

    // Warn if unresolved count is high
    const unresolvedCount = active.filter((c) => !c.resolved).length;
    if (unresolvedCount >= UNRESOLVED_WARN_THRESHOLD) {
      logger.warn("[CommentService] High unresolved comment count", {
        worktreeId,
        unresolvedCount,
      });
    }

    useCommentStore.getState().hydrate(worktreeId, active);
  },

  async create(params: {
    worktreeId: string;
    filePath: string;
    lineNumber: number;
    lineType: InlineComment["lineType"];
    content: string;
    threadId?: string | null;
  }): Promise<InlineComment> {
    const now = Date.now();
    const comment: InlineComment = {
      id: crypto.randomUUID(),
      worktreeId: params.worktreeId,
      threadId: params.threadId ?? null,
      filePath: params.filePath,
      lineNumber: params.lineNumber,
      lineType: params.lineType,
      content: params.content,
      resolved: false,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const rollback = useCommentStore.getState()._applyAdd(comment);
    try {
      await readModifyWrite(params.worktreeId, (comments) => [
        ...comments,
        comment,
      ]);
      eventBus.emit(EventName.COMMENT_ADDED, {
        worktreeId: params.worktreeId,
        commentId: comment.id,
      });
    } catch (err) {
      rollback();
      throw err;
    }

    return comment;
  },

  async update(
    worktreeId: string,
    commentId: string,
    content: string,
  ): Promise<void> {
    const updates = { content, updatedAt: Date.now() };
    const rollback = useCommentStore.getState()._applyUpdate(commentId, updates);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.map((c) => (c.id === commentId ? { ...c, ...updates } : c)),
      );
      eventBus.emit(EventName.COMMENT_UPDATED, { worktreeId, commentId });
    } catch (err) {
      rollback();
      throw err;
    }
  },

  async resolve(worktreeId: string, commentId: string): Promise<void> {
    const updates = {
      resolved: true,
      resolvedAt: Date.now(),
      updatedAt: Date.now(),
    };
    const rollback = useCommentStore.getState()._applyUpdate(commentId, updates);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.map((c) => (c.id === commentId ? { ...c, ...updates } : c)),
      );
      eventBus.emit(EventName.COMMENT_RESOLVED, { worktreeId, commentId });
    } catch (err) {
      rollback();
      throw err;
    }
  },

  /** Called from COMMENT_RESOLVED listener only -- same as resolve() but does NOT
   *  re-emit the event (avoids circular event loop when agent triggers resolution). */
  async _resolveFromEvent(worktreeId: string, commentId: string): Promise<void> {
    const updates = {
      resolved: true,
      resolvedAt: Date.now(),
      updatedAt: Date.now(),
    };
    const rollback = useCommentStore.getState()._applyUpdate(commentId, updates);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.map((c) => (c.id === commentId ? { ...c, ...updates } : c)),
      );
    } catch (err) {
      rollback();
      throw err;
    }
  },

  async unresolve(worktreeId: string, commentId: string): Promise<void> {
    const updates = {
      resolved: false,
      resolvedAt: null,
      updatedAt: Date.now(),
    };
    const rollback = useCommentStore.getState()._applyUpdate(commentId, updates);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.map((c) => (c.id === commentId ? { ...c, ...updates } : c)),
      );
      eventBus.emit(EventName.COMMENT_UPDATED, { worktreeId, commentId });
    } catch (err) {
      rollback();
      throw err;
    }
  },

  async delete(worktreeId: string, commentId: string): Promise<void> {
    const rollback = useCommentStore.getState()._applyDelete(commentId);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.filter((c) => c.id !== commentId),
      );
      eventBus.emit(EventName.COMMENT_DELETED, { worktreeId, commentId });
    } catch (err) {
      rollback();
      throw err;
    }
  },

  /** Remove all comments for a worktree (called on worktree archive/delete). */
  async clearWorktree(worktreeId: string): Promise<void> {
    useCommentStore.getState()._applyClearWorktree(worktreeId);
    await appData.deleteFile(commentsPath(worktreeId));
    await appData.deleteFile(archivePath(worktreeId));
  },
};
