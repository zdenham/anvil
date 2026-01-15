# App.tsx Integration

## Files to Modify

- `src/App.tsx`

## Purpose

Update the main app entry to render `MainWindowLayout` after onboarding instead of hiding the window. The main window becomes the primary interface with sidebar navigation.

---

## Current App.tsx Behavior

The current implementation:
1. Shows `OnboardingFlow` until complete
2. Calls `hideMainWindow()` after onboarding
3. Listens for `open-thread` events to show `ThreadWindow` when a thread is opened from spotlight
4. Main window is hidden most of the time

```typescript
// Current flow:
// - hasOnboarded === null → null (loading)
// - hasOnboarded === false → OnboardingFlow
// - hasOnboarded === true && activeThreadId → ThreadWindow
// - hasOnboarded === true && !activeThreadId → "Running in background" message
```

---

## New Behavior

After this change:
1. Shows `OnboardingFlow` until complete
2. **Hydrates entities** after onboarding
3. Renders `MainWindowLayout` as the primary interface
4. **Removes** the background `open-thread` listener (threads now opened from within MainWindow)
5. Main window stays visible as the main app interface

---

## Implementation

```typescript
import { useState, useEffect } from "react";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { MainWindowLayout } from "@/components/main-window/main-window-layout";
import { hydrateEntities } from "@/entities";
import {
  isOnboarded,
  completeOnboarding,
  // NOTE: hideMainWindow removed - window should stay visible
} from "@/lib/hotkey-service";

function App() {
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Check onboarding status
    isOnboarded().then(setHasOnboarded).catch(console.error);
  }, []);

  useEffect(() => {
    // Hydrate entities when app loads (after onboarding)
    if (hasOnboarded) {
      hydrateEntities().then(() => setIsHydrated(true));
    }
  }, [hasOnboarded]);

  const handleOnboardingComplete = async () => {
    await completeOnboarding();
    setHasOnboarded(true);
    // NOTE: Do NOT call hideMainWindow() - window should stay visible
  };

  // Loading state
  if (hasOnboarded === null) {
    return <LoadingScreen />;
  }

  // Onboarding flow
  if (!hasOnboarded) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  // Wait for hydration
  if (!isHydrated) {
    return <LoadingScreen />;
  }

  // Main application
  return <MainWindowLayout />;
}

function LoadingScreen() {
  return (
    <div className="h-screen flex items-center justify-center bg-slate-900">
      <div className="text-slate-500">Loading...</div>
    </div>
  );
}

export default App;
```

---

## Key Changes Summary

| Change | Before | After |
|--------|--------|-------|
| After onboarding | `hideMainWindow()` | Render `MainWindowLayout` |
| Main window | Hidden after setup | Always visible |
| Entity hydration | In spotlight-main.tsx | In App.tsx (centralized) |
| Thread opening | Via `open-thread` event listener | Via sidebar → `openThread()` |

---

## Removed Code

Remove from current `App.tsx`:

```typescript
// DELETE: Thread window state and listener
const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

// DELETE: open-thread event listener
useEffect(() => {
  const unlistenPromise = listen<OpenThreadPayload>("open-thread", (event) => {
    setActiveThreadId(event.payload.threadId);
  });
  return () => {
    unlistenPromise.then((unlisten) => unlisten());
  };
}, []);

// DELETE: ThreadWindow rendering
if (activeThreadId) {
  return <ThreadWindow threadId={activeThreadId} />;
}

// DELETE: hideMainWindow import and call
import { hideMainWindow } from "./lib/hotkey-service";
await hideMainWindow();
```

---

## New Imports

```typescript
// ADD:
import { hydrateEntities } from "@/entities";
import { MainWindowLayout } from "@/components/main-window/main-window-layout";

// KEEP:
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { isOnboarded, completeOnboarding } from "@/lib/hotkey-service";
```

---

## Thread Window Behavior

With this change, the main window handles the threads list internally. When a user clicks a thread:

1. `ThreadListItem` calls `openThread(threadId)` from `@/lib/hotkey-service`
2. This invokes the Tauri command to open the separate thread panel window
3. Thread panel receives the `open-thread` event (handled in `thread-main.tsx`)

The main window no longer needs to listen for thread events - that's handled by the dedicated thread panel.

---

## Testing

1. **Fresh install**: Should show onboarding, then main layout with sidebar
2. **Returning user**: Should show loading, hydrate, then main layout
3. **Sidebar navigation**: All tabs (Tasks, Threads, Settings) should work
4. **Entity data**: Threads should load in threads list after hydration
5. **Thread opening**: Clicking a thread should open the thread panel window

---

## Migration Notes

- The `open-thread` listener is still needed in `thread-main.tsx` (thread panel window)
- Spotlight still creates tasks and opens thread panel directly via `openThread()`
- Main window now serves as the hub for browsing and managing threads/tasks/settings
