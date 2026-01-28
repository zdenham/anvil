# Empty Content Pane Onboarding Instructions

## Overview

When no content is opened in the content pane, display the onboarding instructions that were previously shown in Mission Control's empty state.

## Source Component (from commit 2b808a7)

The `EmptyInboxState` component from `src/components/inbox/empty-inbox-state.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getSavedHotkey } from "@/lib/hotkey-service";

/**
 * Empty state component shown when there are no threads or plans in the inbox.
 * Includes getting started instructions for new users.
 */
export function EmptyInboxState() {
  const [hotkey, setHotkey] = useState<string>("...");

  useEffect(() => {
    getSavedHotkey().then(setHotkey).catch(() => setHotkey("your hotkey"));
  }, []);

  return (
    <div className="flex flex-col items-center h-full text-surface-400 px-8 pt-24">
      <div className="max-w-md space-y-6">
        <h2 className="text-xl font-medium font-mono text-surface-100">
          Welcome to Mission Control
        </h2>
        <p className="text-base">To get started:</p>
        <ol className="list-decimal list-inside space-y-3 text-base">
          <li>Press <kbd className="px-2 py-1 bg-surface-700 rounded text-surface-200 mx-1">{hotkey}</kbd></li>
          <li>Type <span className="text-surface-200">"add hello world to the readme"</span></li>
          <li>Press <kbd className="px-2 py-1 bg-surface-700 rounded text-surface-200 mx-1">Enter</kbd></li>
        </ol>
      </div>
    </div>
  );
}
```

## Target File

`src/components/content-pane/empty-pane-content.tsx`

Current content (to be replaced):

```tsx
/**
 * EmptyPaneContent
 *
 * Displayed when a content pane has no content selected.
 * Shows a helpful message guiding the user to select something.
 */

export function EmptyPaneContent() {
  return (
    <div className="flex items-center justify-center h-full text-surface-500">
      <p>Select a thread or plan from the sidebar</p>
    </div>
  );
}
```

## Implementation

Replace `src/components/content-pane/empty-pane-content.tsx` with the following (verbatim copy with updated title):

```tsx
import { useEffect, useState } from "react";
import { getSavedHotkey } from "@/lib/hotkey-service";

/**
 * EmptyPaneContent
 *
 * Displayed when a content pane has no content selected.
 * Shows onboarding instructions for new users.
 */
export function EmptyPaneContent() {
  const [hotkey, setHotkey] = useState<string>("...");

  useEffect(() => {
    getSavedHotkey().then(setHotkey).catch(() => setHotkey("your hotkey"));
  }, []);

  return (
    <div className="flex flex-col items-center h-full text-surface-400 px-8 pt-24">
      <div className="max-w-md space-y-6">
        <h2 className="text-xl font-medium font-mono text-surface-100">
          Welcome to Mission Control
        </h2>
        <p className="text-base">To get started:</p>
        <ol className="list-decimal list-inside space-y-3 text-base">
          <li>Press <kbd className="px-2 py-1 bg-surface-700 rounded text-surface-200 mx-1">{hotkey}</kbd></li>
          <li>Type <span className="text-surface-200">"add hello world to the readme"</span></li>
          <li>Press <kbd className="px-2 py-1 bg-surface-700 rounded text-surface-200 mx-1">Enter</kbd></li>
        </ol>
      </div>
    </div>
  );
}
```

## Files Changed

| File | Action |
|------|--------|
| `src/components/content-pane/empty-pane-content.tsx` | Replace content with onboarding instructions |

## Verification

1. Open the app with no content selected
2. Verify the onboarding instructions appear:
   - "Welcome to Mission Control" title
   - "To get started:" text
   - Three numbered steps with hotkey display
3. Verify the hotkey displays correctly (loads from saved settings)
