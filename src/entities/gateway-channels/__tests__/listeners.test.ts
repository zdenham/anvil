// @vitest-environment node
/**
 * Gateway Channel Listeners Tests
 *
 * Tests for setupGatewayChannelListeners:
 * - GATEWAY_EVENT with github. prefix emits GITHUB_WEBHOOK_EVENT
 * - Non-github events are ignored
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Create mock event handlers storage
const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
const emittedEvents: Array<{ name: string; payload: unknown }> = [];

vi.mock("@/entities/events", () => ({
  eventBus: {
    emit: vi.fn((name: string, payload: unknown) => {
      emittedEvents.push({ name, payload });
    }),
    on: vi.fn(
      (eventName: string, handler: (...args: unknown[]) => void) => {
        if (!eventHandlers[eventName]) {
          eventHandlers[eventName] = [];
        }
        eventHandlers[eventName].push(handler);
      },
    ),
    off: vi.fn(
      (eventName: string, handler: (...args: unknown[]) => void) => {
        const handlers = eventHandlers[eventName];
        if (handlers) {
          const idx = handlers.indexOf(handler);
          if (idx !== -1) handlers.splice(idx, 1);
        }
      },
    ),
  },
}));

import { setupGatewayChannelListeners } from "../listeners";
import { EventName } from "@core/types/events.js";

function triggerEvent(eventName: string, payload: unknown) {
  const handlers = eventHandlers[eventName];
  if (handlers) {
    for (const handler of handlers) {
      handler(payload);
    }
  }
}

describe("setupGatewayChannelListeners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emittedEvents.length = 0;

    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }

    setupGatewayChannelListeners();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("routes github-prefixed GATEWAY_EVENT to GITHUB_WEBHOOK_EVENT", () => {
    const gatewayEvent = {
      id: crypto.randomUUID(),
      type: "github.pull_request",
      channelId: "ch-123",
      payload: { action: "opened", number: 42 },
      receivedAt: Date.now(),
    };

    triggerEvent(EventName.GATEWAY_EVENT, gatewayEvent);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].name).toBe(EventName.GITHUB_WEBHOOK_EVENT);
    expect(emittedEvents[0].payload).toEqual({
      channelId: "ch-123",
      githubEventType: "pull_request",
      payload: { action: "opened", number: 42 },
    });
  });

  it("routes github.issue_comment correctly", () => {
    const gatewayEvent = {
      id: crypto.randomUUID(),
      type: "github.issue_comment",
      channelId: "ch-456",
      payload: { action: "created", comment: { body: "LGTM" } },
      receivedAt: Date.now(),
    };

    triggerEvent(EventName.GATEWAY_EVENT, gatewayEvent);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].name).toBe(EventName.GITHUB_WEBHOOK_EVENT);
    expect(emittedEvents[0].payload).toEqual({
      channelId: "ch-456",
      githubEventType: "issue_comment",
      payload: { action: "created", comment: { body: "LGTM" } },
    });
  });

  it("ignores non-github events", () => {
    const gatewayEvent = {
      id: crypto.randomUUID(),
      type: "slack.message",
      channelId: "ch-789",
      payload: { text: "hello" },
      receivedAt: Date.now(),
    };

    triggerEvent(EventName.GATEWAY_EVENT, gatewayEvent);

    expect(emittedEvents).toHaveLength(0);
  });

  it("ignores events without github. prefix", () => {
    const gatewayEvent = {
      id: crypto.randomUUID(),
      type: "githubpull_request",
      channelId: "ch-000",
      payload: {},
      receivedAt: Date.now(),
    };

    triggerEvent(EventName.GATEWAY_EVENT, gatewayEvent);

    expect(emittedEvents).toHaveLength(0);
  });

  it("registers handler for GATEWAY_EVENT", () => {
    expect(eventHandlers[EventName.GATEWAY_EVENT]).toBeDefined();
    expect(eventHandlers[EventName.GATEWAY_EVENT]).toHaveLength(1);
  });
});
