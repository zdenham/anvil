# Type Layering

Imports flow inward: `src/` → `agents/` → `core/`. Never the reverse.

## The Layers

```
core/types/     ← innermost (shared types, no external dependencies)
    ↑
agents/src/     ← imports from @core only
    ↑
src/            ← imports from @core and agents
```

## The Rule

**`core/` must never import from `@/` or `agents/`.**

If a type is needed by `core/`, it belongs in `core/types/`. If `agents/` also needs it, it still belongs in `core/types/`.

## Where Types Belong

| Used by | Location |
|---------|----------|
| core + agents + frontend | `core/types/` |
| agents + frontend | `core/types/` |
| agents only | `agents/src/` |
| frontend only | `src/entities/` or `src/components/` |

## Common Mistakes

### Defining shared types in frontend

```typescript
// BAD: core/services/thread-service.ts
import { ThreadMetadata } from "@/entities/threads/types";  // ❌ core importing from frontend

// GOOD: core/services/thread-service.ts
import { ThreadMetadata } from "@core/types/threads.js";    // ✅ core importing from core
```

### Duplicating types to avoid the import

```typescript
// BAD: agents/src/merge-types.ts
export type WorkflowMode = "automatic" | "review-first";  // ❌ duplicated from settings

// GOOD: Move to core, import everywhere
import { WorkflowMode } from "@core/types/settings.js";   // ✅ single source of truth
```

## Re-exports

Frontend can re-export core types for convenience:

```typescript
// src/entities/threads/types.ts
export { ThreadMetadata, ThreadTurn } from "@core/types/threads.js";

// Additional frontend-only types
export interface ThreadListItem extends ThreadMetadata {
  isSelected: boolean;
}
```

Never the reverse. Core cannot re-export from frontend.

## Verification

```bash
# These should return nothing
grep -r "from ['\"]@/" core/ --include="*.ts" | grep -v "@core"
grep -r "from ['\"]@/entities" agents/ --include="*.ts"
```

## Why This Matters

Layer violations create circular dependencies and make code harder to test. When `core/` imports from `src/`, you can't run core services without the entire frontend. When types are duplicated, they drift apart and cause runtime bugs.
