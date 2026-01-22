# Sub-Plan 00: Type Foundation Fixes

**Must run BEFORE all other sub-plans.**

## Goal

Simplify the `ControlPanelViewType` discriminated union to remove tab state from the routing type. Tabs should be local component state, not part of the view routing.

## Current State

```typescript
// src/entities/events.ts (current)
export type ControlPanelViewType =
  | { type: "thread"; threadId: string; tab: "conversation" | "plan" | "changes" }
  | { type: "plan"; planId: string; tab: "content" | "threads" };
```

## Target State

```typescript
// src/entities/events.ts (target)
export type ControlPanelViewType =
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string };
```

## Implementation Steps

### Step 1: Update events.ts

**File:** `src/entities/events.ts`

Remove `tab` from the discriminated union:

```typescript
export type ControlPanelViewType =
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string };
```

### Step 2: Fix Type Errors

After changing the type, fix any resulting TypeScript errors in files that reference `ControlPanelViewType`. These files may need updates:

- `src/components/control-panel/use-control-panel-params.ts` - if it sets `tab`
- `src/components/control-panel/store.ts` - if it uses `tab`
- `src/lib/hotkey-service.ts` - if it creates views with `tab`

For each file, remove any code that sets or reads the `tab` property from the view type.

### Step 3: Run Type Check

```bash
pnpm tsc --noEmit
```

All errors related to `ControlPanelViewType.tab` should be resolved.

## Verification

```bash
# Type check passes
pnpm tsc --noEmit

# No grep results for tab in ControlPanelViewType usage
grep -r "type: \"thread\".*tab:" src/
grep -r "type: \"plan\".*tab:" src/
```

## Files Changed

| File | Change |
|------|--------|
| `src/entities/events.ts` | Remove `tab` from discriminated union |
| Various | Remove any code setting/reading `tab` on view type |

## Notes for Parallel Sub-Plans

After this sub-plan completes, the following can run in parallel:
- `01-control-panel-window.md`
- `02-quick-actions.md`
- `03-inbox-wiring.md`

They all depend on this simplified type being in place.
