import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { GatewayChannelMetadata } from "./types";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

interface GatewayChannelStoreState {
  channels: Record<string, GatewayChannelMetadata>;
  /** Gateway SSE connection status */
  connectionStatus: ConnectionStatus;
  _hydrated: boolean;
}

interface GatewayChannelStoreActions {
  /** Hydration (called once at app start) */
  hydrate: (channels: Record<string, GatewayChannelMetadata>) => void;

  /** Selectors */
  getChannel: (id: string) => GatewayChannelMetadata | undefined;
  getChannelByRepoId: (repoId: string) => GatewayChannelMetadata | undefined;
  getActiveChannels: () => GatewayChannelMetadata[];
  hasActiveChannels: () => boolean;

  /** Optimistic apply methods - return rollback functions */
  _applyCreate: (channel: GatewayChannelMetadata) => Rollback;
  _applyUpdate: (id: string, channel: GatewayChannelMetadata) => Rollback;
  _applyDelete: (id: string) => Rollback;

  /** Connection status */
  setConnectionStatus: (status: ConnectionStatus) => void;
}

export const useGatewayChannelStore = create<
  GatewayChannelStoreState & GatewayChannelStoreActions
>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  channels: {},
  connectionStatus: "disconnected",
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (channels) => {
    set({ channels, _hydrated: true });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Selectors
  // ═══════════════════════════════════════════════════════════════════════════
  getChannel: (id) => get().channels[id],

  getChannelByRepoId: (repoId) => {
    return Object.values(get().channels).find(
      (ch) => ch.repoId === repoId,
    );
  },

  getActiveChannels: () => {
    return Object.values(get().channels).filter((ch) => ch.active);
  },

  hasActiveChannels: () => {
    return Object.values(get().channels).some((ch) => ch.active);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════
  _applyCreate: (channel: GatewayChannelMetadata): Rollback => {
    set((state) => ({
      channels: { ...state.channels, [channel.id]: channel },
    }));
    return () =>
      set((state) => {
        const { [channel.id]: _, ...rest } = state.channels;
        return { channels: rest };
      });
  },

  _applyUpdate: (id: string, channel: GatewayChannelMetadata): Rollback => {
    const prev = get().channels[id];
    set((state) => ({
      channels: { ...state.channels, [id]: channel },
    }));
    return () =>
      set((state) => ({
        channels: prev
          ? { ...state.channels, [id]: prev }
          : state.channels,
      }));
  },

  _applyDelete: (id: string): Rollback => {
    const prev = get().channels[id];
    set((state) => {
      const { [id]: _, ...rest } = state.channels;
      return { channels: rest };
    });
    return () =>
      set((state) => ({
        channels: prev
          ? { ...state.channels, [id]: prev }
          : state.channels,
      }));
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Connection Status
  // ═══════════════════════════════════════════════════════════════════════════
  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },
}));
