import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// Plan-Thread Relation Types - Zod schemas with derived types
// Storage: ~/.anvil/plan-thread-edges/{planId}-{threadId}.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Relation types with precedence: created > modified > mentioned
 * - created: Thread created this plan file
 * - modified: Thread modified this plan file
 * - mentioned: Thread referenced this plan (in user message or context)
 */
export const RelationTypeSchema = z.enum(['created', 'modified', 'mentioned']);
export type RelationType = z.infer<typeof RelationTypeSchema>;

/**
 * Schema for plan-thread relationship persisted to disk.
 */
export const PlanThreadRelationSchema = z.object({
  planId: z.string().uuid(),
  threadId: z.string().uuid(),
  type: RelationTypeSchema,
  archived: z.boolean().default(false), // Set true when thread or plan is archived
  createdAt: z.number(),               // Unix milliseconds
  updatedAt: z.number(),               // Unix milliseconds
});

export type PlanThreadRelation = z.infer<typeof PlanThreadRelationSchema>;

/** Input for creating a new relation */
export interface CreateRelationInput {
  planId: string;
  threadId: string;
  type: RelationType;
}

/** Input for updating a relation */
export interface UpdateRelationInput {
  type?: RelationType;
}

// ═══════════════════════════════════════════════════════════════════════════
// Precedence Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Precedence values for relation types.
 * Higher number = higher precedence.
 */
export const RELATION_TYPE_PRECEDENCE: Record<RelationType, number> = {
  mentioned: 1,
  modified: 2,
  created: 3,
};

/**
 * Get the highest-precedence relation type from a list.
 * Used when displaying a single relation type for a thread-plan pair.
 */
export function getHighestPrecedenceType(types: RelationType[]): RelationType {
  if (types.length === 0) {
    throw new Error('Cannot get highest precedence type from empty array');
  }
  return types.sort((a, b) =>
    RELATION_TYPE_PRECEDENCE[b] - RELATION_TYPE_PRECEDENCE[a]
  )[0];
}
