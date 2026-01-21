# External Link Handling for NSPanel Webviews

## Problem

Links within the Tauri NSPanel webviews are being opened inside the panel instead of in the user's default external browser. This is problematic because:
1. The NSPanel is a utility panel with limited navigation capabilities
2. Users expect links to open in their regular browser
3. The panel may not have proper back navigation, causing users to get stuck

## Current State

### Markdown Rendering Locations

Links can appear in markdown content rendered in multiple locations:

1. **`src/components/thread/markdown-renderer.tsx`**
   - Uses `react-markdown` (v10.1.0)
   - Custom components for `code` and `pre` only
   - **No custom link (`a`) component** - uses default anchor behavior

2. **`src/components/thread/text-block.tsx`**
   - Uses `Streamdown` library (v1.6.10) during streaming
   - Falls back to `MarkdownRenderer` when not streaming
   - CSS styling for links via Tailwind prose classes

3. **`src/components/workspace/action-panel.tsx`**
   - Uses `Streamdown` for review markdown content
   - Has one hardcoded `<a>` tag for PR URL (line 345-351)
   - No click interception

4. **`src/components/workspace/task-overview.tsx`**
   - Uses `ReactMarkdown` directly
   - **No custom link component** - uses default anchor behavior

### Available Tauri Infrastructure

The app already has the necessary Tauri plugins initialized:

```rust
// src-tauri/src/lib.rs (lines 717-721)
.plugin(tauri_plugin_opener::init())  // For opening URLs/paths
.plugin(tauri_plugin_shell::init())   // For shell commands
```

Frontend usage example exists in `src/components/onboarding/steps/SpotlightStep.tsx`:
```tsx
import { openUrl } from "@tauri-apps/plugin-opener";
await openUrl("x-apple.systempreferences:com.apple.preference.keyboard");
```

Test mocks already in place at `src/test/setup-ui.ts`:
```tsx
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  openPath: vi.fn(),
}));
```

## Implementation Plan

### Step 1: Create an External Link Component

Create a reusable link component that intercepts clicks and opens URLs externally.

**File:** `src/components/reusable/external-link.tsx`

```tsx
import { useCallback, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { logger } from "@/lib/logger-client";

interface ExternalLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
}

/**
 * Link component that opens URLs in the system's default browser
 * instead of within the Tauri webview.
 */
export function ExternalLink({ href, onClick, children, ...props }: ExternalLinkProps) {
  const handleClick = useCallback(
    async (e: MouseEvent<HTMLAnchorElement>) => {
      // Always prevent default navigation in webview
      e.preventDefault();

      // Call any existing onClick handler
      onClick?.(e);

      if (!href) return;

      try {
        // Open URL in system default browser
        await openUrl(href);
      } catch (error) {
        logger.error("[ExternalLink] Failed to open URL:", { href, error });
      }
    },
    [href, onClick]
  );

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
```

### Step 2: Update MarkdownRenderer to Use External Links

Modify `src/components/thread/markdown-renderer.tsx` to use the `ExternalLink` component for all links.

```tsx
import { ExternalLink } from "@/components/reusable/external-link";

// Inside ReactMarkdown components prop:
components={{
  // ... existing code and pre components
  a: ({ href, children, ...props }) => (
    <ExternalLink href={href} {...props}>
      {children}
    </ExternalLink>
  ),
}}
```

### Step 3: Update TaskOverview to Use External Links

Modify `src/components/workspace/task-overview.tsx` similarly:

```tsx
import { ExternalLink } from "@/components/reusable/external-link";

// Inside ReactMarkdown:
<ReactMarkdown
  components={{
    a: ({ href, children, ...props }) => (
      <ExternalLink href={href} {...props}>
        {children}
      </ExternalLink>
    ),
  }}
>
  {content}
</ReactMarkdown>
```

### Step 4: Update ActionPanel Hardcoded Link

Replace the hardcoded `<a>` tag in `src/components/workspace/action-panel.tsx` (line 345-351):

```tsx
import { ExternalLink } from "@/components/reusable/external-link";

// Replace:
<a
  href={prUrl}
  target="_blank"
  rel="noopener noreferrer"
  className="text-accent-400 hover:underline"
>
  {prUrl}
</a>

// With:
<ExternalLink
  href={prUrl}
  className="text-accent-400 hover:underline"
>
  {prUrl}
</ExternalLink>
```

### Step 5: Handle Streamdown Links

The `Streamdown` library renders markdown during streaming. There are two approaches:

**Option A: Global Click Handler (Recommended)**

Add a global click handler that intercepts all link clicks within Streamdown containers. This is more robust since we can't inject custom components into Streamdown.

```tsx
// In text-block.tsx or a parent component
useEffect(() => {
  const handleLinkClick = async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor?.href) {
      e.preventDefault();
      try {
        await openUrl(anchor.href);
      } catch (error) {
        logger.error("[Streamdown] Failed to open URL:", { href: anchor.href, error });
      }
    }
  };

  const container = containerRef.current;
  container?.addEventListener('click', handleLinkClick);
  return () => container?.removeEventListener('click', handleLinkClick);
}, []);
```

**Option B: Check Streamdown Configuration**

The Streamdown library may support custom component rendering. Check if it accepts a `components` prop similar to react-markdown. If so, configure it the same way as MarkdownRenderer.

### Step 6: Create a Hook for Reusability (Optional)

If the click handling logic needs to be reused, create a hook:

**File:** `src/hooks/use-external-link-handler.ts`

```tsx
import { useCallback, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { logger } from "@/lib/logger-client";

/**
 * Hook that returns a click handler for opening links externally.
 * Useful for containers that render arbitrary HTML with links.
 */
export function useExternalLinkHandler() {
  return useCallback(async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');

    if (anchor?.href) {
      e.preventDefault();
      try {
        await openUrl(anchor.href);
      } catch (error) {
        logger.error("[useExternalLinkHandler] Failed to open URL:", {
          href: anchor.href,
          error
        });
      }
    }
  }, []);
}
```

## Files to Modify

1. **Create:** `src/components/reusable/external-link.tsx` - Reusable external link component
2. **Modify:** `src/components/thread/markdown-renderer.tsx` - Add custom `a` component
3. **Modify:** `src/components/workspace/task-overview.tsx` - Add custom `a` component
4. **Modify:** `src/components/workspace/action-panel.tsx` - Replace hardcoded `<a>` tag
5. **Modify:** `src/components/thread/text-block.tsx` - Add click handler for Streamdown container
6. **Optional:** `src/hooks/use-external-link-handler.ts` - Reusable hook

## Testing

1. Click a link in a completed message (MarkdownRenderer)
2. Click a link while a message is streaming (Streamdown)
3. Click the PR URL link in the action panel
4. Click a link in the task overview panel
5. Verify URLs open in default system browser
6. Verify error handling works when openUrl fails

## Edge Cases to Consider

1. **Mailto links:** `mailto:` URLs should also open externally (handled by openUrl)
2. **Internal navigation:** If we ever need internal navigation links, we'll need to distinguish them (e.g., by protocol or domain)
3. **Keyboard navigation:** Ensure Enter key on focused links also triggers external open
4. **Middle-click:** Some users middle-click to open in new tab - should still work externally
