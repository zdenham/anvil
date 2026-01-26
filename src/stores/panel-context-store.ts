/**
 * Panel Context Store
 *
 * Stores the current panel/window context (NSPanel vs standalone window).
 * Initialized once at app startup based on URL params.
 */

import { create } from "zustand";

export interface PanelContext {
  /** Whether this is a standalone window (not NSPanel) */
  isStandaloneWindow: boolean;
  /** Instance ID for standalone windows (null for NSPanel) */
  instanceId: string | null;
}

interface PanelContextStore extends PanelContext {
  /** Initialize the store from URL params (call once at startup) */
  initialize: () => void;
}

export const usePanelContextStore = create<PanelContextStore>((set) => ({
  isStandaloneWindow: false,
  instanceId: null,

  initialize: () => {
    const searchParams = new URLSearchParams(window.location.search);
    const instanceId = searchParams.get("instanceId");
    const isStandaloneWindow = !!instanceId;

    set({ isStandaloneWindow, instanceId });
  },
}));

/**
 * Get the current panel context (non-reactive, for use outside React).
 */
export function getPanelContext(): PanelContext {
  const { isStandaloneWindow, instanceId } = usePanelContextStore.getState();
  return { isStandaloneWindow, instanceId };
}
