import { create } from "zustand";
import type { LogEntry } from "./types";

const MAX_LOGS = 10000;

interface LogState {
  logs: LogEntry[];
  _hydrated: boolean;
}

interface LogActions {
  hydrate: (logs: LogEntry[]) => void;
  addLog: (entry: LogEntry) => void;
  addLogs: (entries: LogEntry[]) => void;
  clear: () => void;
}

export const useLogStore = create<LogState & LogActions>((set) => ({
  logs: [],
  _hydrated: false,

  hydrate: (logs) => set({ logs, _hydrated: true }),

  addLog: (entry) =>
    set((state) => {
      const newLogs = [...state.logs, entry];
      // Circular buffer: drop oldest if exceeding max
      if (newLogs.length > MAX_LOGS) {
        return { logs: newLogs.slice(-MAX_LOGS) };
      }
      return { logs: newLogs };
    }),

  addLogs: (entries) =>
    set((state) => {
      const newLogs = [...state.logs, ...entries];
      if (newLogs.length > MAX_LOGS) {
        return { logs: newLogs.slice(-MAX_LOGS) };
      }
      return { logs: newLogs };
    }),

  clear: () => set({ logs: [] }),
}));
