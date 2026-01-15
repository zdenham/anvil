# Error Panel Implementation

## Problem

Errors thrown from the spotlight panel can't be displayed to users because the spotlight hides on blur (`window_did_resign_key`). By the time `showError()` is called, the panel is already hidden.

## Solution

Create a dedicated error panel (like spotlight, clipboard, task panels) that:
- Reuses the existing `GlobalErrorView` component from `src/components/global-error-view.tsx`
- Hides on blur like other panels
- Can be invoked from any context via Tauri command

## Current UI Reference

The error panel will use the existing `GlobalErrorView` component (`src/components/global-error-view.tsx`):

```tsx
<div className="fixed inset-0 bg-slate-900 p-4 overflow-auto">
  <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono">
    {message}
    {stack && `\n\n${stack}`}
  </pre>
  <div className="mt-2 text-xs">
    <button className="text-slate-400 hover:text-slate-200 underline">
      {copied ? "copied" : "copy"}
    </button>
    <span className="text-slate-500 mx-2">·</span>
    <button className="text-slate-400 hover:text-slate-200 underline">
      dismiss
    </button>
  </div>
</div>
```

Design characteristics:
- `bg-slate-900` background
- Left-aligned raw text in `<pre>` with `text-xs text-slate-300 font-mono`
- `overflow-auto` for scrolling long stack traces
- Text-style underlined buttons ("copy" / "dismiss") separated by `·`
- Copy shows "copied" feedback for 2 seconds

## Implementation

### 1. Rust: Panel Definition (`src-tauri/src/panels.rs`)

Add constants:
```rust
pub const ERROR_LABEL: &str = "error";
pub const ERROR_WIDTH: f64 = 500.0;
pub const ERROR_HEIGHT: f64 = 300.0;
```

Add to `tauri_panel!` macro block:
```rust
panel!(ErrorPanel {
    config: {
        can_become_key_window: true,
        is_floating_panel: true
    }
})

panel_event!(ErrorEventHandler {
    window_did_resign_key(notification: &NSNotification) -> ()
})
```

Add `create_error_panel` function (similar to other panels):
- Use `PanelLevel::ScreenSaver` to appear above spotlight
- Borderless, transparent background
- Set up `window_did_resign_key` handler to hide on blur

Add commands:
```rust
pub fn show_error(app: &AppHandle, message: &str, stack: Option<&str>) -> Result<(), String>
pub fn hide_error(app: &AppHandle) -> Result<(), String>
```

### 2. Rust: Register Commands (`src-tauri/src/lib.rs`)

- Call `create_error_panel(app)` in app setup
- Register `show_error_panel` and `hide_error_panel` commands

### 3. Frontend: Entry Point

Create `error.html`:
```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="/src/index.css" />
  </head>
  <body class="bg-transparent">
    <div id="root"></div>
    <script type="module" src="/src/error-main.tsx"></script>
  </body>
</html>
```

Create `src/error-main.tsx`:
```tsx
import ReactDOM from "react-dom/client";
import "./index.css";
import { ErrorPanel } from "./components/error-panel";

ReactDOM.createRoot(document.getElementById("root")!).render(<ErrorPanel />);
```

### 4. Frontend: Error Panel Component

Create `src/components/error-panel.tsx`:
```tsx
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { GlobalErrorView } from "./global-error-view";

interface ErrorPayload {
  message: string;
  stack?: string;
}

export function ErrorPanel() {
  const [error, setError] = useState<ErrorPayload | null>(null);

  useEffect(() => {
    const unlistenError = listen<ErrorPayload>("show-error", (event) => {
      setError(event.payload);
    });

    const unlistenHidden = listen("panel-hidden", () => {
      setError(null);
    });

    return () => {
      unlistenError.then((fn) => fn());
      unlistenHidden.then((fn) => fn());
    };
  }, []);

  if (!error) return null;

  return (
    <GlobalErrorView
      message={error.message}
      stack={error.stack}
      onDismiss={() => invoke("hide_error_panel")}
    />
  );
}
```

Reuses the existing `GlobalErrorView` component from `src/components/global-error-view.tsx`.

### 5. Frontend: Tauri Config

Add to `tauri.conf.json` build targets (if needed for the error.html entry).

### 6. Integration: Update Spotlight

In `src/components/spotlight/spotlight.tsx`:
- Remove `useGlobalError` import and usage
- In the `.catch()` handler, call:
  ```typescript
  invoke("show_error_panel", { message, stack });
  ```

### 7. Optional: Other Windows

The error panel can be invoked from any window (main, task, clipboard) using the same `invoke("show_error_panel", ...)` pattern.

## File Changes Summary

| File | Change |
|------|--------|
| `src-tauri/src/panels.rs` | Add ErrorPanel, ErrorEventHandler, create/show/hide functions |
| `src-tauri/src/lib.rs` | Register commands, create panel on startup |
| `error.html` | New entry point |
| `src/error-main.tsx` | New React entry |
| `src/components/error-panel.tsx` | New component |
| `src/components/spotlight/spotlight.tsx` | Use invoke instead of context |
| `tauri.conf.json` | Add error.html to build if needed |

## Design Notes

- Panel appears centered on the screen with the mouse cursor (like other panels)
- Same blur-to-dismiss behavior as spotlight/clipboard
- Reuses `GlobalErrorView` from `src/components/global-error-view.tsx` unchanged
- Dismiss button calls `invoke("hide_error_panel")` which hides the panel
