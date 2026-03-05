import { createContext, useContext, useMemo } from "react";

interface ThreadContextValue {
  threadId: string;
  workingDirectory: string;
}

const ThreadContext = createContext<ThreadContextValue | null>(null);

export function ThreadProvider({
  threadId,
  workingDirectory,
  children,
}: ThreadContextValue & { children: React.ReactNode }) {
  // Memoize the value to prevent re-renders when parent re-renders
  const value = useMemo(
    () => ({ threadId, workingDirectory }),
    [threadId, workingDirectory],
  );
  return (
    <ThreadContext.Provider value={value}>
      {children}
    </ThreadContext.Provider>
  );
}

export function useThreadContext(): ThreadContextValue {
  const ctx = useContext(ThreadContext);
  if (!ctx) throw new Error("useThreadContext must be used within ThreadProvider");
  return ctx;
}
