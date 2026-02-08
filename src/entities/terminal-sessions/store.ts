import { create } from "zustand";
import type { TerminalSession } from "./types";
import { OUTPUT_BUFFER_MAX_LINES } from "./types";

interface TerminalSessionStoreState {
  /** All terminal sessions keyed by ID */
  sessions: Record<string, TerminalSession>;

  /** Cached array of all sessions (to prevent Object.values() recalculation) */
  _sessionsArray: TerminalSession[];

  /** Output buffers keyed by terminal ID (for scrollback when reopening) */
  outputBuffers: Record<string, string>;

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

  /** Append output to a terminal's buffer */
  appendOutput: (id: string, data: string) => void;

  /** Get the output buffer for a terminal */
  getOutputBuffer: (id: string) => string;

  /** Clear the output buffer for a terminal */
  clearOutputBuffer: (id: string) => void;
}

export const useTerminalSessionStore = create<
  TerminalSessionStoreState & TerminalSessionStoreActions
>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  sessions: {},
  _sessionsArray: [],
  outputBuffers: {},
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
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;

      // Mark as archived rather than removing from state
      // This allows the UI to show the archived state briefly before cleanup
      const updated = { ...existing, isArchived: true, isAlive: false };
      const newSessions = { ...state.sessions, [id]: updated };

      // Clean up output buffer
      const { [id]: _, ...restBuffers } = state.outputBuffers;

      return {
        sessions: newSessions,
        _sessionsArray: Object.values(newSessions).filter((s) => !s.isArchived),
        outputBuffers: restBuffers,
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

  appendOutput: (id, data) => {
    set((state) => {
      const existing = state.outputBuffers[id] || "";
      let newBuffer = existing + data;

      // Trim to max lines if needed
      const lines = newBuffer.split("\n");
      if (lines.length > OUTPUT_BUFFER_MAX_LINES) {
        newBuffer = lines.slice(-OUTPUT_BUFFER_MAX_LINES).join("\n");
      }

      return {
        outputBuffers: { ...state.outputBuffers, [id]: newBuffer },
      };
    });
  },

  getOutputBuffer: (id) => get().outputBuffers[id] || "",

  clearOutputBuffer: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.outputBuffers;
      return { outputBuffers: rest };
    });
  },
}));
