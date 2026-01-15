# Sub-Plan 01: Core Types

## Overview
Create the foundational AgentMode type in `core/types/` that will be shared by both the `agents/` and `src/` packages.

## Dependencies
- **None** - This is a foundational sub-plan with no dependencies.

## Can Run In Parallel With
- None initially, but once complete, ALL other sub-plans can begin.

## Scope
- Create the AgentMode type definition
- Export from core/types index

## Files Involved

### New Files
| File | Lines |
|------|-------|
| `core/types/agent-mode.ts` | ~10 |

### Modified Files
| File | Change |
|------|--------|
| `core/types/index.ts` | Add export for AgentMode |

## Implementation Details

### Step 1: Create AgentMode Type

**File:** `core/types/agent-mode.ts`

```typescript
/**
 * Agent interaction mode - controls how the agent handles file edits.
 * - normal: Requires user approval for file edits
 * - plan: Agent plans actions but does not execute them
 * - auto-accept: Auto-approves all file edits
 */
export type AgentMode = "normal" | "plan" | "auto-accept";
```

### Step 2: Export from Index

**File:** `core/types/index.ts`

Add:
```typescript
export type { AgentMode } from "./agent-mode.js";
```

## Tests Required
- No tests needed - type-only file, verified by TypeScript compiler

## Verification
- [ ] `pnpm tsc --noEmit` passes
- [ ] Type can be imported from `@core/types/agent-mode.js`

## Estimated Time
~5 minutes
