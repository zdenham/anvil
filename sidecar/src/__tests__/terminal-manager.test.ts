/**
 * TerminalManager unit tests.
 *
 * Tests PTY session lifecycle: spawn, write, resize, kill, killByCwd, dispose.
 * Uses real node-pty processes with short timeouts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalManager } from "../managers/terminal-manager.js";
import { EventBroadcaster } from "../push.js";

function createBroadcaster(): EventBroadcaster & {
  events: { event: string; payload: unknown }[];
} {
  const broadcaster = new EventBroadcaster();
  const events: { event: string; payload: unknown }[] = [];
  broadcaster.subscribe(({ event, payload }) => {
    events.push({ event, payload });
  });
  return Object.assign(broadcaster, { events });
}

describe("TerminalManager", () => {
  let manager: TerminalManager;
  let broadcaster: ReturnType<typeof createBroadcaster>;

  afterEach(() => {
    manager?.dispose();
  });

  it("spawn returns incrementing IDs", () => {
    manager = new TerminalManager();
    broadcaster = createBroadcaster();

    const id1 = manager.spawn(80, 24, "/tmp", broadcaster);
    const id2 = manager.spawn(80, 24, "/tmp", broadcaster);

    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });

  it("list returns active session IDs", () => {
    manager = new TerminalManager();
    broadcaster = createBroadcaster();

    manager.spawn(80, 24, "/tmp", broadcaster);
    manager.spawn(80, 24, "/tmp", broadcaster);

    expect(manager.list()).toEqual([1, 2]);
  });

  it("write to valid session succeeds", () => {
    manager = new TerminalManager();
    broadcaster = createBroadcaster();

    const id = manager.spawn(80, 24, "/tmp", broadcaster);
    expect(() => manager.write(id, "echo hi\n")).not.toThrow();
  });

  it("write to invalid session throws", () => {
    manager = new TerminalManager();

    expect(() => manager.write(999, "data")).toThrow(
      "Terminal session 999 not found",
    );
  });

  it("resize valid session succeeds", () => {
    manager = new TerminalManager();
    broadcaster = createBroadcaster();

    const id = manager.spawn(80, 24, "/tmp", broadcaster);
    expect(() => manager.resize(id, 120, 40)).not.toThrow();
  });

  it("resize invalid session throws", () => {
    manager = new TerminalManager();

    expect(() => manager.resize(999, 120, 40)).toThrow(
      "Terminal session 999 not found",
    );
  });

  it("kill removes session and broadcasts terminal:killed", () => {
    manager = new TerminalManager();
    broadcaster = createBroadcaster();

    const id = manager.spawn(80, 24, "/tmp", broadcaster);
    manager.kill(id, broadcaster);

    expect(manager.list()).toEqual([]);
    expect(broadcaster.events).toContainEqual({
      event: "terminal:killed",
      payload: { id },
    });
  });

  it("kill invalid session throws", () => {
    manager = new TerminalManager();
    broadcaster = createBroadcaster();

    expect(() => manager.kill(999, broadcaster)).toThrow(
      "Terminal session 999 not found",
    );
  });

  it("killByCwd only kills matching sessions", () => {
    manager = new TerminalManager();
    broadcaster = createBroadcaster();

    manager.spawn(80, 24, "/tmp", broadcaster);
    manager.spawn(80, 24, "/var", broadcaster);
    manager.spawn(80, 24, "/tmp", broadcaster);

    const killed = manager.killByCwd("/tmp", broadcaster);

    expect(killed).toEqual([1, 3]);
    expect(manager.list()).toEqual([2]);
  });

  it("dispose kills all sessions", () => {
    manager = new TerminalManager();
    broadcaster = createBroadcaster();

    manager.spawn(80, 24, "/tmp", broadcaster);
    manager.spawn(80, 24, "/tmp", broadcaster);

    manager.dispose();

    expect(manager.list()).toEqual([]);
  });

  it("spawn broadcasts terminal:output on PTY data", async () => {
    manager = new TerminalManager();
    broadcaster = createBroadcaster();

    manager.spawn(80, 24, "/tmp", broadcaster);

    // Wait for shell startup output
    await new Promise((resolve) => setTimeout(resolve, 500));

    const outputEvents = broadcaster.events.filter(
      (e) => e.event === "terminal:output",
    );
    expect(outputEvents.length).toBeGreaterThan(0);
  });
});
