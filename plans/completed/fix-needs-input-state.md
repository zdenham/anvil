# Fix "needs-input" Thread State

## Problem

Threads should show an amber "needs-input" status dot when waiting for user input (permission requests or AskUserQuestion responses). This is not working.

## Root Cause

The `threadsWithPendingInput` derivation in `src/hooks/use-tree-data.ts:322-329` only checks the **permission store** — it does **not** check the **question store**:

```typescript
// Current: only checks permissionRequests
const permissionRequests = usePermissionStore((state) => state.requests);
const threadsWithPendingInput = useMemo(() => {
  const ids = new Set<string>();
  for (const req of Object.values(permissionRequests)) {
    if (req.status === "pending") ids.add(req.threadId);
  }
  return ids;
}, [permissionRequests]);
```

There are two parallel async-input flows, each with their own store:

| Flow | Agent-side gate | Event | Frontend store | Checked by tree? |
| --- | --- | --- | --- | --- |
| Permission requests | `PermissionGate` | `PERMISSION_REQUEST` | `usePermissionStore` | Yes |
| AskUserQuestion | `QuestionGate` | `QUESTION_REQUEST` | `useQuestionStore` | **No** |

Both stores follow the same pattern (pending requests keyed by requestId with threadId and status), but only the permission store feeds into the `threadsWithPendingInput` set that drives the `"needs-input"` status dot.

## Phases

- [x] Add question store subscription to `threadsWithPendingInput` derivation

- [x] Add amber chevron for needs-input folder state

- [x] Verify propagation through tree node builders

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add question store to `threadsWithPendingInput`

**File:** `src/hooks/use-tree-data.ts`

Subscribe to `useQuestionStore` and merge pending question thread IDs into the existing `threadsWithPendingInput` set:

```typescript
// Add import
import { useQuestionStore } from "@/entities/questions/store";

// Subscribe to both stores
const permissionRequests = usePermissionStore((state) => state.requests);
const questionRequests = useQuestionStore((state) => state.requests);

const threadsWithPendingInput = useMemo(() => {
  const ids = new Set<string>();
  for (const req of Object.values(permissionRequests)) {
    if (req.status === "pending") ids.add(req.threadId);
  }
  for (const req of Object.values(questionRequests)) {
    if (req.status === "pending") ids.add(req.threadId);
  }
  return ids;
}, [permissionRequests, questionRequests]);
```

The rest of the downstream chain already works:

- `threadToNode()` → `getThreadStatusVariant()` → `"needs-input"` variant
- `StatusDot` renders `status-dot-needs-input` CSS class (amber pulse)
- `getTextColorClass()` handles `"needs-input"` with amber shimmer

## Phase 2: Add amber chevron for needs-input folders

When a thread item is selected and has children, a chevron replaces the status dot. Currently only `"running"` gets a styled chevron — `"needs-input"` falls through to the default gray.

### 2a. Add `chevron-needs-input` CSS class

**File:** `src/index.css` (after `.chevron-running` block at line 342)

```css
/* Needs-input folder chevron - amber with pulse */
.chevron-needs-input {
  color: #fbbf24; /* amber-400 — matches status-dot-needs-input */
  animation: chevronNeedsInputPulse 2s ease-in-out infinite;
}

@keyframes chevronNeedsInputPulse {
  0%, 100% {
    color: #fbbf24; /* amber-400 */
  }
  50% {
    color: #b45309; /* amber-700 */
  }
}
```

Mirrors `chevron-running` (green pulse) but with the same amber palette as `status-dot-needs-input`.

### 2b. Apply class in ThreadItem chevron conditional

**File:** `src/components/tree-menu/thread-item.tsx:284-288`

Current:

```tsx
item.status === "running"
  ? "chevron-running"
  : "text-surface-400 hover:bg-surface-700"
```

Change to:

```tsx
item.status === "running"
  ? "chevron-running"
  : item.status === "needs-input"
    ? "chevron-needs-input"
    : "text-surface-400 hover:bg-surface-700"
```

## Phase 3: Verify propagation

Read-only verification that the existing chain is wired correctly:

1. `tree-node-builders.ts:108` — `threadToNode()` passes `ctx.threadsWithPendingInput.has(thread.id)` to `getThreadStatusVariant()`
2. `thread-colors.ts:21` — returns `"needs-input"` when `hasPendingInput` is true
3. `status-dot.tsx:26` — has `"needs-input"` variant with `status-dot-needs-input` CSS class
4. `index.css:271` — has `.status-dot-needs-input` with amber glow animation
5. `thread-item.tsx:33` — `getTextColorClass()` handles `"needs-input"` with amber shimmer

## Scope

- **3 files changed:**
  - `src/hooks/use-tree-data.ts` — subscribe to question store (\~5 lines)
  - `src/index.css` — add `chevron-needs-input` class + keyframes (\~12 lines)
  - `src/components/tree-menu/thread-item.tsx` — extend chevron conditional (\~2 lines)
- No new files, no architectural changes