# Fix "New Project" Button Flow

## Problem

Two issues with the "New Project" button:

1. **`window.prompt()` is broken in Tauri's webview** — `project-creation-service.ts:27` uses `window.prompt()` for the project name, which silently returns `null` or doesn't render at all. The function bails with no user feedback, making the button appear dead.

2. **Flow order is backwards** — currently: pick folder → name project. But the whole point is to create a *named* folder at a location. The user should name the project first, then choose where to put it. Name-first also lets us pre-fill the folder dialog title with the project name for context.

Additionally, all error paths log silently with no user-visible feedback.

## Phases

- [ ] Add a "New Project" modal dialog (name input + folder picker) and wire it into the creation flow
- [ ] Add toast notifications for error/success feedback

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: New Project modal dialog

### Current flow (`src/lib/project-creation-service.ts`)

```
1. open() → native folder picker (works but happens too early)
2. window.prompt() → project name (broken in Tauri webview)
3. repoService.createProject(parentDir, name) → git init + register
```

### New flow

```
1. Open modal → user types project name, clicks "Create"
2. open() → native folder picker titled "Choose where to create <name>"
3. repoService.createProject(parentDir, name) → git init + register
4. Close modal, show success toast
```

### Implementation

**New file:** `src/components/new-project-dialog.tsx`

Build a modal dialog following the existing pattern used by `move-to-dialog.tsx`, `permission-modal.tsx`, and `quick-action-edit-modal.tsx`:
- `createPortal()` to document body
- Fixed-position backdrop with click-to-dismiss
- Escape key to close
- Register with `useModalStore` to suppress hotkeys while open

Contents:
- Text input for project name (use existing `Input` component from `src/components/reusable/Input.tsx`)
- "Cancel" and "Create" buttons (use existing `Button` component from `src/components/reusable/Button.tsx`)
- Disable "Create" when input is empty/whitespace
- Auto-focus the input on mount
- Enter key submits (when valid), Escape cancels

**State management:** Simple boolean + callback approach. The dialog component manages its own open/close state via a small Zustand store or a context-level state. The callers (`main-window-layout.tsx:587-596` and `empty-pane-content.tsx:110-116`) trigger it by setting the store to open. On submit, the dialog calls the creation flow and closes itself.

Alternatively, expose a `requestNewProject(): Promise<string | null>` that opens the dialog and resolves when the user completes or cancels — similar to how `window.prompt()` worked but with a real UI.

**Modify:** `src/lib/project-creation-service.ts`
- Swap the order: get project name first (from the dialog), then open folder picker
- Remove `window.prompt()` entirely
- Update the folder picker title to include the project name: `"Choose where to create ${name}"`

### Callers to check

- `src/components/main-window/main-window-layout.tsx` (~line 587-596) — "New Project" button handler
- `src/components/content-pane/empty-pane-content.tsx` (~line 110-116) — empty state "New Project" button

Both currently call `createNewProjectAndHydrate()` directly. They may need to be updated depending on how the dialog is triggered (store-based vs inline).

## Phase 2: Toast notifications for feedback

**Existing system:** `src/lib/toast.ts` — Zustand store with `toast.success()`, `toast.error()`, `toast.info()` methods. Rendered by `src/components/ui/global-toast.tsx`.

**Modify:** `src/lib/project-creation-service.ts`

Add toast calls for:
- **Success:** `toast.success("Project created: <name>")`
- **Duplicate folder:** `toast.error("A folder named <name> already exists there")`
- **Duplicate registry entry:** `toast.error("A project named <name> is already registered")`
- **Generic failure:** `toast.error("Failed to create project")`

Currently `repoService.createProject()` throws on these error cases — wrap the call in try/catch, parse the error message to show the appropriate toast, and return `null` on failure instead of letting the error propagate uncaught.
