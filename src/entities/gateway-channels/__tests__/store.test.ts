// @vitest-environment node
/**
 * Gateway Channel Store Tests
 *
 * Tests for useGatewayChannelStore including:
 * - Hydration
 * - Selectors (getChannel, getChannelByRepoId, getActiveChannels, hasActiveChannels)
 * - Optimistic apply methods with rollback
 * - Connection status management
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useGatewayChannelStore } from "../store";
import type { GatewayChannelMetadata } from "../types";

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createChannelMetadata(
  overrides: Partial<GatewayChannelMetadata> = {},
): GatewayChannelMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: "github",
    label: "owner/repo",
    active: false,
    webhookUrl: "https://anvil-server.fly.dev/gateway/channels/test/events",
    repoId: crypto.randomUUID(),
    webhookId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("useGatewayChannelStore", () => {
  beforeEach(() => {
    useGatewayChannelStore.setState({
      channels: {},
      connectionStatus: "disconnected",
      _hydrated: false,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("hydrate", () => {
    it("populates channels correctly", () => {
      const ch1 = createChannelMetadata({ id: "ch-1" });
      const ch2 = createChannelMetadata({ id: "ch-2" });

      useGatewayChannelStore.getState().hydrate({
        "ch-1": ch1,
        "ch-2": ch2,
      });

      expect(useGatewayChannelStore.getState().channels["ch-1"]).toEqual(ch1);
      expect(useGatewayChannelStore.getState().channels["ch-2"]).toEqual(ch2);
      expect(useGatewayChannelStore.getState()._hydrated).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Selector Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("selectors", () => {
    it("getChannel returns channel by id", () => {
      const ch = createChannelMetadata({ id: "get-ch" });
      useGatewayChannelStore.getState()._applyCreate(ch);

      expect(useGatewayChannelStore.getState().getChannel("get-ch")).toEqual(ch);
    });

    it("getChannel returns undefined for non-existent channel", () => {
      expect(
        useGatewayChannelStore.getState().getChannel("nonexistent"),
      ).toBeUndefined();
    });

    it("getChannelByRepoId returns channel matching repoId", () => {
      const repoId = crypto.randomUUID();
      const ch = createChannelMetadata({ id: "repo-ch", repoId });
      useGatewayChannelStore.getState()._applyCreate(ch);

      const result =
        useGatewayChannelStore.getState().getChannelByRepoId(repoId);
      expect(result).toEqual(ch);
    });

    it("getChannelByRepoId returns undefined when no match", () => {
      const ch = createChannelMetadata();
      useGatewayChannelStore.getState()._applyCreate(ch);

      expect(
        useGatewayChannelStore.getState().getChannelByRepoId("no-match"),
      ).toBeUndefined();
    });

    it("getActiveChannels returns only active channels", () => {
      const active = createChannelMetadata({ id: "active-ch", active: true });
      const inactive = createChannelMetadata({
        id: "inactive-ch",
        active: false,
      });

      useGatewayChannelStore.getState()._applyCreate(active);
      useGatewayChannelStore.getState()._applyCreate(inactive);

      const result = useGatewayChannelStore.getState().getActiveChannels();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("active-ch");
    });

    it("hasActiveChannels returns true when active channels exist", () => {
      const ch = createChannelMetadata({ active: true });
      useGatewayChannelStore.getState()._applyCreate(ch);

      expect(useGatewayChannelStore.getState().hasActiveChannels()).toBe(true);
    });

    it("hasActiveChannels returns false when no active channels", () => {
      const ch = createChannelMetadata({ active: false });
      useGatewayChannelStore.getState()._applyCreate(ch);

      expect(useGatewayChannelStore.getState().hasActiveChannels()).toBe(false);
    });

    it("hasActiveChannels returns false when store is empty", () => {
      expect(useGatewayChannelStore.getState().hasActiveChannels()).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyCreate Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyCreate", () => {
    it("adds channel to store", () => {
      const ch = createChannelMetadata({ id: "new-ch" });

      useGatewayChannelStore.getState()._applyCreate(ch);

      expect(useGatewayChannelStore.getState().channels["new-ch"]).toEqual(ch);
    });

    it("returns rollback function that removes channel", () => {
      const ch = createChannelMetadata({ id: "rollback-ch" });

      const rollback = useGatewayChannelStore.getState()._applyCreate(ch);
      expect(
        useGatewayChannelStore.getState().channels["rollback-ch"],
      ).toBeDefined();

      rollback();
      expect(
        useGatewayChannelStore.getState().channels["rollback-ch"],
      ).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyUpdate Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyUpdate", () => {
    it("updates channel in store", () => {
      const ch = createChannelMetadata({ id: "update-ch", active: false });
      useGatewayChannelStore.getState()._applyCreate(ch);

      const updated = { ...ch, active: true };
      useGatewayChannelStore.getState()._applyUpdate("update-ch", updated);

      expect(
        useGatewayChannelStore.getState().channels["update-ch"].active,
      ).toBe(true);
    });

    it("returns rollback function that restores previous state", () => {
      const ch = createChannelMetadata({ id: "restore-ch", active: false });
      useGatewayChannelStore.getState()._applyCreate(ch);

      const updated = { ...ch, active: true };
      const rollback = useGatewayChannelStore
        .getState()
        ._applyUpdate("restore-ch", updated);

      expect(
        useGatewayChannelStore.getState().channels["restore-ch"].active,
      ).toBe(true);

      rollback();

      expect(
        useGatewayChannelStore.getState().channels["restore-ch"].active,
      ).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyDelete Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyDelete", () => {
    it("removes channel from store", () => {
      const ch = createChannelMetadata({ id: "delete-ch" });
      useGatewayChannelStore.getState()._applyCreate(ch);

      useGatewayChannelStore.getState()._applyDelete("delete-ch");

      expect(
        useGatewayChannelStore.getState().channels["delete-ch"],
      ).toBeUndefined();
    });

    it("returns rollback function that restores channel", () => {
      const ch = createChannelMetadata({ id: "restore-delete-ch" });
      useGatewayChannelStore.getState()._applyCreate(ch);

      const rollback = useGatewayChannelStore
        .getState()
        ._applyDelete("restore-delete-ch");

      expect(
        useGatewayChannelStore.getState().channels["restore-delete-ch"],
      ).toBeUndefined();

      rollback();

      expect(
        useGatewayChannelStore.getState().channels["restore-delete-ch"],
      ).toEqual(ch);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Connection Status Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("connection status", () => {
    it("setConnectionStatus updates status", () => {
      useGatewayChannelStore.getState().setConnectionStatus("connecting");
      expect(useGatewayChannelStore.getState().connectionStatus).toBe(
        "connecting",
      );

      useGatewayChannelStore.getState().setConnectionStatus("connected");
      expect(useGatewayChannelStore.getState().connectionStatus).toBe(
        "connected",
      );

      useGatewayChannelStore.getState().setConnectionStatus("disconnected");
      expect(useGatewayChannelStore.getState().connectionStatus).toBe(
        "disconnected",
      );
    });

    it("defaults to disconnected", () => {
      expect(useGatewayChannelStore.getState().connectionStatus).toBe(
        "disconnected",
      );
    });
  });
});
