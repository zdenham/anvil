# Stream 1: Left Menu Evolution

**Dependencies**: None (can execute in parallel with Streams 2 & 3)

## Goal

Transform `WorkspaceSidebar` into `LeftMenu` with updated tab structure and always-visible thread list.

## Changes to Tab Structure

```typescript
// OLD
export type WorkspaceTab = "overview" | "changes" | "threads";

// NEW
export type WorkspaceTab = "overview" | "changes" | "git";
```

## Implementation Steps

### Step 1.1: Rename Component File

Rename `workspace-sidebar.tsx` → `left-menu.tsx`

Update imports in `task-workspace.tsx`.

### Step 1.2: Update Tab Type

In the renamed file:

```typescript
export type WorkspaceTab = "overview" | "changes" | "git";
```

### Step 1.3: Update Props Interface

```typescript
interface LeftMenuProps {
  taskTitle: string;              // NEW: display task name at top
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  fileChangeCount: number;
  commitCount?: number;           // NEW: for git badge
  // Thread selection (always visible, not tab-dependent)
  threads: ThreadMetadata[];
  activeThreadId: string | null;
  onThreadSelect: (threadId: string) => void;
}
```

**Removed**: `isCollapsed`, `onToggleCollapse` - left menu is always expanded (collapse button moves to ChatPane)

### Step 1.4: Update Component Structure

```tsx
export function LeftMenu({
  taskTitle,
  activeTab,
  onTabChange,
  fileChangeCount,
  commitCount,
  threads,
  activeThreadId,
  onThreadSelect,
}: LeftMenuProps) {
  return (
    <div className="w-48 h-full flex flex-col border-r border-slate-700/50 bg-slate-900/30">
      {/* Task title at top */}
      <div className="px-3 py-3 border-b border-slate-700/50">
        <h2 className="text-sm font-medium text-slate-200 truncate">
          {taskTitle}
        </h2>
      </div>

      {/* Tab buttons */}
      <div className="flex flex-col">
        <TabButton
          active={activeTab === "overview"}
          onClick={() => onTabChange("overview")}
          icon={<FileText size={14} />}
        >
          Overview
        </TabButton>
        <TabButton
          active={activeTab === "changes"}
          onClick={() => onTabChange("changes")}
          badge={fileChangeCount > 0 ? fileChangeCount : undefined}
          icon={<GitBranch size={14} />}
        >
          Changes
        </TabButton>
        <TabButton
          active={activeTab === "git"}
          onClick={() => onTabChange("git")}
          badge={commitCount}
          icon={<GitCommit size={14} />}
        >
          Git
        </TabButton>
      </div>

      {/* Thread list - always visible */}
      <div className="flex-1 overflow-auto border-t border-slate-700/50 mt-2">
        <div className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">
          Threads
        </div>
        <ThreadsList
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={onThreadSelect}
        />
      </div>
    </div>
  );
}
```

### Step 1.5: Update TabButton Component

Add icon prop support to `tab-button.tsx`:

```typescript
interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  icon?: React.ReactNode;  // NEW
}
```

```tsx
export function TabButton({ active, onClick, children, badge, icon }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors
        ${active
          ? "bg-slate-700/30 text-slate-200 border-l-2 border-blue-500"
          : "text-slate-400 hover:text-slate-300 hover:bg-slate-800/30 border-l-2 border-transparent"
        }
      `}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {badge !== undefined && badge > 0 && (
        <span className="px-1.5 py-0.5 text-xs rounded-full bg-slate-700 text-slate-300">
          {badge}
        </span>
      )}
    </button>
  );
}
```

### Step 1.6: Remove SidebarCollapseButton from LeftMenu

The collapse button is removed from here - it will be added to ChatPane in Stream 3.

## Files Modified

1. `src/components/workspace/workspace-sidebar.tsx` → `src/components/workspace/left-menu.tsx`
2. `src/components/workspace/tab-button.tsx` - Add icon prop

## Files to Update Later (Stream 4)

- `src/components/workspace/task-workspace.tsx` - Update imports and usage

## Verification

After completing this stream:
1. Component compiles without errors
2. `LeftMenu` exports `WorkspaceTab` type correctly
3. TabButton accepts icon prop
4. ThreadsList is always visible (not conditional on tab)

## Notes

- The collapse functionality moves to the ChatPane (Stream 3)
- Thread selection now updates ChatPane (wired in Stream 4), not main content
- Default active tab should be "overview" (change in Stream 4)
