# Add Refresh Button to Inbox List Panel

## Overview

Add a refresh button to the **Inbox List Panel** (`InboxListWindow`) — the quick-switcher overlay that appears during Alt+Down/Up navigation mode displaying a list of threads and plans. This will allow users to manually refresh thread and plan data from disk while viewing the inbox list.

**Important:** This is NOT the Control Panel (detail view). The Inbox List Panel is:
- Component: `src/components/inbox-list/InboxListWindow.tsx`
- Shows a unified list of threads and plans for quick keyboard navigation
- Displays "Mission Control Panel" in its header
- Appears during Alt+Down/Up navigation mode

## Current State

The main window's mission control page (`main-window-layout.tsx`) has a refresh button in `InboxHeader` that:
- Calls `threadService.hydrate()` and `planService.hydrate()` in parallel
- Shows a spinning `RefreshCw` icon during refresh
- Is disabled while refreshing

The Inbox List Panel (`InboxListWindow.tsx`) currently has no refresh functionality — just a static header with the title "Mission Control Panel".

## Implementation

### 1. Add refresh state and handler to InboxListWindow

**File:** `src/components/inbox-list/InboxListWindow.tsx`

- Import `RefreshCw` from `lucide-react`
- Import `threadService` and `planService`
- Add `isRefreshing` state variable
- Create `handleRefresh` callback that:
  - Sets `isRefreshing` to true
  - Calls `threadService.hydrate()` and `planService.hydrate()` in parallel (same as main window)
  - Sets `isRefreshing` to false when complete

### 2. Add refresh button to header

**File:** `src/components/inbox-list/InboxListWindow.tsx`

- Add a refresh button in the header section next to the "Mission Control Panel" title
- Button should:
  - Use the same styling as the main window refresh button
  - Spin when `isRefreshing` is true
  - Be disabled during refresh
  - Stop event propagation on click (to avoid interfering with navigation)

### 3. Button placement

The refresh button should be placed in the header, to the right of the title:
- `[Mission Control Panel] ... [Refresh button]`

## Files to Modify

1. `src/components/inbox-list/InboxListWindow.tsx` - Add refresh button UI, state, and handler

## Acceptance Criteria

- [ ] Refresh button appears in Inbox List Panel header (next to "Mission Control Panel" title)
- [ ] Clicking refresh reloads threads and plans from disk
- [ ] Button shows spinning animation during refresh
- [ ] Button is disabled while refreshing
- [ ] Click does not interfere with navigation mode (proper event handling)
- [ ] Matches visual style of existing main window refresh button
