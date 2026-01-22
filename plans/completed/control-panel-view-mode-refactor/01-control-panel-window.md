# Sub-Plan 01: Control Panel Window Refactor

**Parallelizable with:** 02-quick-actions.md, 03-inbox-wiring.md
**Depends on:** 00-type-fixes.md

## Goal

Update the control panel window to properly route between Plan view and Thread view using the simplified discriminated union. Thread view manages its own tab state locally.

## Files Owned by This Sub-Plan

- `src/components/control-panel/control-panel-window.tsx`
- `src/components/control-panel/use-control-panel-params.ts`
- `src/components/control-panel/store.ts`
- `src/components/control-panel/control-panel-header.tsx`
- `src/components/control-panel/plan-view.tsx`

## Implementation Steps

### Step 1: Update control-panel-window.tsx

**File:** `src/components/control-panel/control-panel-window.tsx`

1. Remove the three-way `activeView` state toggle
2. Add local `threadTab` state for thread view tabs: `"conversation" | "changes"`
3. Implement conditional rendering based on `view.type`:

```typescript
// Local tab state for thread view only
const [threadTab, setThreadTab] = useState<"conversation" | "changes">("conversation");

// Get view from store or params
const view = useControlPanelStore((s) => s.view);

// Render based on view type
if (!view) {
  return <EmptyState />;
}

if (view.type === "plan") {
  return <PlanView planId={view.planId} />;
}

// Thread view with local tab management
return (
  <ThreadView
    threadId={view.threadId}
    activeTab={threadTab}
    onTabChange={setThreadTab}
  />
);
```

4. Update `handleToggleView` to be a two-way toggle (conversation ↔ changes) only for thread view

### Step 2: Update use-control-panel-params.ts

**File:** `src/components/control-panel/use-control-panel-params.ts`

1. Remove any `tab` handling from the params transformation
2. Simplify the return type - no longer includes `initialView` legacy field
3. When receiving `OpenControlPanelPayload`, just extract `type` and `threadId`/`planId`

```typescript
interface ControlPanelParams {
  view: ControlPanelViewType | null;
  prompt?: string;
}
```

### Step 3: Verify store.ts

**File:** `src/components/control-panel/store.ts`

The store should already be correct (just stores `ControlPanelViewType`), but verify:
- No tab state in store
- Only `view: ControlPanelViewType | null`

### Step 4: Update control-panel-header.tsx

**File:** `src/components/control-panel/control-panel-header.tsx`

1. Accept `view` prop with discriminated union type
2. Render different headers based on `view.type`:

**Plan mode header:**
- Plan name/title
- No tabs
- No streaming indicators

**Thread mode header:**
- Thread status dot
- Breadcrumb with repo/thread info
- Cancel button when streaming
- Tab toggle buttons (conversation/changes) - receives `activeTab` and `onTabChange` as props

```typescript
interface ControlPanelHeaderProps {
  view: ControlPanelViewType;
  // Thread-specific props (only used when view.type === "thread")
  threadTab?: "conversation" | "changes";
  onThreadTabChange?: (tab: "conversation" | "changes") => void;
  isStreaming?: boolean;
}
```

### Step 5: Integrate plan-view.tsx

**File:** `src/components/control-panel/plan-view.tsx`

Ensure `PlanView` component:
1. Accepts `planId` prop
2. Renders plan content (markdown)
3. Has no internal tabs (single view)
4. Shows plan metadata (created date, related threads count, etc.)

## Verification

```bash
# Type check
pnpm tsc --noEmit

# Run control panel tests
pnpm test src/components/control-panel/

# Manual verification:
# 1. Open a thread - should show conversation tab by default
# 2. Toggle view - should switch to changes tab
# 3. Toggle again - should switch back to conversation (two-way, not three-way)
```

## Success Criteria

- [ ] Opening a thread shows conversation view by default
- [ ] Tab toggle cycles between conversation and changes (two-way)
- [ ] Plan view renders when `view.type === "plan"`
- [ ] Header renders appropriate content for each mode
- [ ] No TypeScript errors
- [ ] Existing tests pass
