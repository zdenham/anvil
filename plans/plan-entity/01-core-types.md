# 01 - Core Types and Schemas

**Dependencies:** None
**Parallelizable after completion with:** 02, 03, 04

## Design Decisions

- **UUID Validation**: Use `z.string().uuid()` for stricter validation on plan IDs
- **isRead Default**: Plans default to `isRead: false` (unread) - any creation or update marks as unread
- **Null for Unsetting**: Use `null` to explicitly unset associations (not `undefined`)

## Overview

Create the foundational Plan entity types and Zod schemas that all other sub-plans depend on.

## Implementation Steps

### 1. Create Plan Types File

**File:** `core/types/plans.ts`

```typescript
import { z } from 'zod';

export const PlanMetadataSchema = z.object({
  /** Unique plan ID (UUID) */
  id: z.string().uuid(),
  /** Path to the plan file relative to repository root (e.g., "plans/feature-x.md") */
  path: z.string(),
  /** Repository name this plan belongs to */
  repositoryName: z.string(),
  /** Plan title (extracted from filename or first H1 in content) */
  title: z.string(),
  /** Whether user has viewed the plan - defaults to false (unread) */
  isRead: z.boolean().default(false),
  /** Timestamps */
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;

export interface CreatePlanInput {
  path: string;
  repositoryName: string;
  title?: string;
}

export interface UpdatePlanInput {
  title?: string;
  isRead?: boolean;
}
```

**Note:** The schema is also exported for use in service validation during hydration.

### 2. Export from Types Index

**File:** `core/types/index.ts`

Add export:
```typescript
export * from './plans.js';
```

## Validation Criteria

- [ ] `PlanMetadataSchema` validates correctly
- [ ] `PlanMetadataSchema` is exported (needed for validation in service layer)
- [ ] Types are exported from `core/types/index.ts`
- [ ] TypeScript compiles without errors
- [ ] Can import `PlanMetadata` type from `@core/types`
- [ ] ID field uses `z.string().uuid()` for strict validation
- [ ] `isRead` defaults to `false` for new plans
