import { create } from "zustand";
import type { LogEntry } from "./types";

const MAX_LOGS = 2500;

interface LogState {
  logs: LogEntry[];
  /** Incremented on mutation — subscribe to this instead of `logs` to trigger re-renders. */
  logCount: number;
  _hydrated: boolean;
}

interface LogActions {
  hydrate: (logs: LogEntry[]) => void;
  addLogs: (entries: LogEntry[]) => void;
  clear: () => void;
}

export const useLogStore = create<LogState & LogActions>((set) => ({
  logs: [],
  logCount: 0,
  _hydrated: false,

  hydrate: (logs) => set({ logs, logCount: logs.length, _hydrated: true }),

  addLogs: (entries) =>
    set((state) => {
      state.logs.push(...entries);
      if (state.logs.length > MAX_LOGS) {
        state.logs.splice(0, state.logs.length - MAX_LOGS);
      }
      return { logCount: state.logs.length };
    }),

  clear: () => set({ logs: [], logCount: 0 }),
}));
