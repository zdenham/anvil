import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { Rollback } from "@/lib/optimistic";
import type { WorkspaceSettings, WorkflowMode } from "./types";
import { DEFAULT_WORKSPACE_SETTINGS } from "./types";
import type { PermissionMode, PermissionDisplayMode } from "@core/types/permissions.js";
import { usePermissionStore } from "@/entities/permissions";

interface SettingsState {
  workspace: WorkspaceSettings;
  _hydrated: boolean;
}

interface SettingsActions {
  /** Hydration (called once at app start) */
  hydrate: (settings: WorkspaceSettings) => void;

  /** Selectors */
  getRepository: () => string | null;
  getApiKey: () => string | null;
  isConfigured: () => boolean;
  getWorkflowMode: () => WorkflowMode;
  getPermissionMode: () => PermissionMode;
  getPermissionDisplayMode: () => PermissionDisplayMode;
  getQuickActionsCollapsed: () => boolean;

  /** Optimistic apply methods - return rollback functions for use with optimistic() */
  _applyUpdate: (settings: WorkspaceSettings) => Rollback;
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  subscribeWithSelector((set, get) => ({
    // ═══════════════════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════════════════
    workspace: DEFAULT_WORKSPACE_SETTINGS,
    _hydrated: false,

    // ═══════════════════════════════════════════════════════════════════════════
    // Hydration
    // ═══════════════════════════════════════════════════════════════════════════
    hydrate: (settings) => {
      set({ workspace: settings, _hydrated: true });
      // Sync displayMode to permission store on initial load
      usePermissionStore.getState().setDisplayMode(settings.permissionDisplayMode);
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Selectors
    // ═══════════════════════════════════════════════════════════════════════════
    getRepository: () => get().workspace.repository,
    getApiKey: () => get().workspace.anthropicApiKey,
    isConfigured: () => {
      const { repository, anthropicApiKey } = get().workspace;
      return repository !== null && anthropicApiKey !== null;
    },
    getWorkflowMode: () => get().workspace.workflowMode ?? "solo",
    getPermissionMode: () => get().workspace.permissionMode ?? "allow-all",
    getPermissionDisplayMode: () => get().workspace.permissionDisplayMode ?? "modal",
    getQuickActionsCollapsed: () => get().workspace.quickActionsCollapsed ?? false,

    // ═══════════════════════════════════════════════════════════════════════════
    // Optimistic Apply Methods
    // ═══════════════════════════════════════════════════════════════════════════
    _applyUpdate: (settings: WorkspaceSettings): Rollback => {
      const prev = get().workspace;
      set({ workspace: settings });
      return () => set({ workspace: prev });
    },
  }))
);

// Sync displayMode to permission store when settings change
useSettingsStore.subscribe(
  (state) => state.workspace.permissionDisplayMode,
  (displayMode) => {
    usePermissionStore.getState().setDisplayMode(displayMode);
  }
);
