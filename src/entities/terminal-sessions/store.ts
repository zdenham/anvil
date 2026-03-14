import { create } from "zustand";
import type { TerminalSession } from "./types";
import type { Rollback } from "@/lib/optimistic";
import { destroyOutputBuffer } from "./output-buffer";

interface TerminalSessionStoreState {
  /** All terminal sessions keyed by ID */
  sessions: Record<string, TerminalSession>;

  /** Cached array of all sessions (to prevent Object.values() recalculation) */
  _sessionsArray: TerminalSession[];

  /** Whether the store has been hydrated */
  _hydrated: boolean;
}

interface TerminalSessionStoreActions {
  /** Add a new terminal session */
  addSession: (session: TerminalSession) => void;

  /** Update a terminal session */
  updateSession: (id: string, updates: Partial<TerminalSession>) => void;

  /** Remove a terminal session (archive) */
  removeSession: (id: string) => void;

  /** Mark a terminal as exited (still visible but not alive) */
  markExited: (id: string) => void;

  /** Get a session by ID */
  getSession: (id: string) => TerminalSession | undefined;

  /** Get all active (non-archived) sessions */
  getAllSessions: () => TerminalSession[];

  /** Get sessions by worktree ID */
  getSessionsByWorktree: (worktreeId: string) => TerminalSession[];

  /** Hydrate store from disk (called once at app start) */
  hydrate: (sessions: Record<string, TerminalSession>) => void;

  /** Optimistic apply methods - return rollback functions */
  _applyCreate: (session: TerminalSession) => Rollback;
  _applyUpdate: (id: string, updates: Partial<TerminalSession>) => Rollback;
  _applyDelete: (id: string) => Rollback;
}

export const useTerminalSessionStore = create<
  TerminalSessionStoreState & TerminalSessionStoreActions
>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  sessions: {},
  _sessionsArray: [],
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════════════════
  addSession: (session) => {
    set((state) => {
      const newSessions = { ...state.sessions, [session.id]: session };
      return {
        sessions: newSessions,
        _sessionsArray: Object.values(newSessions).filter((s) => !s.isArchived),
      };
    });
  },

  updateSession: (id, updates) => {
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;

      const updated = { ...existing, ...updates };
      const newSessions = { ...state.sessions, [id]: updated };
      return {
        sessions: newSessions,
        _sessionsArray: Object.values(newSessions).filter((s) => !s.isArchived),
      };
    });
  },

  removeSession: (id) => {
    // Clean up output buffer (outside Zustand — no subscriber overhead)
    destroyOutputBuffer(id);

    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;

      // Mark as archived rather than removing from state
      // This allows the UI to show the archived state briefly before cleanup
      const updated = { ...existing, isArchived: true, isAlive: false };
      const newSessions = { ...state.sessions, [id]: updated };

      return {
        sessions: newSessions,
        _sessionsArray: Object.values(newSessions).filter((s) => !s.isArchived),
      };
    });
  },

  markExited: (id) => {
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;

      const updated = { ...existing, isAlive: false };
      const newSessions = { ...state.sessions, [id]: updated };
      return {
        sessions: newSessions,
        _sessionsArray: Object.values(newSessions).filter((s) => !s.isArchived),
      };
    });
  },

  getSession: (id) => get().sessions[id],

  getAllSessions: () => get()._sessionsArray,

  getSessionsByWorktree: (worktreeId) =>
    get()._sessionsArray.filter((s) => s.worktreeId === worktreeId),

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (sessions) => {
    set({
      sessions,
      _sessionsArray: Object.values(sessions).filter((s) => !s.isArchived),
      _hydrated: true,
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════
  _applyCreate: (session: TerminalSession): Rollback => {
    set((state) => {
      const newSessions = { ...state.sessions, [session.id]: session };
      return {
        sessions: newSessions,
        _sessionsArray: Object.values(newSessions).filter((s) => !s.isArchived),
      };
    });
    return () =>
      set((state) => {
        const { [session.id]: _, ...rest } = state.sessions;
        return {
          sessions: rest,
          _sessionsArray: Object.values(rest).filter((s) => !s.isArchived),
        };
      });
  },

  _applyUpdate: (id: string, updates: Partial<TerminalSession>): Rollback => {
    const prev = get().sessions[id];
    if (!prev) return () => {};

    const updated = { ...prev, ...updates };
    set((state) => {
      const newSessions = { ...state.sessions, [id]: updated };
      return {
        sessions: newSessions,
        _sessionsArray: Object.values(newSessions).filter((s) => !s.isArchived),
      };
    });
    return () =>
      set((state) => {
        const restoredSessions = prev
          ? { ...state.sessions, [id]: prev }
          : state.sessions;
        return {
          sessions: restoredSessions,
          _sessionsArray: Object.values(restoredSessions).filter((s) => !s.isArchived),
        };
      });
  },

  _applyDelete: (id: string): Rollback => {
    const prev = get().sessions[id];
    if (!prev) return () => {};

    destroyOutputBuffer(id);
    set((state) => {
      const { [id]: _, ...rest } = state.sessions;
      return {
        sessions: rest,
        _sessionsArray: Object.values(rest).filter((s) => !s.isArchived),
      };
    });
    return () =>
      set((state) => {
        const restoredSessions = prev
          ? { ...state.sessions, [id]: prev }
          : state.sessions;
        return {
          sessions: restoredSessions,
          _sessionsArray: Object.values(restoredSessions).filter((s) => !s.isArchived),
        };
      });
  },
}));
