/**
 * Hook providing panel navigation actions.
 * Reads from the Zustand store for reactive updates.
 */

import { usePanelContextStore } from "@/stores/panel-context-store";
import {
  closeCurrentPanelOrWindow,
  closeAndShowInbox,
  focusCurrentPanel,
  pinCurrentPanel,
} from "@/lib/panel-navigation";

export function usePanelNavigation() {
  const isStandaloneWindow = usePanelContextStore((s) => s.isStandaloneWindow);
  const instanceId = usePanelContextStore((s) => s.instanceId);

  return {
    close: closeCurrentPanelOrWindow,
    closeToInbox: closeAndShowInbox,
    focus: focusCurrentPanel,
    pin: pinCurrentPanel,
    isStandaloneWindow,
    instanceId,
  };
}
