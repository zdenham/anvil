# 09 - UI Components

## Overview

Update the quick actions UI to use horizontal navigation, display hotkeys, and add a settings page for configuration.

## Files to Create

### `src/components/quick-actions/quick-action-chip.tsx`

Individual action chip component:

```typescript
import { cn } from '@/lib/utils.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';

interface QuickActionChipProps {
  action: QuickActionMetadata;
  isSelected: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function QuickActionChip({ action, isSelected, disabled, onClick }: QuickActionChipProps) {
  const handleClick = () => {
    if (disabled) return;
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={cn(
        'px-3 py-1.5 rounded-md text-sm whitespace-nowrap',
        'border border-surface-600 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-accent-500',
        disabled && 'opacity-50 cursor-not-allowed',
        isSelected
          ? 'bg-surface-700 text-surface-100 border-accent-500'
          : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
      )}
    >
      <span>{action.title}</span>
      {action.hotkey !== undefined && (
        <kbd className="ml-2 text-xs text-surface-500">⌘{action.hotkey}</kbd>
      )}
    </button>
  );
}
```

### `src/components/quick-actions/quick-actions-panel.tsx`

Main panel with horizontal navigation:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { QuickActionChip } from './quick-action-chip.js';
import { Spinner } from '@/components/ui/spinner.js';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { useQuickActionExecutor } from '@/hooks/useQuickActionExecutor.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';

interface QuickActionsPanelProps {
  contextType: 'thread' | 'plan' | 'empty';
}

export function QuickActionsPanel({ contextType }: QuickActionsPanelProps) {
  const actions = useQuickActionsStore((s) => s.getForContext(contextType));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { isExecuting, executingAction, execute } = useQuickActionExecutor();

  // Reset selection when actions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [actions.length]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isExecuting) return; // Disable navigation during execution

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(actions.length - 1, i + 1));
    } else if (e.key === 'Enter' && actions[selectedIndex]) {
      e.preventDefault();
      execute(actions[selectedIndex]);
    }
  }, [isExecuting, actions, selectedIndex, execute]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-surface-700">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm text-surface-400">Quick Actions</span>
        <Link
          to="/settings/quick-actions"
          className="text-xs text-accent-500 hover:text-accent-400 hover:underline"
        >
          Configure
        </Link>
      </div>

      <div className="h-4 w-px bg-surface-600" />

      {isExecuting && (
        <div className="flex items-center gap-2 text-sm text-surface-300 shrink-0">
          <Spinner size="sm" />
          <span>{executingAction?.title}...</span>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto">
        {actions.map((action, index) => (
          <QuickActionChip
            key={action.id}
            action={action}
            isSelected={!isExecuting && selectedIndex === index}
            disabled={isExecuting}
            onClick={() => execute(action)}
          />
        ))}
      </div>
    </div>
  );
}
```

### `src/components/settings/quick-actions-settings.tsx`

Settings page for managing actions:

```typescript
import { useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { quickActionService } from '@/entities/quick-actions/service.js';
import { QuickActionListItem } from './quick-action-list-item.js';
import { QuickActionEditModal } from './quick-action-edit-modal.js';
import { Button } from '@/components/ui/button.js';
import { toast } from '@/components/ui/toast.js';

export function QuickActionsSettings() {
  const actions = useQuickActionsStore((s) => s.getAll());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);

  const handleReorder = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = actions.findIndex((a) => a.id === active.id);
    const newIndex = actions.findIndex((a) => a.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder the array
    const reordered = [...actions];
    const [removed] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, removed);

    await quickActionService.reorder(reordered.map((a) => a.id));
  };

  const handleToggle = async (id: string) => {
    const action = actions.find((a) => a.id === id);
    if (!action) return;

    await quickActionService.update(id, { enabled: !action.enabled });
  };

  const handleSave = async (id: string, updates: { hotkey?: number | null }) => {
    await quickActionService.update(id, updates);
    setEditingId(null);
    toast.success('Action updated');
  };

  const handleRebuild = async () => {
    setIsRebuilding(true);
    try {
      // This would invoke a Tauri command to run npm build
      // For now, just refresh the manifest
      await quickActionService.reloadManifest();
      toast.success('Actions reloaded');
    } catch (e) {
      toast.error(`Failed to reload: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsRebuilding(false);
    }
  };

  const editingAction = editingId ? actions.find((a) => a.id === editingId) : null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-surface-100">Quick Actions</h2>
          <p className="text-sm text-surface-400 mt-1">
            Manage your quick actions and assign hotkeys (⌘0-9)
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={handleRebuild}
          disabled={isRebuilding}
        >
          {isRebuilding ? 'Reloading...' : 'Reload Actions'}
        </Button>
      </div>

      <div className="text-sm text-surface-400 bg-surface-800 rounded-md p-3">
        <p>
          Actions are defined in <code className="text-accent-400">~/.mort/quick-actions/src/actions/</code>
        </p>
        <p className="mt-1">
          After editing, run <code className="text-accent-400">npm run build</code> then click "Reload Actions"
        </p>
      </div>

      {actions.length === 0 ? (
        <div className="text-center py-8 text-surface-400">
          <p>No actions found.</p>
          <p className="text-sm mt-1">
            Add actions to <code>~/.mort/quick-actions/src/actions/</code>
          </p>
        </div>
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleReorder}>
          <SortableContext items={actions.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {actions.map((action) => (
                <QuickActionListItem
                  key={action.id}
                  action={action}
                  onEdit={() => setEditingId(action.id)}
                  onToggle={() => handleToggle(action.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {editingAction && (
        <QuickActionEditModal
          action={editingAction}
          existingHotkeys={actions.filter((a) => a.id !== editingId && a.hotkey !== undefined).map((a) => a.hotkey!)}
          onSave={(updates) => handleSave(editingId!, updates)}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
```

### `src/components/settings/quick-action-list-item.tsx`

Sortable list item:

```typescript
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Settings, ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';

interface QuickActionListItemProps {
  action: QuickActionMetadata;
  onEdit: () => void;
  onToggle: () => void;
}

export function QuickActionListItem({ action, onEdit, onToggle }: QuickActionListItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: action.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-3 rounded-md bg-surface-800 border border-surface-700',
        isDragging && 'opacity-50',
        !action.enabled && 'opacity-50'
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-surface-500 hover:text-surface-300"
      >
        <GripVertical size={16} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('font-medium', action.enabled ? 'text-surface-100' : 'text-surface-400')}>
            {action.title}
          </span>
          {action.hotkey !== undefined && (
            <kbd className="px-1.5 py-0.5 text-xs bg-surface-700 rounded text-surface-300">
              ⌘{action.hotkey}
            </kbd>
          )}
        </div>
        {action.description && (
          <p className="text-sm text-surface-400 truncate">{action.description}</p>
        )}
        <div className="flex gap-1 mt-1">
          {action.contexts.map((ctx) => (
            <span
              key={ctx}
              className="px-1.5 py-0.5 text-xs bg-surface-700 rounded text-surface-400"
            >
              {ctx}
            </span>
          ))}
        </div>
      </div>

      <button
        onClick={onToggle}
        className="text-surface-400 hover:text-surface-200"
        title={action.enabled ? 'Disable' : 'Enable'}
      >
        {action.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
      </button>

      <button
        onClick={onEdit}
        className="text-surface-400 hover:text-surface-200"
        title="Edit"
      >
        <Settings size={16} />
      </button>
    </div>
  );
}
```

### `src/components/settings/quick-action-edit-modal.tsx`

Modal for editing hotkeys:

```typescript
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog.js';
import { Button } from '@/components/ui/button.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';

interface QuickActionEditModalProps {
  action: QuickActionMetadata;
  existingHotkeys: number[];
  onSave: (updates: { hotkey?: number | null }) => void;
  onClose: () => void;
}

export function QuickActionEditModal({
  action,
  existingHotkeys,
  onSave,
  onClose,
}: QuickActionEditModalProps) {
  const [hotkey, setHotkey] = useState<number | null>(action.hotkey ?? null);
  const [error, setError] = useState<string | null>(null);

  const handleHotkeyChange = (value: string) => {
    if (value === '') {
      setHotkey(null);
      setError(null);
      return;
    }

    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > 9) {
      setError('Hotkey must be 0-9');
      return;
    }

    if (existingHotkeys.includes(num)) {
      setError(`⌘${num} is already assigned to another action`);
      return;
    }

    setHotkey(num);
    setError(null);
  };

  const handleSave = () => {
    if (error) return;
    onSave({ hotkey });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Edit {action.title}</Dialog.Title>
        </Dialog.Header>

        <div className="space-y-4 py-4">
          <div>
            <label className="block text-sm font-medium text-surface-200 mb-1">
              Hotkey (⌘0-9)
            </label>
            <input
              type="text"
              value={hotkey ?? ''}
              onChange={(e) => handleHotkeyChange(e.target.value)}
              placeholder="None"
              className="w-20 px-3 py-2 bg-surface-800 border border-surface-600 rounded-md text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
              maxLength={1}
            />
            {error && (
              <p className="mt-1 text-sm text-red-400">{error}</p>
            )}
          </div>

          <div className="text-sm text-surface-400">
            <p>
              <strong>Contexts:</strong> {action.contexts.join(', ')}
            </p>
            {action.description && (
              <p className="mt-1">{action.description}</p>
            )}
          </div>
        </div>

        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!!error}>
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
```

## Files to Modify

### `src/components/control-panel/index.tsx` (or similar)

Integrate the quick actions panel:

```typescript
import { QuickActionsPanel } from '@/components/quick-actions/quick-actions-panel.js';

// In the component where quick actions should appear:
<QuickActionsPanel contextType={currentContextType} />
```

### Router configuration

Add the settings route:

```typescript
import { QuickActionsSettings } from '@/components/settings/quick-actions-settings.js';

// In routes:
{
  path: '/settings/quick-actions',
  element: <QuickActionsSettings />,
}
```

## Design Decisions Referenced

- **#8 Hotkeys**: App-local only, Cmd+0-9 pool
- **#16 Context Scope**: Actions shown based on context type
- **#17 Execution Feedback**: Spinner with action name
- **#18 No Concurrent Actions**: UI disabled during execution
- **#19 Action Discovery**: Configure CTA link in panel
- **#20 Hotkey Conflict Resolution**: Error shown, user must explicitly override
- **#35 Settings Page Structure**: Section with modal for editing

## Acceptance Criteria

- [ ] Panel shows context-relevant actions
- [ ] Horizontal navigation with arrow keys
- [ ] Enter key executes selected action
- [ ] Hotkeys displayed on chips
- [ ] Configure link navigates to settings
- [ ] Spinner shown during execution
- [ ] Settings page lists all actions
- [ ] Drag-to-reorder works
- [ ] Enable/disable toggle works
- [ ] Hotkey editing with conflict detection
- [ ] Reload button refreshes manifest

## Compliance Notes

This plan references the following design decisions:
- **#8, #31**: Hotkeys use Cmd+0-9 pool, app-local only
- **#16**: Actions filtered by context type
- **#17**: Spinner feedback during execution
- **#18**: No concurrent actions (hotkeys disabled during execution)
- **#19**: Configure CTA link to settings
- **#20**: Hotkey conflict detection with explicit override
- **#35**: Settings section with modal editing

**Implementation considerations:**
1. Ensure `getForContext()` and `getAll()` in the store return actions sorted lexicographically by title as the default order per #27
2. The "Reload Actions" button text aligns with #9 (manual refresh) though the decision document calls it "Rebuild"

## Verification & Testing

### TypeScript Compilation Checks

```bash
# Verify all new component files compile without errors
npx tsc --noEmit

# If project uses strict mode, verify no type errors
npx tsc --noEmit --strict
```

### Import Verification

Create a temporary test file to verify exports and interfaces:

```typescript
// test-imports.ts (temporary verification file)
import { QuickActionChip } from '@/components/quick-actions/quick-action-chip.js';
import { QuickActionsPanel } from '@/components/quick-actions/quick-actions-panel.js';
import { QuickActionsSettings } from '@/components/settings/quick-actions-settings.js';
import { QuickActionListItem } from '@/components/settings/quick-action-list-item.js';
import { QuickActionEditModal } from '@/components/settings/quick-action-edit-modal.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';

// Verify QuickActionChip props interface
const chipProps: Parameters<typeof QuickActionChip>[0] = {
  action: {} as QuickActionMetadata,
  isSelected: true,
  disabled: false,
  onClick: () => {},
};

// Verify QuickActionsPanel accepts contextType
const panelProps: Parameters<typeof QuickActionsPanel>[0] = {
  contextType: 'thread',
};

// Verify QuickActionEditModal props
const modalProps: Parameters<typeof QuickActionEditModal>[0] = {
  action: {} as QuickActionMetadata,
  existingHotkeys: [1, 2, 3],
  onSave: (updates) => {},
  onClose: () => {},
};
```

Run: `npx tsc --noEmit test-imports.ts` then delete the file.

### Component Render Tests

```bash
# Run existing test suite to ensure no regressions
npm test

# If using Vitest or Jest, add specific component tests
npm test -- --grep "QuickAction"
```

### Manual Verification Checklist

1. **Panel Display**
   - Navigate to a thread view, verify QuickActionsPanel appears
   - Navigate to a plan view, verify panel shows different context-appropriate actions
   - Navigate to empty state, verify panel shows empty-context actions (or hides if none)
   - Open settings or modal, verify panel does NOT appear (#16)

2. **Keyboard Navigation**
   - Press Left/Right arrow keys, verify selection moves between chips
   - Press Enter, verify selected action executes
   - Verify arrow keys wrap or stop at boundaries appropriately

3. **Hotkey Display**
   - Verify chips show hotkey badge (e.g., "⌘1") when assigned
   - Verify chips without hotkeys show no badge

4. **Execution Feedback**
   - Trigger an action, verify spinner appears with action name
   - Verify chips are replaced by spinner state during execution
   - Verify clicking chips during execution does nothing (#18)
   - Press hotkeys during execution, verify they are ignored (#18)

5. **Configure Link**
   - Click "Configure" link, verify navigation to `/settings/quick-actions`

6. **Settings Page**
   - Verify all actions are listed
   - Verify drag handles allow reordering
   - Verify order persists after reorder
   - Verify enable/disable toggle works and persists
   - Verify disabled actions appear dimmed

7. **Hotkey Editing Modal**
   - Click settings icon on an action, verify modal opens
   - Enter valid hotkey (0-9), verify it saves
   - Enter already-used hotkey, verify error message appears (#20)
   - Clear hotkey, verify it saves as "None"

8. **Reload Actions**
   - Click "Reload Actions" button
   - Verify manifest is refreshed from disk
   - Verify any changes to `~/.mort/quick-actions/dist/manifest.json` are reflected

### Automated Test Suggestions

```typescript
// quick-actions-panel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickActionsPanel } from './quick-actions-panel';

describe('QuickActionsPanel', () => {
  it('renders nothing when no actions available', () => {
    // Mock store to return empty array
    const { container } = render(<QuickActionsPanel contextType="thread" />);
    expect(container.firstChild).toBeNull();
  });

  it('displays action chips for available actions', () => {
    // Mock store with test actions
    render(<QuickActionsPanel contextType="thread" />);
    expect(screen.getByText('Test Action')).toBeInTheDocument();
  });

  it('shows hotkey on chip when assigned', () => {
    // Mock action with hotkey: 1
    render(<QuickActionsPanel contextType="thread" />);
    expect(screen.getByText('⌘1')).toBeInTheDocument();
  });

  it('disables navigation during execution', () => {
    // Mock isExecuting: true
    // Verify arrow key presses don't change selection
  });

  it('disables click-based triggering during execution', () => {
    // Mock isExecuting: true
    const execute = jest.fn();
    render(<QuickActionsPanel contextType="thread" />);
    const chip = screen.getByRole('button', { name: /Test Action/ });
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(execute).not.toHaveBeenCalled();
  });

  it('shows spinner during action execution', () => {
    // Mock isExecuting: true, executingAction: { title: 'Test' }
    render(<QuickActionsPanel contextType="thread" />);
    expect(screen.getByText('Test...')).toBeInTheDocument();
  });
});
```

```typescript
// quick-action-edit-modal.test.tsx
describe('QuickActionEditModal', () => {
  it('shows error when hotkey already assigned', () => {
    render(
      <QuickActionEditModal
        action={mockAction}
        existingHotkeys={[1, 2, 3]}
        onSave={jest.fn()}
        onClose={jest.fn()}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '1' } });

    expect(screen.getByText(/already assigned/)).toBeInTheDocument();
  });

  it('allows saving unused hotkey', () => {
    const onSave = jest.fn();
    render(
      <QuickActionEditModal
        action={mockAction}
        existingHotkeys={[1, 2, 3]}
        onSave={onSave}
        onClose={jest.fn()}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith({ hotkey: 5 });
  });
});
```

### Build Verification

```bash
# Ensure the full application builds successfully
npm run build

# Verify no console errors in development mode
npm run dev
# Open browser console, check for React errors or warnings
```

### Dependency Verification

```bash
# Verify @dnd-kit packages are installed for drag-and-drop
npm ls @dnd-kit/core @dnd-kit/sortable

# If not installed:
npm install @dnd-kit/core @dnd-kit/sortable
```
