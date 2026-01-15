# 01 - Type Definitions

**Parallelizable:** Yes (no dependencies)
**Estimated scope:** 2 files modified

## Overview

Add type definitions needed by other plans. Small, foundational changes.

## Tasks

### 1. Update AgentType union

**File:** `src/entities/threads/types.ts`

Add "simple" to the AgentType union:

```typescript
export type AgentType = "entrypoint" | "execution" | "review" | "merge" | "research" | "simple";
```

### 2. Update TaskType union

**File:** `core/types/tasks.ts`

Add "simple" to TaskType:

```typescript
export type TaskType = "work" | "investigate" | "simple";
```

## Verification

```bash
pnpm typecheck
```

No errors related to the new type values.
