# Archive Worktree Confirmation Modal Fix

## Problem

When clicking "Archive worktree" in the context menu dropdown, the worktree is **immediately deleted** before the confirmation dialog even appears. The user expects:
1. Confirmation modal appears first
2. User can cancel or confirm
3. Only after confirmation does the worktree get archived

**Confirmed behavior:** Running `git worktree list` shows the worktree is deleted before the confirmation dialog shows.

## Investigation

### Root Cause: `window.confirm()` is Non-Blocking in Tauri

The issue is at `src/components/main-window/main-window-layout.tsx:335`:

```typescript
if (!window.confirm(message)) {
  logger.info(`[MainWindowLayout] Archive worktree cancelled`);
  return;
}
```

**Critical Issue:** In a Tauri desktop app, `window.confirm()` does **not** behave like it does in a traditional browser.

In browsers, `window.confirm()` is synchronous and blocking - JavaScript execution pauses until the user responds. However, in Tauri's WebView context:

1. `window.confirm()` may return immediately (not waiting for user input)
2. The native dialog rendering is asynchronous
3. The code continues executing past the `if` check before the user has a chance to respond

This is a **known anti-pattern** when working with Tauri. According to [Tauri's documentation](https://v2.tauri.app/plugin/dialog/) and [community discussions](https://dev.to/nk_maker/tauri-dialog-instead-of-windowconfirm-32dn), you should use Tauri's native dialog plugin instead of browser APIs.

### The Code Flow (What's Actually Happening)

1. User clicks "Archive worktree" in context menu
2. `handleContextArchiveWorktree()` closes menu and calls `onArchiveWorktree()`
3. `handleArchiveWorktree()` is called:
   - Builds confirmation message
   - Calls `window.confirm(message)` - **returns immediately (doesn't block)**
   - Code continues past the `if` check
   - Threads are archived
   - Worktree is deleted via `worktreeService.delete()`
4. **Then** the native dialog appears (too late - damage is done)
5. User clicks Cancel (but worktree is already gone)

### Anti-Patterns Identified

1. **Using `window.confirm()` in Tauri** - Should use `@tauri-apps/plugin-dialog` instead
2. **No `await`** - Even if using Tauri's dialog, the async nature requires awaiting
3. **Destructive action without proper confirmation gate** - The delete logic should be in a separate callback that only runs after confirmed user intent

### Existing Infrastructure

The codebase already has `@tauri-apps/plugin-dialog` installed (v2.4.2):
- `package.json:37` - `"@tauri-apps/plugin-dialog": "~2.4.2"`
- Used elsewhere for `open()` file dialogs
- Test mocks show `ask` and `confirm` are available: `src/test/setup-ui.ts:45-46`

## Proposed Fix

### Option A: Use Tauri's `confirm()` Dialog (Quick Fix)

Replace `window.confirm()` with Tauri's native async `confirm()`:

```typescript
import { confirm } from "@tauri-apps/plugin-dialog";

const handleArchiveWorktree = useCallback(async (repoName: string, worktreeId: string, worktreeName: string) => {
  logger.info(`[MainWindowLayout] Archive worktree requested: ${worktreeName} (${worktreeId}) in repo ${repoName}`);

  const threads = threadService.getByWorktree(worktreeId);
  const threadCount = threads.length;

  const message = threadCount > 0
    ? `Archive worktree "${worktreeName}" and its ${threadCount} thread${threadCount === 1 ? "" : "s"}?`
    : `Archive worktree "${worktreeName}"?`;

  // Use Tauri's native dialog - this is properly async and awaitable
  const confirmed = await confirm(message, {
    title: "Archive Worktree",
    kind: "warning",
  });

  if (!confirmed) {
    logger.info(`[MainWindowLayout] Archive worktree cancelled`);
    return;
  }

  // ... rest of archive logic
}, []);
```

**Pros:**
- Minimal code change
- Uses native OS dialog (consistent with platform)
- Properly async/awaitable

**Cons:**
- Native dialogs can't be styled to match the app
- Less control over button labels

### Option B: Custom React Confirmation Modal (Recommended)

Create a styled modal component that matches the app's design (similar to `permission-modal.tsx`):

**1. Create `src/components/ui/confirmation-modal.tsx`:**

```tsx
import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmationModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
}

export function ConfirmationModal({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
}: ConfirmationModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        onConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  const isDanger = variant === "danger";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div
        className={`relative bg-surface-800 rounded-lg border shadow-xl w-full max-w-md mx-4 ${
          isDanger ? "border-amber-500/50" : "border-surface-700"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            {isDanger && <AlertTriangle className="text-amber-500" size={24} />}
            <h2 className="text-lg font-semibold text-surface-100">{title}</h2>
          </div>
          <p className="text-surface-300 text-sm mb-6">{message}</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-surface-300 hover:text-surface-100 border border-surface-600 rounded-lg hover:border-surface-500 flex items-center gap-2"
            >
              <X size={16} />
              {cancelLabel}
              <kbd className="ml-1 px-1.5 py-0.5 bg-surface-700 rounded text-xs">Esc</kbd>
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 text-sm text-white rounded-lg flex items-center gap-2 ${
                isDanger ? "bg-amber-600 hover:bg-amber-500" : "bg-blue-600 hover:bg-blue-500"
              }`}
            >
              {confirmLabel}
              <kbd className={`ml-1 px-1.5 py-0.5 rounded text-xs ${isDanger ? "bg-amber-800" : "bg-blue-800"}`}>
                Enter
              </kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**2. Update `MainWindowLayout` to use state-based confirmation:**

```tsx
// Add state
const [archiveConfirmation, setArchiveConfirmation] = useState<{
  repoName: string;
  worktreeId: string;
  worktreeName: string;
  threadCount: number;
} | null>(null);

// Request shows the modal (no action taken yet)
const handleArchiveWorktreeRequest = useCallback((repoName: string, worktreeId: string, worktreeName: string) => {
  const threads = threadService.getByWorktree(worktreeId);
  setArchiveConfirmation({
    repoName,
    worktreeId,
    worktreeName,
    threadCount: threads.length,
  });
}, []);

// Confirm executes the archive
const handleArchiveWorktreeConfirm = useCallback(async () => {
  if (!archiveConfirmation) return;
  const { repoName, worktreeId, worktreeName } = archiveConfirmation;
  setArchiveConfirmation(null);

  try {
    const threads = threadService.getByWorktree(worktreeId);
    for (const thread of threads) {
      await threadService.archive(thread.id);
    }
    await worktreeService.delete(repoName, worktreeName);
    await worktreeService.sync(repoName);
    await useRepoWorktreeLookupStore.getState().hydrate();
    await treeMenuService.hydrate();
  } catch (error) {
    logger.error(`[MainWindowLayout] Failed to archive worktree:`, error);
  }
}, [archiveConfirmation]);

// Cancel closes the modal
const handleArchiveWorktreeCancel = useCallback(() => {
  setArchiveConfirmation(null);
}, []);

// In render:
{archiveConfirmation && (
  <ConfirmationModal
    isOpen={true}
    onConfirm={handleArchiveWorktreeConfirm}
    onCancel={handleArchiveWorktreeCancel}
    title="Archive Worktree"
    message={
      archiveConfirmation.threadCount > 0
        ? `Archive worktree "${archiveConfirmation.worktreeName}" and its ${archiveConfirmation.threadCount} thread${archiveConfirmation.threadCount === 1 ? "" : "s"}?`
        : `Archive worktree "${archiveConfirmation.worktreeName}"?`
    }
    confirmLabel="Archive"
    variant="danger"
  />
)}
```

**3. Pass `handleArchiveWorktreeRequest` to TreeMenu** (instead of `handleArchiveWorktree`)

## Recommendation

**Go with Option B** (Custom Modal) because:
- Matches the existing UI patterns (`permission-modal.tsx`)
- Can be reused for other destructive actions
- Full control over styling and behavior
- Better keyboard accessibility

**Option A** (Tauri dialog) is acceptable as a quick fix if time is limited.

## Files to Change

### Option A (Quick Fix)
1. **Modify:** `src/components/main-window/main-window-layout.tsx`
   - Add import: `import { confirm } from "@tauri-apps/plugin-dialog";`
   - Replace `window.confirm()` with `await confirm()`

### Option B (Recommended)
1. **Create:** `src/components/ui/confirmation-modal.tsx`
2. **Modify:** `src/components/main-window/main-window-layout.tsx`
   - Add confirmation state
   - Split handler into request/confirm/cancel functions
   - Render `ConfirmationModal`
3. **Modify:** `src/test/setup-ui.ts` (if adding tests)

## References

- [Tauri Dialog Plugin Documentation](https://v2.tauri.app/plugin/dialog/)
- [Tauri dialog instead of window.confirm](https://dev.to/nk_maker/tauri-dialog-instead-of-windowconfirm-32dn)
- [@tauri-apps/plugin-dialog API Reference](https://v2.tauri.app/reference/javascript/dialog/)
