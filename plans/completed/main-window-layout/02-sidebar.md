# Sidebar Component

## File

`src/components/main-window/sidebar.tsx`

## Purpose

Left navigation panel with tab buttons for Tasks, Threads, and Settings.

## Implementation

```typescript
import { CheckSquare, MessageSquare, Settings } from "lucide-react";
import type { TabId } from "./main-window-layout";

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

interface NavItem {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const navItems: NavItem[] = [
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "threads", label: "Threads", icon: MessageSquare },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <aside className="w-56 bg-slate-950 border-r border-slate-800 flex flex-col">
      <div className="p-4 border-b border-slate-800">
        <h1 className="text-lg font-semibold text-slate-100">Anvil</h1>
      </div>
      <nav className="flex-1 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left
                transition-colors duration-150
                ${isActive
                  ? "bg-slate-800/50 text-slate-100 border-r-2 border-blue-500"
                  : "text-slate-400 hover:bg-slate-800/30 hover:text-slate-300"
                }
              `}
            >
              <Icon size={20} />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
```

## Props

| Prop | Type | Description |
|------|------|-------------|
| `activeTab` | `TabId` | Currently selected tab |
| `onTabChange` | `(tab: TabId) => void` | Callback when tab is clicked |

## Styling

- Width: 224px (`w-56`)
- Background: `slate-950`
- Border right: `slate-800`
- Active state: `slate-800/50` bg + `blue-500` right border
- Inactive state: `slate-400` text, hover shows `slate-800/30` bg

## Icons

- Tasks: `CheckSquare`
- Threads: `MessageSquare`
- Settings: `Settings`

## Dependencies

- `lucide-react`
- `./main-window-layout` (TabId type)
