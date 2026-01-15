# Main Window Layout - Overview

## Summary

Create a main window view that houses onboarding before setup, then displays a sidebar with three tabs: Tasks, Threads, and Settings.

## Current State

- Main entry: `src/main.tsx` → `App.tsx` (shows onboarding then hides window)
- Separate panels: Spotlight, Thread, Clipboard (each with own HTML entry)
- Onboarding: single-step hotkey recording in `src/components/onboarding/OnboardingFlow.tsx`
- Kanban design exists in `plans/kanban-task-ui.md`
- No current sidebar or tab navigation patterns

## Design Decisions

- **Window behavior**: Always visible (normal window, not panel that hides on blur)
- **Tasks tab**: Stub page for now - kanban will be developed separately per `plans/kanban-task-ui.md`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Window                            │
│  ┌──────────┬──────────────────────────────────────────────┤
│  │          │                                              │
│  │  Sidebar │              Content Area                    │
│  │          │                                              │
│  │  ┌─────┐ │   ┌────────────────────────────────────────┐ │
│  │  │Tasks│ │   │  TaskBoardPage (kanban/list)           │ │
│  │  ├─────┤ │   │  ThreadsListPage                       │ │
│  │  │Thrd │ │   │  SettingsPage                          │ │
│  │  ├─────┤ │   └────────────────────────────────────────┘ │
│  │  │Sett │ │                                              │
│  │  └─────┘ │                                              │
│  └──────────┴──────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/components/main-window/
  main-window-layout.tsx
  sidebar.tsx
  tasks-page.tsx               # Stub for now
  threads-list-page.tsx
  thread-list-item.tsx
  settings-page.tsx
  settings-section.tsx
  settings/
    hotkey-settings.tsx
    api-key-settings.tsx
    repository-settings.tsx
    about-settings.tsx
  index.ts
```

## Sub-Plans

| Plan | Description |
|------|-------------|
| [01-main-window-layout.md](./01-main-window-layout.md) | Container component with sidebar + content |
| [02-sidebar.md](./02-sidebar.md) | Left nav with tab buttons |
| [03-tasks-page.md](./03-tasks-page.md) | Stub page for kanban |
| [04-threads-list-page.md](./04-threads-list-page.md) | List view + item component |
| [05-settings-page.md](./05-settings-page.md) | Settings container + all sections |
| [06-app-integration.md](./06-app-integration.md) | App.tsx modifications |

## Implementation Order

1. `01-main-window-layout.md` - Layout container
2. `02-sidebar.md` - Navigation sidebar
3. `06-app-integration.md` - Update App.tsx (enables testing)
4. `03-tasks-page.md` - Tasks stub
5. `04-threads-list-page.md` - Threads list
6. `05-settings-page.md` - Settings sections

## Naming Convention

- **UI**: Use "Threads" in all user-facing text
- **Code**: Entity layer already uses `threads` (rename from conversations is complete)
- **Components**: Name as `thread-*` (e.g., `thread-list-item.tsx`, `threads-list-page.tsx`)
- **Types**: Use `ThreadMetadata`, `useThreadStore`, `threadService` from `@/entities/threads`

## Dependencies

- `lucide-react` - Icons (already installed)
- No new dependencies needed

## Key Imports Reference

| Import | Source | Purpose |
|--------|--------|---------|
| `useThreadStore`, `ThreadMetadata` | `@/entities/threads` | Thread data and types |
| `hydrateEntities` | `@/entities` | Load entities from disk at startup |
| `openThread` | `@/lib/hotkey-service` | Open thread panel window |
| `formatRelativeTime` | `@/lib/utils/time-format` | Format timestamps |
| `isOnboarded`, `completeOnboarding` | `@/lib/hotkey-service` | Onboarding state |
| `repoService`, `useRepoStore` | `@/entities/repositories` | Repository data |
