# 01 — File View Type + navigateToFile

**Parallel track A** — no dependencies on other sub-plans. Can run simultaneously with 02 and 03.

See [decisions.md](./decisions.md) for rationale on file click behavior and placeholder approach.

## Phases

- [ ] Extend ContentPaneView with `file` variant (type + Zod schema)
- [ ] Add `navigateToFile` to navigationService
- [ ] Add `file` view routing in ContentPane (placeholder) and header fallback

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Extend ContentPaneView

### 1a. TypeScript type

**File: `src/components/content-pane/types.ts`**

Add a new variant to the `ContentPaneView` discriminated union (after the `terminal` line):

```typescript
export type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string; autoFocus?: boolean }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "terminal"; terminalId: string }
  | { type: "file"; filePath: string; repoId?: string; worktreeId?: string };
```

- `filePath` — absolute path to the file on disk.
- `repoId` / `worktreeId` — optional context for breadcrumbs and worktree scoping. These are unused by the placeholder but must be on the type now because both this plan and `file-viewer-pane.md` share the same variant.

> **Note on stable references:** The coding guidelines say "key by task-id or slug-id, NOT by paths." For file views there is no stable entity ID — the file path *is* the identity. This is acceptable because file views are ephemeral navigation targets, not persisted entity keys. They are not used as store keys or map lookups.

### 1b. Zod schema (disk persistence)

**File: `src/stores/content-panes/types.ts`**

The `ContentPaneViewSchema` discriminated union must also include the `file` variant, otherwise hydrating from `~/.mort/ui/content-panes.json` will reject any persisted file view on next app launch.

Add to the `ContentPaneViewSchema` array:

```typescript
export const ContentPaneViewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("empty") }),
  z.object({ type: z.literal("thread"), threadId: z.string(), autoFocus: z.boolean().optional() }),
  z.object({ type: z.literal("plan"), planId: z.string() }),
  z.object({ type: z.literal("settings") }),
  z.object({ type: z.literal("logs") }),
  z.object({ type: z.literal("terminal"), terminalId: z.string() }),
  z.object({ type: z.literal("file"), filePath: z.string(), repoId: z.string().optional(), worktreeId: z.string().optional() }),
]);
```

---

## Phase 2: Add `navigateToFile` to navigationService

**File: `src/stores/navigation-service.ts`**

Add a `navigateToFile` method to the `navigationService` object. Files are not tree menu items, so tree selection is cleared (same pattern as `settings` / `logs`).

```typescript
/**
 * Navigate to a file - clears tree selection and shows file in content pane.
 * Files are not tree items, so selection is cleared.
 */
async navigateToFile(filePath: string, context?: { repoId?: string; worktreeId?: string }): Promise<void> {
  await treeMenuService.setSelectedItem(null);
  await contentPanesService.setActivePaneView({
    type: "file",
    filePath,
    ...context,
  });
},
```

Place it after `navigateToPlan` and before `navigateToView`.

### navigateToView already handles `file` correctly

The existing `navigateToView` method falls through to its `else` branch for any type that is not `thread` or `plan`. That branch clears tree selection and sets the pane view directly — which is exactly what `file` needs. **No changes required to `navigateToView`**, but verify this during implementation by reading the current code:

```typescript
// Existing code — no changes needed:
async navigateToView(view: ContentPaneView): Promise<void> {
  if (view.type === "thread") {
    await this.navigateToThread(view.threadId, { autoFocus: view.autoFocus });
  } else if (view.type === "plan") {
    await this.navigateToPlan(view.planId);
  } else {
    // settings, logs, empty, terminal, file — all clear tree selection
    await treeMenuService.setSelectedItem(null);
    await contentPanesService.setActivePaneView(view);
  }
},
```

---

## Phase 3: Route in ContentPane + header fallback

### 3a. Placeholder view in ContentPane

**File: `src/components/content-pane/content-pane.tsx`**

Add the rendering case for the `file` view type inside the `<div className="flex-1 min-h-0">` block, after the `terminal` case. For now, render a minimal placeholder showing the file path. The full `FileContent` component is implemented in `plans/file-viewer-pane.md` Phase 2.

```tsx
{view.type === "file" && (
  <div className="flex items-center justify-center h-full text-surface-400 text-sm">
    <span>{view.filePath}</span>
  </div>
)}
```

No new imports needed for the placeholder.

### 3b. Header fallback

**File: `src/components/content-pane/content-pane-header.tsx`**

The `ContentPaneHeader` component uses early-return to route view types. View types that don't match (`settings`, `logs`) currently fall through to `SimpleHeader`, which capitalizes the view type string as a title.

When `view.type === "file"`, the fallthrough renders `<SimpleHeader title="file" />` which displays **"File"** in the header bar with a close button. This is acceptable as a placeholder. **No changes required to `content-pane-header.tsx` in this sub-plan.** The full `FileHeader` with breadcrumbs is implemented in `plans/file-viewer-pane.md` Phase 3.

### 3c. Breadcrumb category type (deferred)

The `Breadcrumb` component (`src/components/content-pane/breadcrumb.tsx`) currently restricts its `category` prop to `"threads" | "plans"`. When `file-viewer-pane.md` Phase 3 adds the full `FileHeader` with breadcrumbs, that type will need to be widened to include `"files"`. **No changes needed now**, but noting it here for awareness.

---

## Files

| File | Action |
|------|--------|
| `src/components/content-pane/types.ts` | Modify — add `file` variant to `ContentPaneView` union |
| `src/stores/content-panes/types.ts` | Modify — add `file` variant to `ContentPaneViewSchema` Zod schema |
| `src/stores/navigation-service.ts` | Modify — add `navigateToFile()` method |
| `src/components/content-pane/content-pane.tsx` | Modify — add `file` placeholder view case |
| `src/components/content-pane/content-pane-header.tsx` | No change — `SimpleHeader` fallback handles `file` |
| `src/components/content-pane/breadcrumb.tsx` | No change now — category type widened in `file-viewer-pane.md` Phase 3 |

## Verification

After implementation, verify:

1. **TypeScript compiles** — `npx tsc --noEmit` passes with no errors related to `ContentPaneView`.
2. **Zod round-trip** — The Zod schema parses a `{ type: "file", filePath: "/some/path" }` view without error. Add a quick test or verify manually.
3. **Manual test** — Call `navigationService.navigateToFile("/some/test/file.ts")` from the browser console (or a temporary button) and confirm:
   - Tree selection clears.
   - Content pane shows the placeholder with the file path string.
   - Header shows "File" with a close button.
   - Closing the pane resets to empty state.
4. **Persistence** — After navigating to a file view, quit and relaunch. The pane should restore with the file placeholder (Zod schema must pass).
