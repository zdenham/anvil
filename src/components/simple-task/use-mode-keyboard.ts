import { useCallback, useMemo } from "react";
import { useAgentModeStore } from "@/entities/agent-mode";
import type { AgentMode } from "@/entities/agent-mode";

interface UseModeKeyboardOptions {
  threadId: string;
  onModeChange?: (mode: AgentMode) => void;
  enabled?: boolean;
}

interface UseModeKeyboardReturn {
  handleKeyDown: (e: React.KeyboardEvent) => void;
  currentMode: AgentMode;
}

export function useModeKeyboard({
  threadId,
  onModeChange,
  enabled = true,
}: UseModeKeyboardOptions): UseModeKeyboardReturn {
  // NOTE: Selector stability - create stable selector to avoid unnecessary re-renders
  // The getMode function from store already handles the threadId lookup internally,
  // but we wrap it in useMemo to ensure the selector reference is stable
  const selectMode = useMemo(
    () => (s: ReturnType<typeof useAgentModeStore.getState>) => s.getMode(threadId),
    [threadId]
  );
  const currentMode = useAgentModeStore(selectMode);
  const cycleMode = useAgentModeStore((s) => s.cycleMode);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;

      // Only trigger on Shift+Tab without other modifiers
      const isShiftTabOnly =
        e.shiftKey && e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey;

      if (isShiftTabOnly) {
        e.preventDefault();
        const newMode = cycleMode(threadId);
        onModeChange?.(newMode);
      }
    },
    [enabled, threadId, cycleMode, onModeChange]
  );

  return { handleKeyDown, currentMode };
}
