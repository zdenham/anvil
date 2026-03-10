// @vitest-environment node
/**
 * Sort Key Tests
 *
 * Tests for sort key generation via the fractional-indexing package wrapper.
 * Validates that generated keys maintain lexicographic ordering for
 * various insertion patterns (append, prepend, middle insert).
 */

import { describe, it, expect } from "vitest";
import { generateSortKey, computeSortKeyForInsertion } from "../sort-key";
import type { TreeItemNode } from "@/stores/tree-menu/types";

// -- Factory ------------------------------------------------------------------

function createNodeWithSortKey(id: string, sortKey?: string): TreeItemNode {
  return {
    type: "thread",
    id,
    title: id,
    status: "read",
    updatedAt: Date.now(),
    createdAt: Date.now(),
    depth: 0,
    isFolder: false,
    isExpanded: false,
    sortKey,
  };
}

// -- Tests --------------------------------------------------------------------

describe("generateSortKey", () => {
  it("generates a key between null and null (first item)", () => {
    const key = generateSortKey(null, null);
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("generates a key between two existing keys that sorts between them", () => {
    const first = generateSortKey(null, null);
    const last = generateSortKey(first, null);
    const middle = generateSortKey(first, last);

    expect(middle > first).toBe(true);
    expect(middle < last).toBe(true);
  });

  it("generates a key before an existing key", () => {
    const existing = generateSortKey(null, null);
    const before = generateSortKey(null, existing);

    expect(before < existing).toBe(true);
  });

  it("generates a key after an existing key", () => {
    const existing = generateSortKey(null, null);
    const after = generateSortKey(existing, null);

    expect(after > existing).toBe(true);
  });

  it("repeated append insertions produce strictly ascending keys", () => {
    const keys: string[] = [];
    let prevKey: string | null = null;
    for (let i = 0; i < 10; i++) {
      const newKey = generateSortKey(prevKey, null);
      keys.push(newKey);
      prevKey = newKey;
    }

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it("repeated prepend insertions produce strictly descending keys", () => {
    const keys: string[] = [];
    let nextKey: string | null = null;
    for (let i = 0; i < 10; i++) {
      const newKey = generateSortKey(null, nextKey);
      keys.push(newKey);
      nextKey = newKey;
    }

    // Keys were generated in reverse order; each new key < previous new key
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] < keys[i - 1]).toBe(true);
    }
  });

  it("repeated insertions between two keys produce valid ordering", () => {
    const first = generateSortKey(null, null);
    const last = generateSortKey(first, null);

    const keys: string[] = [first];
    for (let i = 0; i < 5; i++) {
      const newKey = generateSortKey(keys[keys.length - 1], last);
      keys.push(newKey);
    }
    keys.push(last);

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });
});

describe("computeSortKeyForInsertion", () => {
  it("generates key for insertion at start of list", () => {
    const siblings = [
      createNodeWithSortKey("a", "a1"),
      createNodeWithSortKey("b", "a2"),
    ];
    const key = computeSortKeyForInsertion(siblings, 0);
    expect(key < "a1").toBe(true);
  });

  it("generates key for insertion at end of list", () => {
    const siblings = [
      createNodeWithSortKey("a", "a1"),
      createNodeWithSortKey("b", "a2"),
    ];
    const key = computeSortKeyForInsertion(siblings, 2);
    expect(key > "a2").toBe(true);
  });

  it("generates key for insertion between two items", () => {
    const siblings = [
      createNodeWithSortKey("a", "a1"),
      createNodeWithSortKey("b", "a3"),
    ];
    const key = computeSortKeyForInsertion(siblings, 1);
    expect(key > "a1").toBe(true);
    expect(key < "a3").toBe(true);
  });

  it("generates key for insertion into empty list", () => {
    const key = computeSortKeyForInsertion([], 0);
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("handles siblings without sortKey (null values)", () => {
    const siblings = [
      createNodeWithSortKey("a", undefined),
      createNodeWithSortKey("b", undefined),
    ];
    // Should not throw -- treats undefined sortKey as null for generateKeyBetween
    const key = computeSortKeyForInsertion(siblings, 1);
    expect(typeof key).toBe("string");
  });
});

describe("sort ordering contract", () => {
  it("items without sortKey maintain createdAt ordering", () => {
    // This validates the tree builder's sort contract:
    // - Keyed items: sortKey ascending (come first)
    // - Unkeyed items: createdAt descending (come after)
    const unsortedItems = [
      { sortKey: undefined as string | undefined, createdAt: 3000 },
      { sortKey: undefined as string | undefined, createdAt: 1000 },
      { sortKey: "a0", createdAt: 2000 },
      { sortKey: "a1", createdAt: 500 },
    ];

    const sorted = [...unsortedItems].sort((a, b) => {
      const aHasKey = a.sortKey !== undefined;
      const bHasKey = b.sortKey !== undefined;
      if (!aHasKey && !bHasKey) return b.createdAt - a.createdAt;
      if (aHasKey && !bHasKey) return -1; // keyed first
      if (!aHasKey && bHasKey) return 1;
      return a.sortKey!.localeCompare(b.sortKey!);
    });

    expect(sorted[0]).toEqual({ sortKey: "a0", createdAt: 2000 });
    expect(sorted[1]).toEqual({ sortKey: "a1", createdAt: 500 });
    expect(sorted[2]).toEqual({ sortKey: undefined, createdAt: 3000 });
    expect(sorted[3]).toEqual({ sortKey: undefined, createdAt: 1000 });
  });
});
