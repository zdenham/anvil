# External Link Handling in Tauri WebView

> **Status:** Planned

## Problem Statement

Links clicked from markdown content are opening inside the Tauri WebView instead of opening in the system's default browser. This makes navigation impossible since there's no browser chrome (back button, URL bar) to escape.

## Diagnosis

### Current Implementation Analysis

The app has a global click handler in `src/main.tsx` (lines 29-42):

```tsx
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const anchor = target.closest("a");
  if (!anchor) return;

  const href = anchor.getAttribute("href");
  if (href?.startsWith("http://") || href?.startsWith("https://")) {
    e.preventDefault();
    openUrl(href).catch((err) => {
      logger.error("[main] Failed to open external URL:", err);
    });
  }
});
```

### Why This Approach Fails

**Root Cause 1: Event Propagation Race Condition**

The `click` event listener relies on `e.preventDefault()` to stop the default browser navigation. However, in a WebView context, certain events may not bubble up correctly, or the default navigation action may trigger before the JavaScript handler runs.

**Root Cause 2: Missing Navigation Handler at WebView Level**

Tauri's WebView uses the native browser engine (WKWebView on macOS, WebView2 on Windows), which handles navigation at a lower level than JavaScript event handlers. When the WebView decides to navigate, it happens at the native level BEFORE JavaScript gets a chance to intercept.

**Root Cause 3: No Tauri-Level Navigation Interception**

The Tauri backend (`src-tauri/`) has NO `on_navigation` handler configured on any `WebviewWindowBuilder`. This means the WebView has full autonomy over navigation decisions.

**Root Cause 4: Edge Cases Not Covered**

- Middle-click (open in new tab) bypasses click handlers
- Ctrl+click / Cmd+click for new tab
- Dragging links
- JavaScript-triggered navigations (`window.location = url`)
- Form submissions
- Meta refresh redirects
- Links with `target="_blank"` may or may not trigger click events

### Where Links Are Rendered

1. **MarkdownRenderer** (`src/components/thread/markdown-renderer.tsx`): Uses `react-markdown` but has NO custom link component - links render as default `<a>` tags
2. **WebSearchToolBlock** (`src/components/thread/tool-blocks/web-search-tool-block.tsx`): Has its own explicit click handler with `e.stopPropagation()`
3. Other components may render links that rely on the global handler

---

## Solution: Defense in Depth

To **completely** solve this category of issue, we need multiple layers of protection:

### Layer 1: Tauri-Level Navigation Handler (CRITICAL - Primary Defense)

Add an `on_navigation` handler to ALL `WebviewWindowBuilder` instances in Rust. This intercepts navigation at the WebView native level, BEFORE it can happen.

**File: `src-tauri/src/lib.rs`**

Add navigation handler when creating windows:

```rust
use tauri::Url;

// Add to WebviewWindowBuilder chain
.on_navigation(|url| {
    // Allow navigation to our app's internal URLs
    if url.scheme() == "tauri" || url.scheme() == "http" && url.host_str() == Some("localhost") {
        return true;
    }

    // Block all external navigation in the WebView
    // The frontend will handle opening these in the system browser
    if url.scheme() == "http" || url.scheme() == "https" {
        tracing::info!("Blocked navigation to external URL: {}", url);
        // Emit event to frontend to open in browser
        // Or use tauri_plugin_opener directly here
        return false;
    }

    true
})
```

**Files to modify:**
- `src-tauri/src/lib.rs` (line ~312 for main window recreation)
- `src-tauri/src/panels.rs` (line ~1238 for control panel windows)

### Layer 2: Custom Link Component in React Markdown

Add explicit link handling at the component level so links never even try to use default `<a>` behavior.

**File: `src/components/thread/markdown-renderer.tsx`**

Add to the `components` object:

```tsx
import { openUrl } from "@tauri-apps/plugin-opener";

// In the components useMemo:
a: ({ href, children, ...props }: {
  href?: string;
  children?: React.ReactNode;
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (href) {
      openUrl(href).catch((err) => {
        console.error("Failed to open URL:", err);
      });
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
      {...props}
    >
      {children}
    </a>
  );
},
```

### Layer 3: Improved Global Click Handler

Keep the global handler as a fallback, but make it more robust:

**File: `src/main.tsx`**

```tsx
// Global handler to open external links in system browser (fallback)
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const anchor = target.closest("a");
  if (!anchor) return;

  const href = anchor.getAttribute("href");
  if (!href) return;

  // Check for external URLs
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      // Always prevent default for external links
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      openUrl(url.href).catch((err) => {
        logger.error("[main] Failed to open external URL:", err);
      });
    }
  } catch {
    // Invalid URL, let it be handled normally
  }
}, true); // Use capture phase to intercept early
```

**Key improvements:**
- Use capture phase (`true` as third argument) to intercept events before they reach targets
- Use `stopImmediatePropagation()` in addition to `preventDefault()`
- Parse URLs properly to handle relative URLs that resolve to external hosts

### Layer 4: Prevent window.location Navigation

Add protection against programmatic navigation:

**File: `src/main.tsx`** (or a new utility file)

```tsx
// Intercept programmatic navigation attempts
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
// Note: This is complex and may have side effects - Layer 1 is the real solution
```

This layer is complex and potentially fragile. Layer 1 (Tauri navigation handler) is the proper solution for this case.

---

## Implementation Plan

### Step 1: Add Tauri Navigation Handler (Highest Priority)

1. Create a reusable navigation handler function in `src-tauri/src/lib.rs`:

```rust
/// Creates a navigation handler that blocks external URLs
fn create_navigation_handler(app_handle: AppHandle) -> impl Fn(Url) -> bool + Clone {
    move |url: Url| {
        // Allow localhost dev server
        if url.scheme() == "http" && url.host_str() == Some("localhost") {
            return true;
        }

        // Allow tauri:// protocol (internal app URLs)
        if url.scheme() == "tauri" {
            return true;
        }

        // Block external http/https - open in system browser instead
        if url.scheme() == "http" || url.scheme() == "https" {
            tracing::info!("Opening external URL in system browser: {}", url);
            let url_string = url.to_string();
            let app = app_handle.clone();
            // Open in system browser using tauri-plugin-opener
            tauri::async_runtime::spawn(async move {
                if let Err(e) = app.opener().open_url(&url_string, None::<&str>) {
                    tracing::error!("Failed to open URL in browser: {}", e);
                }
            });
            return false;
        }

        // Allow other schemes (file://, etc.) - they're typically safe
        true
    }
}
```

2. Apply to all window builders

### Step 2: Add Custom Link Component to MarkdownRenderer

Update `src/components/thread/markdown-renderer.tsx` to include an explicit `a` component handler.

### Step 3: Improve Global Click Handler

Update `src/main.tsx` to use capture phase and better URL parsing.

### Step 4: Test All Link Scenarios

Create a test markdown document with various link types:
- Regular markdown links `[text](url)`
- Autolinks `<https://example.com>`
- Raw URLs `https://example.com`
- Relative URLs that become external
- Links with `target="_blank"`

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `src-tauri/src/lib.rs` | Add navigation handler to main window builder | High |
| `src-tauri/src/panels.rs` | Add navigation handler to panel window builders | High |
| `src/components/thread/markdown-renderer.tsx` | Add custom `a` component | Medium |
| `src/main.tsx` | Improve global click handler with capture phase | Medium |

---

## Why This Completely Solves the Category of Issues

1. **Tauri-level handler** catches ALL navigation attempts at the native WebView level, before any JavaScript runs. This is the ultimate backstop.

2. **React component handler** provides explicit control over link rendering and click behavior at the component level.

3. **Global click handler (capture phase)** catches any links that slip through other handlers, including those from third-party components or dynamically generated content.

4. **Defense in depth** means if any one layer fails, the others still protect the user.

This approach handles:
- Regular left-clicks
- Middle-clicks
- Ctrl/Cmd+clicks
- Programmatic navigation via JavaScript
- Navigation triggered by the WebView engine itself
- Links from any component in the app
- Future components that render links

---

## Additional Considerations

### What About `target="_blank"`?

When a link has `target="_blank"`, the WebView may try to open a new window. Tauri handles this differently, and the navigation handler may or may not be called. The React component-level handler prevents this by always intercepting clicks.

### What About Forms?

Form submissions (GET/POST to external URLs) would also navigate away. The navigation handler blocks these too. If forms need to submit to external services, they should use `fetch()` instead.

### Mobile/Tablet Gestures?

Touch gestures are handled similarly to clicks, so the same handlers apply.

### Accessibility?

The custom link component should preserve:
- Keyboard navigation (Enter key activates links)
- Screen reader announcements
- Focus indicators

The proposed implementation preserves these since it still renders an `<a>` element.
