# 08: Control Panel Rename and Plan View Support

**Dependencies:** None (run BEFORE 03-delete-tasks.md)
**Can run parallel with:** 01-core-types.md, 02-storage-layer.md

## Goal

1. Rename "simple-task" to "control-panel" throughout the codebase. The main tab becomes "Mission Control".
2. **Add plan view support** - Control panel can now open plans (not just threads)
3. **New thread from plan** - When viewing a plan, typing and sending creates a new thread with @plan mention

**Note:** This plan must run BEFORE 03-delete-tasks.md because `use-simple-task-navigation.ts` uses task entities that will be deleted. After this rename completes, 03-delete-tasks.md will delete `use-control-panel-navigation.ts` entirely (it cannot be preserved without the task entities it depends on).

**Task Ordering:** The rename tasks (1-17) must complete BEFORE the plan view tasks (18-22). The plan view tasks import renamed components, so running them in parallel would cause import errors.

## Control Panel View Types

The control panel can now display two types of content:

```typescript
type ControlPanelViewType =
  | { type: 'thread'; threadId: string; tab: 'conversation' | 'plan' | 'changes' }
  | { type: 'plan'; planId: string; tab: 'content' | 'threads' };
```

### Thread View (existing)
- **Conversation tab** - Shows thread messages
- **Plan tab** - Shows related plans
- **Changes tab** - Shows file changes made by thread

### Plan View (new)
- **Content tab** - Rendered markdown of the plan file (read-only)
- **Threads tab** - List of related threads (created/modified/mentioned this plan)
- **NO Changes tab** - Plans don't have direct file changes

## New Thread from Plan Behavior

**Critical behavior:** When viewing a plan in the control panel:

1. If the user starts typing in the input field, the input is captured
2. When the user sends the message:
   - A **new thread is created** (not appending to existing thread)
   - The message is **automatically prefixed** with `@plan:{planId}` mention
   - This creates a `mentioned` relation between the new thread and the plan
   - The control panel switches to show the new thread's conversation

```typescript
// When plan is open and user sends message:
async function handleSendFromPlanView(planId: string, message: string) {
  // 1. Create new thread
  const thread = await threadService.create({
    repoId: plan.repoId,
    worktreeId: plan.worktreeId,
  });

  // 2. Prepend @plan mention to message
  const messageWithMention = `@plan:${planId} ${message}`;

  // 3. Send message to new thread
  await threadService.sendMessage(thread.id, messageWithMention);

  // 4. Switch control panel to show new thread
  controlPanelStore.setView({ type: 'thread', threadId: thread.id, tab: 'conversation' });
}
```

**UI indication:** When viewing a plan, the input area should show a hint like "Start a new thread about this plan..." to make the behavior clear.

## Tasks

### 1. Rename directory

```bash
mv src/components/simple-task/ src/components/control-panel/
```

**Important:** Do NOT create a new directory while leaving the old one in place. This is a move, not a copy.

### 2. Rename files

| Old | New |
|-----|-----|
| `simple-task-window.tsx` | `control-panel-window.tsx` |
| `simple-task-header.tsx` | `control-panel-header.tsx` |
| `use-simple-task-params.ts` | `use-control-panel-params.ts` |
| `simple-task-window.test.tsx` | `control-panel-window.test.tsx` |
| (etc. for all files in directory) | |

### 3. Rename entry points

| Old | New |
|-----|-----|
| `simple-task.html` | `control-panel.html` |
| `src/simple-task-main.tsx` | `src/control-panel-main.tsx` |

### 4. Update vite.config.ts

```typescript
// Before
input: {
  main: resolve(__dirname, 'index.html'),
  'simple-task': resolve(__dirname, 'simple-task.html'),
  // ...
}

// After
input: {
  main: resolve(__dirname, 'index.html'),
  'control-panel': resolve(__dirname, 'control-panel.html'),
  // ...
}
```

### 5. Update component names

In each renamed file, update:
- Component function names (e.g., `SimpleTaskWindow` → `ControlPanelWindow`)
- Export names
- Internal references

### 6. Update imports throughout codebase

Search and replace:
- `from './simple-task/` → `from './control-panel/`
- `from '../simple-task/` → `from '../control-panel/`
- `simple-task-window` → `control-panel-window`
- etc.

Ensure `index.ts` exports are updated, not duplicated.

### 7. Update hooks

Rename `src/hooks/use-simple-task-navigation.ts` → `use-control-panel-navigation.ts`:
- Update hook name (`useSimpleTaskNavigation` → `useControlPanelNavigation`)
- Update all imports

**Note:** This hook will be deleted by 03-delete-tasks.md due to its dependency on task entities.

### 8. Update Tauri window configuration

Update `src-tauri/tauri.conf.json`:
```json
{
  "windows": [
    {
      "label": "control-panel",
      "url": "control-panel.html",
      // ... other config
    }
  ]
}
```

Also check `src-tauri/capabilities/default.json` for window label references.

### 9. Update Rust code

Update `src-tauri/src/lib.rs`:
- Rename `open_simple_task()` → `open_control_panel()`
- Rename `hide_simple_task()` → `hide_control_panel()`
- Update window label references

Update `src-tauri/src/panels.rs`:
- Rename `SIMPLE_TASK_LABEL` → `CONTROL_PANEL_LABEL`
- Rename `SIMPLE_TASK_WIDTH` → `CONTROL_PANEL_WIDTH`
- Rename `SIMPLE_TASK_HEIGHT` → `CONTROL_PANEL_HEIGHT`
- Rename `PendingSimpleTask` struct → `PendingControlPanel`
- Rename `get_pending_simple_task` → `get_pending_control_panel`
- Rename `set_pending_simple_task` → `set_pending_control_panel`
- Rename `clear_pending_simple_task` → `clear_pending_control_panel`

### 10. Update hotkey service

Update `src/lib/hotkey-service.ts`:
- Rename `openSimpleTask()` → `openControlPanel()`
- Rename `hideSimpleTask()` → `hideControlPanel()`
- Rename `switchSimpleTaskClientSide()` → `switchControlPanelClientSide()`
- Update all `"simple-task"` panel label references to `"control-panel"`

### 11. Update event bridge

Update `src/lib/event-bridge.ts`:
- Rename `open-simple-task` → `open-control-panel` (in RUST_PANEL_EVENTS)
- Update all event name references

### 12. Update event types

Update `src/entities/events.ts`:
- Rename `OpenSimpleTaskPayload` → `OpenControlPanelPayload`
- Rename `SimpleTaskViewType` → `ControlPanelViewType`

### 13. Update tauri commands

Update `src/lib/tauri-commands.ts`:
- Update any `isPanelVisible("simple-task")` calls to `isPanelVisible("control-panel")`
- Update any other simple-task related function names or references

### 14. Update CSS

Update `src/index.css`:
- Rename `.simple-task-container` → `.control-panel-container`
- Update any other simple-task CSS class names

### 15. Update panel visibility hooks

Update `src/hooks/use-panel-visibility.ts`:
- Update any `"simple-task"` references to `"control-panel"`

### 16. Update UI labels

Change visible text:
- "Simple Task" → "Control Panel"
- Main tab label → "Mission Control"

### 17. Update documentation

Update `docs/patterns/event-bridge.md`:
- Change `simple-task` to `control-panel` in the known window labels list

---

## Plan View Implementation Tasks

### 18. Update control panel view types

Update `src/entities/events.ts` to support plan views:

```typescript
export type ControlPanelViewType =
  | { type: 'thread'; threadId: string; tab: 'conversation' | 'plan' | 'changes' }
  | { type: 'plan'; planId: string; tab: 'content' | 'threads' };

export interface OpenControlPanelPayload {
  view: ControlPanelViewType;
}
```

### 19. Create control panel store

Create `src/components/control-panel/store.ts`:

```typescript
import { create } from "zustand";
import type { ControlPanelViewType } from "@/entities/events";

interface ControlPanelState {
  view: ControlPanelViewType | null;
  setView: (view: ControlPanelViewType) => void;
  clearView: () => void;
}

export const useControlPanelStore = create<ControlPanelState>((set) => ({
  view: null,
  setView: (view) => set({ view }),
  clearView: () => set({ view: null }),
}));
```

### 20. Create plan view header component

Create `src/components/control-panel/plan-view-header.tsx`:

```typescript
import { usePlanStore } from "@/entities/plans/store";
import { useRelatedThreads } from "@/entities/relations/hooks";
import { getPlanDisplayName } from "@/entities/plans/utils";
import { useControlPanelStore } from "./store";

interface PlanViewHeaderProps {
  planId: string;
  activeTab: 'content' | 'threads';
}

export function PlanViewHeader({ planId, activeTab }: PlanViewHeaderProps) {
  const plan = usePlanStore((s) => s.getPlan(planId));
  const relatedThreads = useRelatedThreads(planId);
  const setView = useControlPanelStore((s) => s.setView);

  if (!plan) {
    return <div className="px-4 py-3 text-surface-400">Plan not found</div>;
  }

  const displayName = getPlanDisplayName(plan);

  return (
    <div className="border-b border-surface-700">
      <div className="px-4 py-3">
        <h2 className="text-sm font-medium text-surface-100 truncate">
          {displayName}
        </h2>
        <div className="text-xs text-surface-400">
          {relatedThreads.length} related thread{relatedThreads.length !== 1 ? 's' : ''}
        </div>
      </div>
      <div className="flex gap-1 px-3">
        <button
          onClick={() => setView({ type: 'plan', planId, tab: 'content' })}
          className={`px-3 py-2 text-xs ${
            activeTab === 'content'
              ? 'text-surface-100 border-b-2 border-accent-500'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Content
        </button>
        <button
          onClick={() => setView({ type: 'plan', planId, tab: 'threads' })}
          className={`px-3 py-2 text-xs ${
            activeTab === 'threads'
              ? 'text-surface-100 border-b-2 border-accent-500'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Threads
        </button>
      </div>
    </div>
  );
}
```

### 21. Create plan view component

Create `src/components/control-panel/plan-view.tsx`:

```typescript
import { usePlanContent } from "@/hooks/use-plan-content";
import { useRelatedThreads } from "@/entities/relations/hooks";
import { usePlanStore } from "@/entities/plans/store";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import { useControlPanelStore } from "./store";

interface PlanViewProps {
  planId: string;
  tab: 'content' | 'threads';
}

export function PlanView({ planId, tab }: PlanViewProps) {
  const plan = usePlanStore((s) => s.getPlan(planId));
  const content = usePlanContent(planId);
  const relatedThreads = useRelatedThreads(planId);
  const setView = useControlPanelStore((s) => s.setView);

  // Minimal error handling: just show "Plan not found"
  if (!plan) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400">
        Plan not found
      </div>
    );
  }

  if (tab === 'content') {
    return (
      <div className="p-4 overflow-y-auto">
        {content ? (
          <MarkdownRenderer content={content} />
        ) : (
          <div className="text-surface-400">Loading plan content...</div>
        )}
      </div>
    );
  }

  // Threads tab
  return (
    <div className="p-4">
      <h3 className="text-xs font-medium text-surface-400 uppercase tracking-wide mb-3">
        Related Threads
      </h3>
      {relatedThreads.length === 0 ? (
        <div className="text-surface-400 text-sm">No threads yet</div>
      ) : (
        <ul className="space-y-2">
          {relatedThreads.map((thread) => (
            <li
              key={thread.id}
              onClick={() => setView({ type: 'thread', threadId: thread.id, tab: 'conversation' })}
              className="px-3 py-2 bg-surface-800 rounded-lg border border-surface-700 hover:border-surface-600 cursor-pointer"
            >
              <span className="text-sm text-surface-100 truncate font-mono">
                {thread.id.slice(0, 8)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### 22. Create usePlanContent hook

Create `src/hooks/use-plan-content.ts`:

```typescript
import { useState, useEffect } from "react";
import { planService } from "@/entities/plans/service";

/**
 * Hook to load and cache plan file content.
 * Returns null while loading, string when loaded.
 */
export function usePlanContent(planId: string): string | null {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    setContent(null); // Reset on planId change
    planService.getPlanContent(planId).then(setContent);
  }, [planId]);

  return content;
}
```

### 24. Create plan input area component

Create `src/components/control-panel/plan-input-area.tsx`:

```typescript
import { useState } from "react";
import { threadService } from "@/entities/threads/service";
import { relationService } from "@/entities/relations/service";
import { usePlanStore } from "@/entities/plans/store";
import { useControlPanelStore } from "./store";

interface PlanInputAreaProps {
  planId: string;
}

export function PlanInputArea({ planId }: PlanInputAreaProps) {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const plan = usePlanStore((s) => s.getPlan(planId));
  const setView = useControlPanelStore((s) => s.setView);

  const handleSend = async () => {
    if (!message.trim() || !plan) return;

    setIsLoading(true);
    try {
      // 1. Create new thread
      const thread = await threadService.create({
        repoId: plan.repoId,
        worktreeId: plan.worktreeId,
      });

      // 2. Create relation (mentioned)
      await relationService.createOrUpgrade({
        threadId: thread.id,
        planId: planId,
        type: 'mentioned',
      });

      // 3. Send message with @plan mention prefix
      const messageWithMention = `@plan:${planId} ${message}`;
      await threadService.sendMessage(thread.id, messageWithMention);

      // 4. Switch to thread view
      setView({ type: 'thread', threadId: thread.id, tab: 'conversation' });

      setMessage("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="border-t border-surface-700 p-3">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Start a new thread about this plan..."
        className="w-full bg-surface-800 border border-surface-700 rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-surface-600"
        rows={3}
        disabled={isLoading}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <div className="flex justify-end mt-2">
        <button
          onClick={handleSend}
          disabled={!message.trim() || isLoading}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg text-sm disabled:opacity-50"
        >
          {isLoading ? 'Creating...' : 'Start Thread'}
        </button>
      </div>
    </div>
  );
}
```

### 25. Update control panel window to route views

Update `src/components/control-panel/control-panel-window.tsx`:

```typescript
// Add plan view routing
function ControlPanelContent({ view }: { view: ControlPanelViewType }) {
  if (view.type === 'plan') {
    return (
      <div className="flex flex-col h-full">
        <PlanViewHeader planId={view.planId} activeTab={view.tab} />
        <div className="flex-1 overflow-hidden">
          <PlanView planId={view.planId} tab={view.tab} />
        </div>
        <PlanInputArea planId={view.planId} />
      </div>
    );
  }

  // Existing thread view logic...
  return <ThreadView threadId={view.threadId} tab={view.tab} />;
}
```

### 26. Update inbox to open control panel with plan view

When user clicks a plan in the unified inbox, open control panel with plan view:

```typescript
// In inbox item click handler
const handlePlanSelect = (plan: PlanMetadata) => {
  // Emit event to open control panel with plan view
  eventBus.emit(EventName.OPEN_CONTROL_PANEL, {
    view: { type: 'plan', planId: plan.id, tab: 'content' }
  });
};
```

## Verification

```bash
# Should return no results
grep -r "simple-task" --include="*.ts" --include="*.tsx" --include="*.html" --include="*.rs" --include="*.json" .
grep -r "SimpleTask" --include="*.ts" --include="*.tsx" .
grep -r "simpleTask" --include="*.ts" --include="*.tsx" .
grep -r "SIMPLE_TASK" --include="*.rs" .

# Build verification
pnpm build
cd src-tauri && cargo build

# Manual verification
# - Open control panel via hotkey
# - Verify window opens correctly
```

## Acceptance Criteria

### Rename Tasks
- [ ] All files renamed
- [ ] All component names updated
- [ ] All imports updated
- [ ] Vite config updated
- [ ] Tauri window config updated
- [ ] Rust code updated (lib.rs and panels.rs)
- [ ] Hotkey service updated
- [ ] Event bridge updated
- [ ] Event types updated
- [ ] Tauri commands updated
- [ ] CSS classes updated
- [ ] Panel visibility hooks updated
- [ ] UI labels updated
- [ ] Documentation updated
- [ ] No grep matches for old names
- [ ] `pnpm build` succeeds
- [ ] `cargo build` succeeds (in src-tauri)
- [ ] Control panel opens correctly via hotkey

### Plan View Tasks
- [ ] `ControlPanelViewType` updated to support `{ type: 'plan'; planId: string; tab: 'content' | 'threads' }`
- [ ] `useControlPanelStore` created with view state management
- [ ] `PlanViewHeader` component created with tab navigation
- [ ] `usePlanContent` hook created for loading plan file content
- [ ] Plan content tab renders markdown (read-only)
- [ ] Plan threads tab shows related threads (via relations)
- [ ] No "Changes" tab for plan view
- [ ] Minimal error handling: shows "Plan not found" for missing plans
- [ ] Opening a plan from inbox opens control panel with plan view
- [ ] Input area shows "Start a new thread about this plan..." hint when viewing plan
- [ ] Sending a message from plan view creates a NEW thread
- [ ] New thread message is prefixed with `@plan:{planId}` mention
- [ ] After sending, control panel switches to show new thread conversation
- [ ] Relation is created between new thread and plan (type: 'mentioned')

## Programmatic Testing Plan

The implementation agent must write and ensure all the following tests pass before considering this plan complete.

### 1. Naming Convention Verification Tests

Create `src/components/control-panel/__tests__/naming-verification.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

describe('Control Panel Naming Convention', () => {
  const projectRoot = path.resolve(__dirname, '../../../../..');

  it('should have no files containing "simple-task" in filename', async () => {
    const files = await glob('**/*simple-task*', {
      cwd: projectRoot,
      ignore: ['node_modules/**', 'dist/**', 'target/**', 'plans/**'],
    });
    expect(files).toEqual([]);
  });

  it('should have control-panel directory instead of simple-task', () => {
    const controlPanelExists = fs.existsSync(
      path.join(projectRoot, 'src/components/control-panel')
    );
    const simpleTaskExists = fs.existsSync(
      path.join(projectRoot, 'src/components/simple-task')
    );
    expect(controlPanelExists).toBe(true);
    expect(simpleTaskExists).toBe(false);
  });

  it('should have control-panel.html instead of simple-task.html', () => {
    const controlPanelHtmlExists = fs.existsSync(
      path.join(projectRoot, 'control-panel.html')
    );
    const simpleTaskHtmlExists = fs.existsSync(
      path.join(projectRoot, 'simple-task.html')
    );
    expect(controlPanelHtmlExists).toBe(true);
    expect(simpleTaskHtmlExists).toBe(false);
  });

  it('should have control-panel-main.tsx instead of simple-task-main.tsx', () => {
    const controlPanelMainExists = fs.existsSync(
      path.join(projectRoot, 'src/control-panel-main.tsx')
    );
    const simpleTaskMainExists = fs.existsSync(
      path.join(projectRoot, 'src/simple-task-main.tsx')
    );
    expect(controlPanelMainExists).toBe(true);
    expect(simpleTaskMainExists).toBe(false);
  });
});
```

### 2. Source Code Content Verification Tests

Create `src/components/control-panel/__tests__/content-verification.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

describe('Control Panel Content Verification', () => {
  const projectRoot = path.resolve(__dirname, '../../../../..');

  async function searchInFiles(pattern: RegExp, extensions: string[]): Promise<string[]> {
    const matches: string[] = [];
    const globPattern = `**/*.{${extensions.join(',')}}`;
    const files = await glob(globPattern, {
      cwd: projectRoot,
      ignore: ['node_modules/**', 'dist/**', 'target/**', 'plans/**', '**/*.test.ts', '**/*.test.tsx'],
    });

    for (const file of files) {
      const content = fs.readFileSync(path.join(projectRoot, file), 'utf-8');
      if (pattern.test(content)) {
        matches.push(file);
      }
    }
    return matches;
  }

  it('should have no "simple-task" references in TypeScript/TSX files', async () => {
    const matches = await searchInFiles(/simple-task/gi, ['ts', 'tsx']);
    expect(matches).toEqual([]);
  });

  it('should have no "SimpleTask" references in TypeScript/TSX files', async () => {
    const matches = await searchInFiles(/SimpleTask/g, ['ts', 'tsx']);
    expect(matches).toEqual([]);
  });

  it('should have no "simpleTask" references in TypeScript/TSX files', async () => {
    const matches = await searchInFiles(/simpleTask/g, ['ts', 'tsx']);
    expect(matches).toEqual([]);
  });

  it('should have no "SIMPLE_TASK" references in Rust files', async () => {
    const matches = await searchInFiles(/SIMPLE_TASK/g, ['rs']);
    expect(matches).toEqual([]);
  });

  it('should have no "simple_task" references in Rust files', async () => {
    const matches = await searchInFiles(/simple_task/g, ['rs']);
    expect(matches).toEqual([]);
  });

  it('should have no "simple-task" references in JSON config files', async () => {
    const matches = await searchInFiles(/simple-task/gi, ['json']);
    expect(matches).toEqual([]);
  });

  it('should have no "simple-task" references in HTML files', async () => {
    const matches = await searchInFiles(/simple-task/gi, ['html']);
    expect(matches).toEqual([]);
  });
});
```

### 3. Configuration Verification Tests

Create `src/components/control-panel/__tests__/config-verification.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Control Panel Configuration', () => {
  const projectRoot = path.resolve(__dirname, '../../../../..');

  it('should have control-panel entry in vite.config.ts', () => {
    const viteConfig = fs.readFileSync(
      path.join(projectRoot, 'vite.config.ts'),
      'utf-8'
    );
    expect(viteConfig).toContain("'control-panel'");
    expect(viteConfig).toContain('control-panel.html');
    expect(viteConfig).not.toContain("'simple-task'");
    expect(viteConfig).not.toContain('simple-task.html');
  });

  it('should have control-panel window in tauri.conf.json', () => {
    const tauriConfig = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, 'src-tauri/tauri.conf.json'),
        'utf-8'
      )
    );
    const windowLabels = tauriConfig.app?.windows?.map((w: any) => w.label) || [];
    expect(windowLabels).toContain('control-panel');
    expect(windowLabels).not.toContain('simple-task');
  });

  it('should reference control-panel in capabilities if applicable', () => {
    const capabilitiesPath = path.join(
      projectRoot,
      'src-tauri/capabilities/default.json'
    );
    if (fs.existsSync(capabilitiesPath)) {
      const content = fs.readFileSync(capabilitiesPath, 'utf-8');
      expect(content).not.toContain('simple-task');
    }
  });
});
```

### 4. Component Export Verification Tests

Create `src/components/control-panel/__tests__/exports-verification.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Control Panel Exports', () => {
  it('should export ControlPanelWindow component', async () => {
    const module = await import('../control-panel-window');
    expect(module.ControlPanelWindow).toBeDefined();
    expect(typeof module.ControlPanelWindow).toBe('function');
  });

  it('should export ControlPanelHeader component', async () => {
    const module = await import('../control-panel-header');
    expect(module.ControlPanelHeader).toBeDefined();
    expect(typeof module.ControlPanelHeader).toBe('function');
  });

  it('should export useControlPanelParams hook', async () => {
    const module = await import('../use-control-panel-params');
    expect(module.useControlPanelParams).toBeDefined();
    expect(typeof module.useControlPanelParams).toBe('function');
  });

  it('should not export any SimpleTask named exports', async () => {
    const module = await import('../index');
    const exportNames = Object.keys(module);
    const simpleTaskExports = exportNames.filter(
      (name) => name.toLowerCase().includes('simpletask')
    );
    expect(simpleTaskExports).toEqual([]);
  });
});
```

### 5. Hotkey Service Verification Tests

Create `src/lib/__tests__/hotkey-service-control-panel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Hotkey Service Control Panel Integration', () => {
  const projectRoot = path.resolve(__dirname, '../../..');

  it('should have openControlPanel function exported', async () => {
    const hotkeyServicePath = path.join(projectRoot, 'src/lib/hotkey-service.ts');
    const content = fs.readFileSync(hotkeyServicePath, 'utf-8');
    expect(content).toContain('openControlPanel');
    expect(content).not.toContain('openSimpleTask');
  });

  it('should have hideControlPanel function exported', async () => {
    const hotkeyServicePath = path.join(projectRoot, 'src/lib/hotkey-service.ts');
    const content = fs.readFileSync(hotkeyServicePath, 'utf-8');
    expect(content).toContain('hideControlPanel');
    expect(content).not.toContain('hideSimpleTask');
  });

  it('should reference control-panel panel label', async () => {
    const hotkeyServicePath = path.join(projectRoot, 'src/lib/hotkey-service.ts');
    const content = fs.readFileSync(hotkeyServicePath, 'utf-8');
    expect(content).toContain('"control-panel"');
    expect(content).not.toContain('"simple-task"');
  });
});
```

### 6. Event Bridge Verification Tests

Create `src/lib/__tests__/event-bridge-control-panel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Event Bridge Control Panel Integration', () => {
  const projectRoot = path.resolve(__dirname, '../../..');

  it('should have open-control-panel event instead of open-simple-task', () => {
    const eventBridgePath = path.join(projectRoot, 'src/lib/event-bridge.ts');
    const content = fs.readFileSync(eventBridgePath, 'utf-8');
    expect(content).toContain('open-control-panel');
    expect(content).not.toContain('open-simple-task');
  });
});
```

### 7. Event Types Verification Tests

Create `src/entities/__tests__/events-control-panel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Event Types Control Panel', () => {
  const projectRoot = path.resolve(__dirname, '../../..');

  it('should export OpenControlPanelPayload type', () => {
    const eventsPath = path.join(projectRoot, 'src/entities/events.ts');
    const content = fs.readFileSync(eventsPath, 'utf-8');
    expect(content).toContain('OpenControlPanelPayload');
    expect(content).not.toContain('OpenSimpleTaskPayload');
  });

  it('should export ControlPanelViewType type', () => {
    const eventsPath = path.join(projectRoot, 'src/entities/events.ts');
    const content = fs.readFileSync(eventsPath, 'utf-8');
    expect(content).toContain('ControlPanelViewType');
    expect(content).not.toContain('SimpleTaskViewType');
  });
});
```

### 8. CSS Class Verification Tests

Create `src/__tests__/css-control-panel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('CSS Control Panel Classes', () => {
  const projectRoot = path.resolve(__dirname, '../..');

  it('should have control-panel-container class instead of simple-task-container', () => {
    const cssPath = path.join(projectRoot, 'src/index.css');
    const content = fs.readFileSync(cssPath, 'utf-8');
    expect(content).toContain('.control-panel-container');
    expect(content).not.toContain('.simple-task-container');
  });

  it('should have no simple-task CSS classes', () => {
    const cssPath = path.join(projectRoot, 'src/index.css');
    const content = fs.readFileSync(cssPath, 'utf-8');
    expect(content).not.toMatch(/\.simple-task/);
  });
});
```

### 9. Build Verification Tests

Create `src/__tests__/build-verification.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

describe('Build Verification', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const timeout = 120000; // 2 minutes for build

  it('should successfully run pnpm build', () => {
    expect(() => {
      execSync('pnpm build', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout,
      });
    }).not.toThrow();
  }, timeout);

  it('should successfully run cargo check in src-tauri', () => {
    expect(() => {
      execSync('cargo check', {
        cwd: path.join(projectRoot, 'src-tauri'),
        stdio: 'pipe',
        timeout,
      });
    }).not.toThrow();
  }, timeout);
});
```

### 10. Plan View Component Tests

Create `src/components/control-panel/__tests__/plan-view.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';

describe('PlanView', () => {
  describe('content tab', () => {
    it('should render markdown content when loaded', () => {});
    it('should show loading state while content is being fetched', () => {});
    it('should handle empty content gracefully', () => {});
    it('should render content as read-only (no editing)', () => {});
  });

  describe('threads tab', () => {
    it('should render list of related threads', () => {});
    it('should show "No threads yet" when no relations exist', () => {});
    it('should allow clicking a thread to switch to thread view', () => {});
  });
});
```

### 11. Plan Input Area Tests

Create `src/components/control-panel/__tests__/plan-input-area.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';

describe('PlanInputArea', () => {
  it('should show placeholder "Start a new thread about this plan..."', () => {});
  it('should enable send button when message is not empty', () => {});
  it('should disable send button when message is empty', () => {});
  it('should create a new thread when send is clicked', () => {});
  it('should create a "mentioned" relation between new thread and plan', () => {});
  it('should prefix message with @plan:{planId} mention', () => {});
  it('should switch to thread view after sending', () => {});
  it('should show loading state while creating thread', () => {});
  it('should clear input after successful send', () => {});
  it('should submit on Enter key (without shift)', () => {});
  it('should allow newlines with Shift+Enter', () => {});
});
```

### 12. Control Panel View Type Tests

Create `src/components/control-panel/__tests__/view-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('ControlPanelViewType', () => {
  it('should support thread view with conversation/plan/changes tabs', () => {
    const threadView = { type: 'thread', threadId: 'test-id', tab: 'conversation' };
    // Type-level validation
  });

  it('should support plan view with content/threads tabs', () => {
    const planView = { type: 'plan', planId: 'test-id', tab: 'content' };
    // Type-level validation
  });

  it('should NOT support changes tab for plan view', () => {
    // Verify 'changes' is not a valid tab for plan views
  });
});
```

### 13. Control Panel Window Routing Tests

Create `src/components/control-panel/__tests__/window-routing.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';

describe('ControlPanelWindow routing', () => {
  it('should render ThreadView when view.type is "thread"', () => {});
  it('should render PlanView when view.type is "plan"', () => {});
  it('should render PlanInputArea when viewing a plan', () => {});
  it('should NOT render PlanInputArea when viewing a thread', () => {});
});
```

### Test Execution Requirements

The implementation agent must:

1. Create all test files listed above
2. Run `pnpm test` and ensure all tests pass
3. Run `pnpm build` to verify the frontend builds successfully
4. Run `cargo check` in `src-tauri/` to verify Rust code compiles
5. Do not consider the implementation complete until all tests pass

If any test fails, the agent must fix the underlying issue and re-run the tests until all pass.
