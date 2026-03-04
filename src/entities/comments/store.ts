import { create } from "zustand";
import type { InlineComment } from "@core/types/comments.js";
import type { Rollback } from "@/lib/optimistic";

interface CommentStoreState {
  comments: Record<string, InlineComment>; // keyed by comment.id
  _hydratedWorktrees: Set<string>;
}

interface CommentStoreActions {
  hydrate: (worktreeId: string, comments: InlineComment[]) => void;
  isHydrated: (worktreeId: string) => boolean;

  // Selectors -- all filter in-memory from the keyed record
  getByWorktree: (worktreeId: string) => InlineComment[];
  getByThread: (worktreeId: string, threadId: string) => InlineComment[];
  getByFile: (worktreeId: string, filePath: string, threadId?: string | null) => InlineComment[];
  getUnresolved: (worktreeId: string, threadId?: string | null) => InlineComment[];
  getUnresolvedCount: (worktreeId: string, threadId?: string | null) => number;

  // Optimistic mutations -- return rollback functions
  _applyAdd: (comment: InlineComment) => Rollback;
  _applyUpdate: (commentId: string, updates: Partial<InlineComment>) => Rollback;
  _applyDelete: (commentId: string) => Rollback;
  _applyClearWorktree: (worktreeId: string) => void;
}

export const useCommentStore = create<CommentStoreState & CommentStoreActions>(
  (set, get) => ({
    comments: {},
    _hydratedWorktrees: new Set(),

    hydrate: (worktreeId, comments) => {
      set((state) => {
        const filtered = Object.fromEntries(
          Object.entries(state.comments).filter(
            ([, c]) => c.worktreeId !== worktreeId,
          ),
        );
        const added = Object.fromEntries(comments.map((c) => [c.id, c]));
        const newHydrated = new Set(state._hydratedWorktrees);
        newHydrated.add(worktreeId);
        return {
          comments: { ...filtered, ...added },
          _hydratedWorktrees: newHydrated,
        };
      });
    },

    isHydrated: (worktreeId) => get()._hydratedWorktrees.has(worktreeId),

    getByWorktree: (worktreeId) =>
      Object.values(get().comments).filter((c) => c.worktreeId === worktreeId),

    getByThread: (worktreeId, threadId) =>
      Object.values(get().comments).filter(
        (c) => c.worktreeId === worktreeId && c.threadId === threadId,
      ),

    getByFile: (worktreeId, filePath, threadId) => {
      return Object.values(get().comments).filter((c) => {
        if (c.worktreeId !== worktreeId || c.filePath !== filePath) return false;
        if (threadId != null) return c.threadId === threadId;
        return true;
      });
    },

    getUnresolved: (worktreeId, threadId) =>
      Object.values(get().comments).filter((c) => {
        if (c.worktreeId !== worktreeId || c.resolved) return false;
        if (threadId != null) return c.threadId === threadId;
        return true;
      }),

    getUnresolvedCount: (worktreeId, threadId) =>
      get().getUnresolved(worktreeId, threadId).length,

    _applyAdd: (comment) => {
      set((state) => ({
        comments: { ...state.comments, [comment.id]: comment },
      }));
      return () =>
        set((state) => {
          const { [comment.id]: _, ...rest } = state.comments;
          return { comments: rest };
        });
    },

    _applyUpdate: (commentId, updates) => {
      const prev = get().comments[commentId];
      if (!prev) return () => {};
      set((state) => ({
        comments: {
          ...state.comments,
          [commentId]: { ...prev, ...updates },
        },
      }));
      return () =>
        set((state) => ({
          comments: { ...state.comments, [commentId]: prev },
        }));
    },

    _applyDelete: (commentId) => {
      const prev = get().comments[commentId];
      set((state) => {
        const { [commentId]: _, ...rest } = state.comments;
        return { comments: rest };
      });
      return () => {
        if (prev) {
          set((state) => ({
            comments: { ...state.comments, [commentId]: prev },
          }));
        }
      };
    },

    _applyClearWorktree: (worktreeId) => {
      set((state) => {
        const filtered = Object.fromEntries(
          Object.entries(state.comments).filter(
            ([, c]) => c.worktreeId !== worktreeId,
          ),
        );
        const newHydrated = new Set(state._hydratedWorktrees);
        newHydrated.delete(worktreeId);
        return { comments: filtered, _hydratedWorktrees: newHydrated };
      });
    },
  }),
);
