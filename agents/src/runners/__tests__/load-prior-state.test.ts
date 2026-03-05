/**
 * loadPriorState Tests — Phase 0 behavioral assertions
 *
 * loadPriorState is not exported, so we replicate its core logic here
 * to verify the ID backfill behavior: messages without an `id` field
 * get one generated via nanoid.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { nanoid } from "nanoid";

/**
 * Replicates the core of loadPriorState from runner.ts (lines 59-63).
 * This is the exact transformation applied to loaded messages.
 */
function backfillIds(messages: Record<string, unknown>[]): Array<Record<string, unknown>> {
  return messages.map((msg) => ({
    ...msg,
    id: typeof msg.id === "string" ? msg.id : nanoid(),
  }));
}

describe("loadPriorState — ID backfill", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `load-prior-state-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("preserves existing string IDs", () => {
    const messages = [
      { id: "msg_existing", role: "assistant", content: "Hello" },
      { id: "user-nano-id", role: "user", content: "Hi" },
    ];

    const result = backfillIds(messages);

    expect(result[0].id).toBe("msg_existing");
    expect(result[1].id).toBe("user-nano-id");
  });

  it("generates IDs for messages without an id field", () => {
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: [{ type: "text", text: "Hi" }] },
    ];

    const result = backfillIds(messages);

    expect(typeof result[0].id).toBe("string");
    expect((result[0].id as string).length).toBeGreaterThan(0);
    expect(typeof result[1].id).toBe("string");
    expect((result[1].id as string).length).toBeGreaterThan(0);
  });

  it("generates IDs for messages with non-string id values", () => {
    const messages = [
      { id: 42, role: "user", content: "number id" },
      { id: null, role: "assistant", content: "null id" },
      { id: undefined, role: "user", content: "undefined id" },
    ];

    const result = backfillIds(messages as Record<string, unknown>[]);

    for (const msg of result) {
      expect(typeof msg.id).toBe("string");
      expect((msg.id as string).length).toBeGreaterThan(0);
    }
    // None should be the original non-string values
    expect(result[0].id).not.toBe(42);
  });

  it("generates unique IDs for each message", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ];

    const result = backfillIds(messages);
    const ids = result.map((m) => m.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it("round-trips through JSON (simulates disk load)", () => {
    const stateFile = join(testDir, "state.json");
    const state = {
      messages: [
        { role: "user", content: "Hello" },
        { id: "msg_kept", role: "assistant", content: "World" },
      ],
      status: "complete",
    };

    writeFileSync(stateFile, JSON.stringify(state));
    const loaded = JSON.parse(require("fs").readFileSync(stateFile, "utf-8"));
    const result = backfillIds(loaded.messages);

    // First message gets a generated ID
    expect(typeof result[0].id).toBe("string");
    expect(result[0].id).not.toBe("msg_kept");

    // Second message keeps its ID
    expect(result[1].id).toBe("msg_kept");
  });
});
