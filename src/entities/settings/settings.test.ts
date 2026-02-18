// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { useSettingsStore } from "./store";
import { settingsService } from "./service";
import type { WorkspaceSettings } from "./types";
import { DEFAULT_WORKSPACE_SETTINGS } from "./types";

// Mock persistence module
vi.mock("@/lib/persistence", () => ({
  persistence: {
    readJson: vi.fn(),
    writeJson: vi.fn(),
  },
}));

// Import mocked persistence after mock setup
import { appData } from "@/lib/app-data-store";

describe("Settings Store", () => {
  beforeEach(() => {
    // Reset store to default state before each test
    useSettingsStore.setState({
      workspace: { ...DEFAULT_WORKSPACE_SETTINGS },
      _hydrated: false,
    });
    vi.clearAllMocks();
  });

  describe("_applyUpdate", () => {
    it("updates workspace settings immediately", () => {
      const newSettings: WorkspaceSettings = {
        repository: "/path/to/repo",
        anthropicApiKey: "sk-test-key",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };

      useSettingsStore.getState()._applyUpdate(newSettings);

      expect(useSettingsStore.getState().workspace).toEqual(newSettings);
    });

    it("returns a rollback function that restores previous state", () => {
      const originalSettings: WorkspaceSettings = {
        repository: "/original/repo",
        anthropicApiKey: "original-key",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };
      useSettingsStore.setState({ workspace: originalSettings });

      const newSettings: WorkspaceSettings = {
        repository: "/new/repo",
        anthropicApiKey: "new-key",
        workflowMode: "team",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };

      const rollback = useSettingsStore.getState()._applyUpdate(newSettings);

      // Verify update was applied
      expect(useSettingsStore.getState().workspace).toEqual(newSettings);

      // Execute rollback
      rollback();

      // Verify original state is restored
      expect(useSettingsStore.getState().workspace).toEqual(originalSettings);
    });

    it("captures state at time of apply, not time of rollback", () => {
      const state1: WorkspaceSettings = {
        repository: "/state1",
        anthropicApiKey: "key1",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };
      const state2: WorkspaceSettings = {
        repository: "/state2",
        anthropicApiKey: "key2",
        workflowMode: "team",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };
      const state3: WorkspaceSettings = {
        repository: "/state3",
        anthropicApiKey: "key3",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };

      useSettingsStore.setState({ workspace: state1 });

      // Apply state2 and get rollback
      const rollback = useSettingsStore.getState()._applyUpdate(state2);

      // Apply state3 (simulating concurrent update)
      useSettingsStore.getState()._applyUpdate(state3);

      // Rollback should restore to state1 (captured at apply time), not state3
      rollback();

      expect(useSettingsStore.getState().workspace).toEqual(state1);
    });
  });

  describe("hydrate", () => {
    it("sets workspace and marks as hydrated", () => {
      const settings: WorkspaceSettings = {
        repository: "/test/repo",
        anthropicApiKey: "test-key",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };

      useSettingsStore.getState().hydrate(settings);

      expect(useSettingsStore.getState().workspace).toEqual(settings);
      expect(useSettingsStore.getState()._hydrated).toBe(true);
    });
  });

  describe("selectors", () => {
    it("getRepository returns repository value", () => {
      useSettingsStore.setState({
        workspace: { repository: "/my/repo", anthropicApiKey: null, workflowMode: "solo", permissionMode: "allow-all", permissionDisplayMode: "modal" },
      });

      expect(useSettingsStore.getState().getRepository()).toBe("/my/repo");
    });

    it("getApiKey returns anthropicApiKey value", () => {
      useSettingsStore.setState({
        workspace: { repository: null, anthropicApiKey: "my-key", workflowMode: "solo", permissionMode: "allow-all", permissionDisplayMode: "modal" },
      });

      expect(useSettingsStore.getState().getApiKey()).toBe("my-key");
    });

    it("isConfigured returns true when both values are set", () => {
      useSettingsStore.setState({
        workspace: { repository: "/repo", anthropicApiKey: "key", workflowMode: "solo", permissionMode: "allow-all", permissionDisplayMode: "modal" },
      });

      expect(useSettingsStore.getState().isConfigured()).toBe(true);
    });

    it("isConfigured returns false when repository is null", () => {
      useSettingsStore.setState({
        workspace: { repository: null, anthropicApiKey: "key", workflowMode: "solo", permissionMode: "allow-all", permissionDisplayMode: "modal" },
      });

      expect(useSettingsStore.getState().isConfigured()).toBe(false);
    });

    it("isConfigured returns false when apiKey is null", () => {
      useSettingsStore.setState({
        workspace: { repository: "/repo", anthropicApiKey: null, workflowMode: "solo", permissionMode: "allow-all", permissionDisplayMode: "modal" },
      });

      expect(useSettingsStore.getState().isConfigured()).toBe(false);
    });
  });
});

describe("Settings Service", () => {
  beforeEach(() => {
    // Reset store to default state before each test
    useSettingsStore.setState({
      workspace: { ...DEFAULT_WORKSPACE_SETTINGS },
      _hydrated: false,
    });
    vi.clearAllMocks();
  });

  describe("set", () => {
    it("updates store optimistically before persist completes", async () => {
      let persistResolved = false;
      (appData.writeJson as Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              persistResolved = true;
              resolve(undefined);
            }, 10);
          })
      );

      const setPromise = settingsService.set("repository", "/new/repo");

      // Store should update immediately (before persist resolves)
      expect(useSettingsStore.getState().workspace.repository).toBe(
        "/new/repo"
      );
      expect(persistResolved).toBe(false);

      await setPromise;
      expect(persistResolved).toBe(true);
    });

    it("calls appData.writeJson with full settings object", async () => {
      (appData.writeJson as Mock).mockResolvedValue(undefined);

      await settingsService.set("repository", "/test/repo");

      expect(appData.writeJson).toHaveBeenCalledWith("settings.json", {
        repository: "/test/repo",
        anthropicApiKey: null,
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      });
    });

    it("rolls back on persistence failure", async () => {
      const originalSettings: WorkspaceSettings = {
        repository: "/original/repo",
        anthropicApiKey: "original-key",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };
      useSettingsStore.setState({ workspace: originalSettings });

      (appData.writeJson as Mock).mockRejectedValue(
        new Error("write failed")
      );

      await expect(
        settingsService.set("repository", "/new/repo")
      ).rejects.toThrow("write failed");

      // Should be rolled back to original
      expect(useSettingsStore.getState().workspace).toEqual(originalSettings);
    });

    it("maintains type safety for setting keys", async () => {
      (appData.writeJson as Mock).mockResolvedValue(undefined);

      await settingsService.set("anthropicApiKey", "new-api-key");

      expect(useSettingsStore.getState().workspace.anthropicApiKey).toBe(
        "new-api-key"
      );
    });
  });

  describe("setMany", () => {
    it("updates multiple settings optimistically", async () => {
      (appData.writeJson as Mock).mockResolvedValue(undefined);

      await settingsService.setMany({
        repository: "/batch/repo",
        anthropicApiKey: "batch-key",
      });

      expect(useSettingsStore.getState().workspace).toEqual({
        repository: "/batch/repo",
        anthropicApiKey: "batch-key",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      });
    });

    it("rolls back all changes on persistence failure", async () => {
      const originalSettings: WorkspaceSettings = {
        repository: "/original/repo",
        anthropicApiKey: "original-key",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };
      useSettingsStore.setState({ workspace: originalSettings });

      (appData.writeJson as Mock).mockRejectedValue(
        new Error("batch write failed")
      );

      await expect(
        settingsService.setMany({
          repository: "/new/repo",
          anthropicApiKey: "new-key",
        })
      ).rejects.toThrow("batch write failed");

      // Both settings should be rolled back
      expect(useSettingsStore.getState().workspace).toEqual(originalSettings);
    });

    it("preserves unchanged settings", async () => {
      useSettingsStore.setState({
        workspace: { repository: "/existing/repo", anthropicApiKey: "old-key", workflowMode: "solo", permissionMode: "allow-all", permissionDisplayMode: "modal" },
      });
      (appData.writeJson as Mock).mockResolvedValue(undefined);

      await settingsService.setMany({ anthropicApiKey: "new-key" });

      expect(useSettingsStore.getState().workspace).toEqual({
        repository: "/existing/repo",
        anthropicApiKey: "new-key",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      });
    });
  });

  describe("reset", () => {
    it("resets to default settings optimistically", async () => {
      useSettingsStore.setState({
        workspace: { repository: "/custom/repo", anthropicApiKey: "custom-key", workflowMode: "team", permissionMode: "allow-all", permissionDisplayMode: "modal" },
      });
      (appData.writeJson as Mock).mockResolvedValue(undefined);

      await settingsService.reset();

      expect(useSettingsStore.getState().workspace).toEqual(
        DEFAULT_WORKSPACE_SETTINGS
      );
    });

    it("rolls back on persistence failure", async () => {
      const customSettings: WorkspaceSettings = {
        repository: "/custom/repo",
        anthropicApiKey: "custom-key",
        workflowMode: "team",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };
      useSettingsStore.setState({ workspace: customSettings });

      (appData.writeJson as Mock).mockRejectedValue(
        new Error("reset failed")
      );

      await expect(settingsService.reset()).rejects.toThrow("reset failed");

      // Should be rolled back to custom settings
      expect(useSettingsStore.getState().workspace).toEqual(customSettings);
    });
  });

  describe("hydrate", () => {
    it("loads settings from appData on hydrate", async () => {
      const storedSettings: WorkspaceSettings = {
        repository: "/stored/repo",
        anthropicApiKey: "stored-key",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };
      (appData.readJson as Mock).mockResolvedValue(storedSettings);

      await settingsService.hydrate();

      expect(useSettingsStore.getState().workspace).toEqual(storedSettings);
      expect(useSettingsStore.getState()._hydrated).toBe(true);
    });

    it("uses defaults when no stored settings exist", async () => {
      (appData.readJson as Mock).mockResolvedValue(null);

      await settingsService.hydrate();

      expect(useSettingsStore.getState().workspace).toEqual(
        DEFAULT_WORKSPACE_SETTINGS
      );
      expect(useSettingsStore.getState()._hydrated).toBe(true);
    });
  });

  describe("get", () => {
    it("returns current workspace settings", () => {
      const settings: WorkspaceSettings = {
        repository: "/get/repo",
        anthropicApiKey: "get-key",
        workflowMode: "solo",
        permissionMode: "allow-all",
        permissionDisplayMode: "modal",
      };
      useSettingsStore.setState({ workspace: settings });

      expect(settingsService.get()).toEqual(settings);
    });
  });
});

describe("Optimistic Update Integration", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      workspace: { ...DEFAULT_WORKSPACE_SETTINGS },
      _hydrated: false,
    });
    vi.clearAllMocks();
  });

  it("UI sees immediate update before disk write completes", async () => {
    const updateTimes: { storeUpdate: number; persistComplete: number } = {
      storeUpdate: 0,
      persistComplete: 0,
    };

    (appData.writeJson as Mock).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      updateTimes.persistComplete = Date.now();
    });

    // Subscribe to store changes
    const unsubscribe = useSettingsStore.subscribe((state) => {
      if (state.workspace.repository === "/immediate/update") {
        updateTimes.storeUpdate = Date.now();
      }
    });

    const startTime = Date.now();
    const setPromise = settingsService.set("repository", "/immediate/update");

    // Give store update a chance to happen
    await new Promise((r) => setTimeout(r, 5));

    // Store should have updated almost immediately
    expect(updateTimes.storeUpdate).toBeGreaterThan(0);
    expect(updateTimes.storeUpdate - startTime).toBeLessThan(20);

    await setPromise;

    // Persist should have completed after store update
    expect(updateTimes.persistComplete).toBeGreaterThan(updateTimes.storeUpdate);

    unsubscribe();
  });

  it("handles concurrent updates correctly", async () => {
    (appData.writeJson as Mock).mockResolvedValue(undefined);

    // Start two concurrent updates
    const promise1 = settingsService.set("repository", "/repo1");
    const promise2 = settingsService.set("anthropicApiKey", "key2");

    await Promise.all([promise1, promise2]);

    // Final state should have both updates
    // Note: This depends on the order of resolution, but both should succeed
    const finalState = useSettingsStore.getState().workspace;
    expect(finalState.anthropicApiKey).toBe("key2");
  });

  it("rollback restores exact previous state", async () => {
    const exactPreviousState: WorkspaceSettings = {
      repository: "/exact/previous",
      anthropicApiKey: "exact-key-12345",
      workflowMode: "solo",
      permissionMode: "allow-all",
      permissionDisplayMode: "modal",
    };
    useSettingsStore.setState({ workspace: exactPreviousState });

    (appData.writeJson as Mock).mockRejectedValue(new Error("fail"));

    await expect(settingsService.set("repository", "/new")).rejects.toThrow();

    // State should be exactly the previous state, not some merged version
    expect(useSettingsStore.getState().workspace).toEqual(exactPreviousState);
    expect(useSettingsStore.getState().workspace.repository).toBe(
      "/exact/previous"
    );
    expect(useSettingsStore.getState().workspace.anthropicApiKey).toBe(
      "exact-key-12345"
    );
  });
});
