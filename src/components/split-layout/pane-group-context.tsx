import { createContext, useContext, useCallback } from "react";
import { paneLayoutService } from "@/stores/pane-layout/service";
import { usePaneLayoutStore } from "@/stores/pane-layout";

interface PaneGroupContextValue {
  groupId: string;
  activate: () => void;
}

const PaneGroupCtx = createContext<PaneGroupContextValue | null>(null);

export function PaneGroupProvider({ groupId, children }: { groupId: string; children: React.ReactNode }) {
  const activate = useCallback(() => {
    const { activeGroupId } = usePaneLayoutStore.getState();
    if (activeGroupId !== groupId) {
      paneLayoutService.setActiveGroup(groupId);
    }
  }, [groupId]);

  return <PaneGroupCtx.Provider value={{ groupId, activate }}>{children}</PaneGroupCtx.Provider>;
}

export function usePaneGroup() {
  const ctx = useContext(PaneGroupCtx);
  if (!ctx) throw new Error("usePaneGroup must be used within PaneGroupProvider");
  return ctx;
}

/** Returns null outside a pane (e.g., sidebar). */
export function usePaneGroupMaybe() {
  return useContext(PaneGroupCtx);
}
