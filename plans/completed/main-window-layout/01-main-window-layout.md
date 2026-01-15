# Main Window Layout Component

## File

`src/components/main-window/main-window-layout.tsx`

## Purpose

Container component that provides the overall structure: sidebar on the left, content area on the right. Manages active tab state.

## Implementation

```typescript
import { useState } from "react";
import { Sidebar } from "./sidebar";
import { TasksPage } from "./tasks-page";
import { ThreadsListPage } from "./threads-list-page";
import { SettingsPage } from "./settings-page";

export type TabId = "tasks" | "threads" | "settings";

export function MainWindowLayout() {
  const [activeTab, setActiveTab] = useState<TabId>("tasks");

  return (
    <div className="flex h-screen bg-slate-900">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 overflow-hidden">
        {activeTab === "tasks" && <TasksPage />}
        {activeTab === "threads" && <ThreadsListPage />}
        {activeTab === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
```

## Props

None - this is the root layout component.

## State

| State | Type | Description |
|-------|------|-------------|
| `activeTab` | `TabId` | Currently selected tab |

## Styling

- Full viewport height (`h-screen`)
- Flex row layout
- Background: `slate-900`
- Content area takes remaining space (`flex-1`)
- Content overflow hidden (scroll handled by child pages)

## Dependencies

- `./sidebar`
- `./tasks-page`
- `./threads-list-page`
- `./settings-page`
