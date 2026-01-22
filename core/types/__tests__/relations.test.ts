/**
 * Relation Types Tests
 *
 * Tests to ensure type definitions are correctly exported.
 */

import { describe, it, expect } from "vitest";
import {
  RELATION_TYPE_PRECEDENCE,
  PlanThreadRelationSchema,
  RelationTypeSchema,
  type PlanThreadRelation,
  type RelationType,
} from "../relations";

describe("Relation Types", () => {
  it("should export RelationType union type", () => {
    // Type-level test: ensure the type is correctly defined
    const validTypes: RelationType[] = ["created", "modified", "mentioned"];
    expect(validTypes).toHaveLength(3);
  });

  it("should validate RelationType values with schema", () => {
    expect(RelationTypeSchema.safeParse("created").success).toBe(true);
    expect(RelationTypeSchema.safeParse("modified").success).toBe(true);
    expect(RelationTypeSchema.safeParse("mentioned").success).toBe(true);
    expect(RelationTypeSchema.safeParse("invalid").success).toBe(false);
  });

  it("should export PlanThreadRelation interface with all required fields", () => {
    // Type-level test: ensure all fields are present
    const relation: PlanThreadRelation = {
      planId: crypto.randomUUID(),
      threadId: crypto.randomUUID(),
      type: "created",
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Validate against schema
    const result = PlanThreadRelationSchema.safeParse(relation);
    expect(result.success).toBe(true);
  });

  it("should validate PlanThreadRelation with all required fields", () => {
    const validRelation = {
      planId: crypto.randomUUID(),
      threadId: crypto.randomUUID(),
      type: "modified",
      archived: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = PlanThreadRelationSchema.safeParse(validRelation);
    expect(result.success).toBe(true);
  });

  it("should reject PlanThreadRelation with missing fields", () => {
    const invalidRelation = {
      planId: crypto.randomUUID(),
      // Missing threadId, type, archived, createdAt, updatedAt
    };

    const result = PlanThreadRelationSchema.safeParse(invalidRelation);
    expect(result.success).toBe(false);
  });

  it("should reject PlanThreadRelation with invalid planId (not UUID)", () => {
    const invalidRelation = {
      planId: "not-a-uuid",
      threadId: crypto.randomUUID(),
      type: "created",
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = PlanThreadRelationSchema.safeParse(invalidRelation);
    expect(result.success).toBe(false);
  });

  it("should export RELATION_TYPE_PRECEDENCE constant", () => {
    expect(RELATION_TYPE_PRECEDENCE.mentioned).toBe(1);
    expect(RELATION_TYPE_PRECEDENCE.modified).toBe(2);
    expect(RELATION_TYPE_PRECEDENCE.created).toBe(3);
  });

  it("should use default archived=false when not provided", () => {
    const relationWithoutArchived = {
      planId: crypto.randomUUID(),
      threadId: crypto.randomUUID(),
      type: "created",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = PlanThreadRelationSchema.safeParse(relationWithoutArchived);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.archived).toBe(false);
    }
  });
});
