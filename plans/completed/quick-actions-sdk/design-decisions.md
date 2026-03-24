# Quick Actions SDK - Design Decisions

This document captures all architectural decisions for the Quick Actions SDK implementation.

## 1. Default Project, Batteries Included

Anvil ships with a pre-configured quick actions project at `~/.anvil/quick-actions/`. Users can immediately add actions without any setup. This reduces friction while still allowing full customization.

## 2. Project-Based Architecture

Quick actions are organized into projects rather than individual scripts. This gives users full control over their build toolchain (esbuild, tsc, swc, etc.) and eliminates tsx as a runtime dependency.

## 3. Build-Time Validation

Projects must be built before use. Anvil validates the `dist/manifest.json` and entry points exist. Type checking happens at the user's build step, not at runtime.

## 4. SDK Distribution

Types are shipped as a static `.d.ts` file in the default project. The actual SDK implementation is injected at runtime by Anvil's runner.

## 5. Runtime Dependency

Only Node.js required at runtime (not tsx). User projects build to vanilla JavaScript. **Anvil does not bundle Node.js** - users must have Node.js installed on their system. Anvil should detect if Node.js is missing and provide a helpful error message.

## 6. Sandboxing

No sandboxing - scripts run with same trust as user code.

## 7. Error Display

Toast notification with "View logs" link. **Partial failures are not rolled back** - if an action fails mid-execution, the partial state remains. Atomicity and cleanup are out of scope for this plan; actions are responsible for their own error handling.

## 8. Hotkeys

App-local only (not system-wide global hotkeys). Only trigger when app window is focused. All actions share a single Cmd+0-9 hotkey pool (see decision #31).

## 9. Manual Refresh

Anvil does **not** watch for manifest changes. Users manually trigger a refresh via the "Rebuild" button in settings. This keeps implementation simple.

## 10. SDK Communication

Bidirectional IPC via stdin/stdout JSON messaging. The Node process can emit events to Anvil (UI commands, logs), and Anvil can respond if needed. However, **state reads/writes (threads, plans, git) should read directly from disk** using the adapter pattern - IPC round-trips should be rare and reserved for UI control operations.

## 11. Execution UX

When a quick action is triggered, the UI shows a loading state but **does not block interaction**. The Node process signals completion by exiting gracefully. Users can continue using the app while actions run in the background.

## 12. SDK Data Access

The SDK receives the `.anvil` directory path and reads directly from disk using the same storage format as Anvil's Zustand stores. This enables code reuse via shared transformers (disk → usable format) following the existing adapter pattern. The SDK implementation should DRY with frontend adapters where possible.

## 13. SDK Versioning

The SDK includes a version number. Anvil checks the SDK version in user projects and warns if out of date. Backwards compatibility is not guaranteed initially - users (or LLMs) can update their quick actions when SDK changes.

## 14. Action IDs

All actions (both user-defined and built-in) use UUID identifiers internally. Display names/titles can conflict freely. The manifest `id` field in user projects is a human-readable slug, but Anvil assigns a UUID when registering the action.

## 15. Logging

SDK log calls (`sdk.log.info()`, etc.) route to Anvil's main logger, appearing alongside other app logs.

## 16. Context Scope

The `'all'` context means the three main views: thread, plan, and empty. Quick actions are **not** shown on settings pages, logs pages, or when modals are open.

## 17. Execution Feedback

Small spinner in the quick actions bar with action name, disappears on completion. Simple and non-intrusive.

## 18. No Concurrent Actions

Users cannot trigger a new quick action while one is running. Hotkeys are temporarily disabled during execution to prevent race conditions and confusing state.

## 19. Action Discovery

Context-relevant actions are shown in the horizontal bar. A "Configure" CTA link appears next to the quick actions title, linking to settings where users can see all actions, assign hotkeys, and reorder.

## 20. Hotkey Conflict Resolution

When assigning a hotkey that's already in use, show an error with an option to override (reassign). User explicitly confirms the swap.

## 21. Default Actions via SDK

The existing built-in actions (Archive, Mark Unread, Next Unread, etc.) should be **implemented using the SDK** and shipped as part of the default project. This dogfoods the SDK and ensures feature parity. There are no "magic" built-in actions - everything goes through the same system.

## 22. SDK Types Distribution

Ship only a `types.d.ts` file for TypeScript support. The actual SDK implementation is injected at runtime by Anvil's runner - user projects never import real SDK code, only type definitions.

## 23. No Manifest Watching

Anvil does **not** watch for manifest changes automatically. Users manually trigger a refresh via the "Rebuild" button in settings or a refresh action. This keeps the implementation simple and avoids file watcher complexity.

## 24. State Sync via Events

When the SDK performs write operations (e.g., `sdk.threads.archive()`), it emits events through stdout only - **Anvil handles the actual disk write**. This ensures a single source of truth and avoids race conditions. The frontend listens for these events, performs the mutation, and updates Zustand stores.

## 25. Action Timeout

Quick actions have a **30-second timeout** using `Promise.race()`. If the Node process doesn't exit within 30 seconds, Anvil kills it and shows a timeout error.

## 26. Error Detail Level

When an action fails, show the **actual error message and stack trace** in the toast/error display. Users need actionable information to debug their actions.

## 27. Action Ordering

Actions are sorted **lexicographically by title** by default. Users can customize order in settings, which is persisted in the registry.

## 28. Context Switching During Execution

If a user navigates away while an action is running, the action continues executing. UI updates still apply when it completes. A **draft state** should be introduced for thread/plan inputs so in-progress content is preserved across navigation.

## 29. `navigateToNextUnread()` Empty Case

If there are no unread items, this method navigates to the **empty state** (closes the current thread/plan view).

## 30. Bootstrap Initialization

The quick actions project is created during bootstrap in an **idempotent** way. Future SDK version updates go through the established migrations pattern.

## 31. Unified Hotkey Pool

All actions (default and custom) share a single pool of Cmd+0-9 hotkeys. No reserved hotkeys - users assign all hotkeys themselves in settings. First-come-first-served, with conflict resolution UI.

## 32. Draft Persistence

Drafts are **persisted to disk** in their own store (e.g., `~/.anvil/drafts.json`), keyed by thread/plan UUID. This keeps draft state separate from thread/plan entities and survives app restarts.

## 33. SDK Write Operations

The SDK **emits events only** for write operations - it does NOT write directly to disk. Anvil handles all writes, ensuring a single source of truth. The event pattern (stdout JSON) notifies Anvil to perform the actual mutation. This keeps the SDK simple and avoids race conditions.

## 34. Empty State Actions

Actions opt into showing in empty context via their `contexts` array. Default actions like Archive/Mark Unread don't include 'empty', but users can create actions specifically for the empty state (e.g., "Start Fresh Thread", "Open Last Thread").

## 35. Settings Page Structure

Quick actions settings is a **section within an existing settings page**, but uses a **modal UI** for editing/creating individual actions. This keeps navigation simple while providing focused editing experience.
