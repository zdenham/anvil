# Phase 2: Settings

**Dependencies:** None
**Parallel Group:** A

## Goal

Add merge strategy settings (destination and method) with UI controls.

---

## 2.1 Extend Settings Types

**File:** `src/entities/settings/types.ts`

```typescript
export type MergeDestination = "local" | "pull-request";
export type MergeMethod = "merge" | "rebase";

export interface WorkspaceSettings {
  repository: string | null;
  anthropicApiKey: string | null;
  // Merge strategy settings
  mergeDestination: MergeDestination;
  mergeMethod: MergeMethod;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  repository: null,
  anthropicApiKey: null,
  mergeDestination: "local",
  mergeMethod: "merge",
};
```

---

## 2.2 Add Settings Store Selectors

**File:** `src/entities/settings/store.ts`

```typescript
getMergeDestination: () => get().workspace.mergeDestination ?? "local",
getMergeMethod: () => get().workspace.mergeMethod ?? "merge",
```

---

## 2.3 Create Settings UI Component

**File:** `src/components/main-window/settings/merge-settings.tsx`

Create component with two sections:

1. **Merge Destination** - Radio group:
   - "Merge on local" - "Merge changes directly into your local branch"
   - "Open a PR" - "Create a pull request for review on GitHub"

2. **Merge Method** - Radio group:
   - "Merge" - "Create a merge commit preserving history"
   - "Rebase" - "Rebase commits onto base branch for linear history"

---

## 2.4 Add to Settings Page

**File:** `src/components/main-window/settings/settings-page.tsx`

Add `<MergeSettings />` section after repository settings.

---

## Checklist

- [ ] Add `MergeDestination` and `MergeMethod` types
- [ ] Extend `WorkspaceSettings` interface
- [ ] Update `DEFAULT_WORKSPACE_SETTINGS`
- [ ] Add store selectors `getMergeDestination()` and `getMergeMethod()`
- [ ] Create `merge-settings.tsx` component
- [ ] Add component to settings page
- [ ] Test settings persistence
