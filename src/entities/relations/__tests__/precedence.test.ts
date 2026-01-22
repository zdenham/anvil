/**
 * Relation Type Precedence Tests
 *
 * Tests for relation type precedence rules:
 * - mentioned < modified < created
 * - Relations can only upgrade, never downgrade
 */

import { describe, it, expect } from "vitest";
import { RELATION_TYPE_PRECEDENCE } from "@core/types/relations.js";
import type { RelationType } from "@core/types/relations.js";

// Helper to check if an upgrade is allowed (higher precedence)
function canUpgrade(currentType: RelationType, newType: RelationType): boolean {
  return RELATION_TYPE_PRECEDENCE[newType] > RELATION_TYPE_PRECEDENCE[currentType];
}

describe("Relation Type Precedence", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // canUpgrade helper Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("canUpgrade helper", () => {
    it("should allow mentioned -> modified upgrade", () => {
      expect(canUpgrade("mentioned", "modified")).toBe(true);
    });

    it("should allow mentioned -> created upgrade", () => {
      expect(canUpgrade("mentioned", "created")).toBe(true);
    });

    it("should allow modified -> created upgrade", () => {
      expect(canUpgrade("modified", "created")).toBe(true);
    });

    it("should NOT allow modified -> mentioned downgrade", () => {
      expect(canUpgrade("modified", "mentioned")).toBe(false);
    });

    it("should NOT allow created -> modified downgrade", () => {
      expect(canUpgrade("created", "modified")).toBe(false);
    });

    it("should NOT allow created -> mentioned downgrade", () => {
      expect(canUpgrade("created", "mentioned")).toBe(false);
    });

    it("should NOT allow same-type 'upgrades' (mentioned -> mentioned)", () => {
      expect(canUpgrade("mentioned", "mentioned")).toBe(false);
    });

    it("should NOT allow same-type 'upgrades' (modified -> modified)", () => {
      expect(canUpgrade("modified", "modified")).toBe(false);
    });

    it("should NOT allow same-type 'upgrades' (created -> created)", () => {
      expect(canUpgrade("created", "created")).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATION_TYPE_PRECEDENCE constant Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("RELATION_TYPE_PRECEDENCE constant", () => {
    it("should have mentioned < modified < created ordering", () => {
      expect(RELATION_TYPE_PRECEDENCE.mentioned).toBe(1);
      expect(RELATION_TYPE_PRECEDENCE.modified).toBe(2);
      expect(RELATION_TYPE_PRECEDENCE.created).toBe(3);
    });

    it("should have mentioned as the lowest precedence", () => {
      expect(RELATION_TYPE_PRECEDENCE.mentioned).toBeLessThan(RELATION_TYPE_PRECEDENCE.modified);
      expect(RELATION_TYPE_PRECEDENCE.mentioned).toBeLessThan(RELATION_TYPE_PRECEDENCE.created);
    });

    it("should have created as the highest precedence", () => {
      expect(RELATION_TYPE_PRECEDENCE.created).toBeGreaterThan(RELATION_TYPE_PRECEDENCE.mentioned);
      expect(RELATION_TYPE_PRECEDENCE.created).toBeGreaterThan(RELATION_TYPE_PRECEDENCE.modified);
    });

    it("should have modified as middle precedence", () => {
      expect(RELATION_TYPE_PRECEDENCE.modified).toBeGreaterThan(RELATION_TYPE_PRECEDENCE.mentioned);
      expect(RELATION_TYPE_PRECEDENCE.modified).toBeLessThan(RELATION_TYPE_PRECEDENCE.created);
    });
  });
});
