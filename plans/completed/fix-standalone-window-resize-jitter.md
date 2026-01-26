# Fix Standalone Control Panel Window Resize Jitter

## Problem

Resizing standalone control panel windows causes extremely jarring visual jitter. The content appears to jump, flicker, and stutter during resize operations. Notably, this jitter **only occurs with standalone windows**, not with NSPanel windows.

## Diagnosis

### Root Cause: Resize Event Handler Conflicts with Native Resize

**Location**: `src/components/control-panel/control-panel-window.tsx`, lines 269-294

```typescript
useEffect(() => {
  const currentWindow = getCurrentWindow();
  let hasPinned = false;

  const handleResize = async () => {
    if (!hasPinned) {
      try {
        await invoke("pin_control_panel");  // ❌ Async IPC call
        hasPinned = true;
      } catch (err) { ... }
    }
  };

  const unlisten = currentWindow.onResized(handleResize);
  ...
}, []);
```

**Issue**: The `onResized` event listener is firing during resize operations, and this custom resize handling logic appears to conflict with native window resizing behavior. Since the jitter only occurs with standalone windows (not NSPanel), the problem is likely that:

1. The `pin_control_panel` IPC call is designed specifically for NSPanel behavior
2. When called on a standalone window, it may trigger conflicting behavior or unnecessary operations
3. Standalone windows don't need this pinning logic at all - they're already independent windows

The `pin_control_panel` command is designed for NSPanel behavior where the panel should stay visible on blur. Standalone windows are already independent and don't need this behavior.

## Proposed Fix

### Skip Pin Logic for Standalone Windows

The resize handler should not run at all for standalone windows since pinning is an NSPanel-specific behavior:

```typescript
// Pin panel when resized - NSPanel specific behavior
// Standalone windows are already independent and don't need pinning
useEffect(() => {
  // Skip for standalone windows - pinning is only for NSPanel
  if (isStandaloneWindow) return;

  const currentWindow = getCurrentWindow();
  let hasPinned = false;

  const handleResize = async () => {
    if (!hasPinned) {
      try {
        await invoke("pin_control_panel");
        hasPinned = true;
        logger.debug("[ControlPanelWindow] Panel pinned due to resize");
      } catch (err) {
        logger.error("[ControlPanelWindow] Failed to pin panel for resize:", err);
      }
    }
  };

  const unlisten = currentWindow.onResized(handleResize);
  return () => {
    unlisten.then((unlistenFn) => unlistenFn());
  };
}, [isStandaloneWindow]);
```

**This should eliminate the jitter for standalone windows.**

## Testing

After implementing:
1. Open a standalone control panel window
2. Resize by dragging any edge or corner
3. Observe that content no longer jitters/jumps
4. Verify that NSPanel behavior still works correctly (pin on resize)

## Files to Modify

- `src/components/control-panel/control-panel-window.tsx`
