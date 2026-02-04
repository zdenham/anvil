# 05 - Quick Actions Entity, Store & Service

## Overview

Create the frontend entity for quick actions including the Zustand store, service layer, and event listeners. This follows the existing entity pattern in the codebase.

## Files to Create

### `src/entities/quick-actions/types.ts`

Re-export types from core:

```typescript
export type {
  QuickActionContext,
  QuickActionMetadata,
  QuickActionManifest,
  QuickActionManifestEntry,
  QuickActionsRegistry,
  QuickActionOverride,
  UpdateQuickActionInput,
  ResolvedQuickAction,
} from '@core/types/quick-actions.js';
```

### `src/entities/quick-actions/store.ts`

Zustand store using Record for O(1) lookups:

```typescript
import { create } from 'zustand';
import type { QuickActionMetadata } from './types.js';

interface QuickActionsState {
  actions: Record<string, QuickActionMetadata>;  // Keyed by ID for O(1) lookups
  _hydrated: boolean;

  // Selectors
  getAction: (id: string) => QuickActionMetadata | undefined;
  getByHotkey: (hotkey: number) => QuickActionMetadata | undefined;
  getForContext: (context: 'thread' | 'plan' | 'empty') => QuickActionMetadata[];
  getAll: () => QuickActionMetadata[];

  // Mutations (called by service)
  hydrate: (actions: Record<string, QuickActionMetadata>) => void;
  _applyUpdate: (id: string, action: QuickActionMetadata) => void;
  _applyReorder: (orderedIds: string[]) => void;
  _setHydrated: (hydrated: boolean) => void;
}

export const useQuickActionsStore = create<QuickActionsState>((set, get) => ({
  actions: {},
  _hydrated: false,

  getAction: (id) => get().actions[id],

  getByHotkey: (hotkey) => {
    return Object.values(get().actions).find(a => a.hotkey === hotkey && a.enabled);
  },

  getForContext: (context) => {
    return Object.values(get().actions)
      .filter(a => a.enabled && (a.contexts.includes(context) || a.contexts.includes('all')))
      .sort((a, b) => a.order - b.order);
  },

  getAll: () => {
    return Object.values(get().actions).sort((a, b) => a.order - b.order);
  },

  hydrate: (actions) => set({ actions, _hydrated: true }),

  _applyUpdate: (id, action) => set((s) => ({
    actions: { ...s.actions, [id]: action }
  })),

  _applyReorder: (orderedIds) => set((s) => {
    const updated = { ...s.actions };
    orderedIds.forEach((id, index) => {
      if (updated[id]) {
        updated[id] = { ...updated[id], order: index };
      }
    });
    return { actions: updated };
  }),

  _setHydrated: (hydrated) => set({ _hydrated: hydrated }),
}));
```

### `src/entities/quick-actions/service.ts`

Service layer for quick action operations:

```typescript
import { v4 as uuidv4 } from 'uuid';
import { useQuickActionsStore } from './store.js';
import type {
  QuickActionMetadata,
  QuickActionManifest,
  QuickActionsRegistry,
  UpdateQuickActionInput,
  ResolvedQuickAction,
} from './types.js';
import { QuickActionManifestSchema, QuickActionsRegistrySchema } from '@core/types/quick-actions.js';
import { getMortDir } from '@/lib/paths.js';
import * as fs from '@tauri-apps/plugin-fs';
import * as path from 'path';

const REGISTRY_FILENAME = 'quick-actions-registry.json';
const QUICK_ACTIONS_DIR = 'quick-actions';

async function readRegistry(): Promise<QuickActionsRegistry> {
  const mortDir = await getMortDir();
  const registryPath = path.join(mortDir, REGISTRY_FILENAME);

  try {
    const content = await fs.readTextFile(registryPath);
    const parsed = JSON.parse(content);
    return QuickActionsRegistrySchema.parse(parsed);
  } catch {
    return { actionOverrides: {}, slugToId: {} };
  }
}

async function writeRegistry(registry: QuickActionsRegistry): Promise<void> {
  const mortDir = await getMortDir();
  const registryPath = path.join(mortDir, REGISTRY_FILENAME);
  await fs.writeTextFile(registryPath, JSON.stringify(registry, null, 2));
}

async function readManifest(): Promise<QuickActionManifest | null> {
  const mortDir = await getMortDir();
  const manifestPath = path.join(mortDir, QUICK_ACTIONS_DIR, 'dist', 'manifest.json');

  try {
    const content = await fs.readTextFile(manifestPath);
    const parsed = JSON.parse(content);
    return QuickActionManifestSchema.parse(parsed);
  } catch {
    return null;
  }
}

export const quickActionService = {
  /**
   * Hydrate the store from disk (manifest + registry)
   */
  async hydrate(): Promise<void> {
    const mortDir = await getMortDir();
    const projectPath = path.join(mortDir, QUICK_ACTIONS_DIR);

    const manifest = await readManifest();
    if (!manifest) {
      useQuickActionsStore.getState().hydrate({});
      return;
    }

    const registry = await readRegistry();
    const actions: Record<string, QuickActionMetadata> = {};
    const now = Date.now();

    // Sort manifest entries lexicographically by title for default ordering (DD #27)
    const sortedEntries = [...manifest.actions].sort((a, b) =>
      a.title.localeCompare(b.title)
    );

    for (const entry of manifest.actions) {
      // Get or create stable UUID for this slug
      let id = registry.slugToId[entry.slug];
      if (!id) {
        id = uuidv4();
        registry.slugToId[entry.slug] = id;
      }

      const override = registry.actionOverrides[id] ?? {};

      // Default order is lexicographic position by title (DD #27)
      const defaultOrder = sortedEntries.findIndex(e => e.slug === entry.slug);

      actions[id] = {
        id,
        slug: entry.slug,
        title: entry.title,
        description: entry.description,
        entryPoint: entry.entryPoint,
        projectPath,
        contexts: entry.contexts,
        hotkey: override.hotkey,
        order: override.customOrder ?? defaultOrder,
        enabled: override.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
    }

    // Save updated registry if we created new IDs
    await writeRegistry(registry);

    useQuickActionsStore.getState().hydrate(actions);
  },

  /**
   * Get a single action by ID
   */
  get(id: string): QuickActionMetadata | undefined {
    return useQuickActionsStore.getState().getAction(id);
  },

  /**
   * Get all actions sorted by order
   */
  getAll(): QuickActionMetadata[] {
    return useQuickActionsStore.getState().getAll();
  },

  /**
   * Get actions for a specific context
   */
  getForContext(context: 'thread' | 'plan' | 'empty'): QuickActionMetadata[] {
    return useQuickActionsStore.getState().getForContext(context);
  },

  /**
   * Get action by hotkey
   */
  getByHotkey(hotkey: number): QuickActionMetadata | undefined {
    return useQuickActionsStore.getState().getByHotkey(hotkey);
  },

  /**
   * Update an action's settings (hotkey, order, enabled)
   */
  async update(id: string, input: UpdateQuickActionInput): Promise<QuickActionMetadata> {
    const action = this.get(id);
    if (!action) throw new Error(`Action not found: ${id}`);

    const registry = await readRegistry();

    // Update override
    const override = registry.actionOverrides[id] ?? {};
    if (input.hotkey !== undefined) {
      override.hotkey = input.hotkey ?? undefined;
    }
    if (input.order !== undefined) {
      override.customOrder = input.order;
    }
    if (input.enabled !== undefined) {
      override.enabled = input.enabled;
    }
    registry.actionOverrides[id] = override;

    await writeRegistry(registry);

    // Update store
    const updated: QuickActionMetadata = {
      ...action,
      hotkey: override.hotkey,
      order: override.customOrder ?? action.order,
      enabled: override.enabled ?? true,
      updatedAt: Date.now(),
    };

    useQuickActionsStore.getState()._applyUpdate(id, updated);
    return updated;
  },

  /**
   * Reorder actions
   */
  async reorder(orderedIds: string[]): Promise<void> {
    const registry = await readRegistry();

    orderedIds.forEach((id, index) => {
      const override = registry.actionOverrides[id] ?? {};
      override.customOrder = index;
      registry.actionOverrides[id] = override;
    });

    await writeRegistry(registry);
    useQuickActionsStore.getState()._applyReorder(orderedIds);
  },

  /**
   * Resolve an action for execution
   */
  resolve(id: string): ResolvedQuickAction | null {
    const action = this.get(id);
    if (!action) return null;

    return {
      id: action.id,
      slug: action.slug,
      title: action.title,
      description: action.description,
      entryPoint: action.entryPoint,
      projectPath: action.projectPath,
      contexts: action.contexts,
    };
  },

  /**
   * Reload manifest (called after rebuild)
   */
  async reloadManifest(): Promise<void> {
    await this.hydrate();
  },
};
```

### `src/entities/quick-actions/listeners.ts`

Event listeners for registry/manifest changes and SDK write operations:

```typescript
import { eventBus } from '@/entities/events/index.js';
import { quickActionService } from './service.js';
import { threadService } from '@/entities/threads/index.js';
import { planService } from '@/entities/plans/index.js';

export function setupQuickActionListeners(): void {
  // When registry changes on disk (e.g., from another window), refresh
  eventBus.on('quick-actions:registry-changed', async () => {
    await quickActionService.hydrate();
  });

  // When manifest is rebuilt, refresh
  eventBus.on('quick-actions:manifest-changed', async () => {
    await quickActionService.hydrate();
  });

  // SDK write operation event handlers (DD #24, #33)
  // The SDK emits events through stdout, Mort handles the actual disk write
  // These handlers perform the mutation and update Zustand stores

  eventBus.on('sdk:thread:archive', async (payload: { threadId: string }) => {
    await threadService.archive(payload.threadId);
  });

  eventBus.on('sdk:thread:unarchive', async (payload: { threadId: string }) => {
    await threadService.unarchive(payload.threadId);
  });

  eventBus.on('sdk:thread:markRead', async (payload: { threadId: string }) => {
    await threadService.markRead(payload.threadId);
  });

  eventBus.on('sdk:thread:markUnread', async (payload: { threadId: string }) => {
    await threadService.markUnread(payload.threadId);
  });

  eventBus.on('sdk:thread:delete', async (payload: { threadId: string }) => {
    await threadService.delete(payload.threadId);
  });

  eventBus.on('sdk:plan:archive', async (payload: { planId: string }) => {
    await planService.archive(payload.planId);
  });

  eventBus.on('sdk:plan:unarchive', async (payload: { planId: string }) => {
    await planService.unarchive(payload.planId);
  });

  eventBus.on('sdk:plan:markRead', async (payload: { planId: string }) => {
    await planService.markRead(payload.planId);
  });

  eventBus.on('sdk:plan:markUnread', async (payload: { planId: string }) => {
    await planService.markUnread(payload.planId);
  });

  eventBus.on('sdk:plan:delete', async (payload: { planId: string }) => {
    await planService.delete(payload.planId);
  });

  // Navigation events (these update UI state, not disk)
  eventBus.on('sdk:navigate', async (payload: { route: string }) => {
    // Router navigation handled by UI layer
  });

  eventBus.on('sdk:navigateToNextUnread', async () => {
    // Find and navigate to next unread item, or empty state if none (DD #29)
  });
}
```

### `src/entities/quick-actions/index.ts`

Barrel export:

```typescript
export { useQuickActionsStore } from './store.js';
export { quickActionService } from './service.js';
export { setupQuickActionListeners } from './listeners.js';
export type * from './types.js';
```

## Files to Modify

### `src/entities/index.ts`

Add quick action hydration:

```typescript
import { quickActionService, setupQuickActionListeners } from './quick-actions/index.js';

export async function hydrateEntities(): Promise<void> {
  // ... existing hydration ...

  await quickActionService.hydrate();
  setupQuickActionListeners();
}
```

## Design Decisions Referenced

- **#14 Action IDs**: Actions use UUID internally, manifest slug is human-readable
- **#27 Action Ordering**: Lexicographic by title, customizable via registry
- **#23 No Manifest Watching**: Manual refresh via service method
- **#24 State Sync via Events**: SDK emits events through stdout, Mort handles disk writes
- **#33 SDK Write Operations**: SDK emits events only, does NOT write directly to disk
- **#29 navigateToNextUnread() Empty Case**: Navigates to empty state if no unread items

## Acceptance Criteria

- [ ] Store provides O(1) lookups by ID
- [ ] Service hydrates from manifest + registry
- [ ] Service creates stable UUIDs for slugs
- [ ] Default action order is lexicographic by title (DD #27)
- [ ] Update persists to registry file
- [ ] Reorder persists to registry file
- [ ] Event listeners refresh on changes
- [ ] SDK write operation events trigger corresponding service mutations (DD #24, #33)
- [ ] Exported from entities barrel

## Compliance Notes

### Design Decision Compliance

**#27 Action Ordering**: The implementation sorts manifest entries lexicographically by title using `localeCompare()` to determine default order. Custom order from registry overrides take precedence when present.

**#24/#33 SDK Write Operations**: The listeners handle SDK write operation events emitted through stdout. When the SDK performs write operations, it emits events (e.g., `sdk:thread:archive`), and the listeners call the appropriate service methods to perform the actual disk write and update Zustand stores. This ensures a single source of truth and avoids race conditions.

### Additional Considerations

- **#16 Context Scope**: The `getForContext` selector checks for 'all' context correctly, but ensure the type system includes 'all' as a valid context option
- **Event Typing**: The SDK event payloads should be typed and validated. Consider creating a shared event type definition that both the SDK runner and listeners use.

## Verification & Testing

### TypeScript Compilation Checks

1. **Verify types compile without errors**:
   ```bash
   cd /Users/zac/Documents/juice/mort/mortician && npx tsc --noEmit
   ```

2. **Verify type re-exports are valid**:
   ```bash
   # Create a test file to verify imports work
   cat > /tmp/test-quick-action-types.ts << 'EOF'
   import type {
     QuickActionContext,
     QuickActionMetadata,
     QuickActionManifest,
     QuickActionManifestEntry,
     QuickActionsRegistry,
     QuickActionOverride,
     UpdateQuickActionInput,
     ResolvedQuickAction,
   } from './src/entities/quick-actions/types.js';

   // Verify QuickActionMetadata has required fields
   const metadata: QuickActionMetadata = {
     id: 'test-uuid',
     slug: 'test-slug',
     title: 'Test Action',
     description: 'A test action',
     entryPoint: 'dist/test.js',
     projectPath: '/path/to/project',
     contexts: ['thread', 'plan'],
     hotkey: 1,
     order: 0,
     enabled: true,
     createdAt: Date.now(),
     updatedAt: Date.now(),
   };

   // Verify UpdateQuickActionInput fields
   const update: UpdateQuickActionInput = {
     hotkey: 2,
     order: 1,
     enabled: false,
   };

   // Verify ResolvedQuickAction structure
   const resolved: ResolvedQuickAction = {
     id: 'test-uuid',
     slug: 'test-slug',
     title: 'Test Action',
     description: 'A test action',
     entryPoint: 'dist/test.js',
     projectPath: '/path/to/project',
     contexts: ['thread'],
   };
   EOF
   npx tsc --noEmit /tmp/test-quick-action-types.ts --skipLibCheck --moduleResolution node
   ```

### Store Functionality Tests

3. **Verify Zustand store exports and methods**:
   ```bash
   # In the app's test environment or a Node REPL with ts-node
   cat > /tmp/test-store.ts << 'EOF'
   import { useQuickActionsStore } from './src/entities/quick-actions/store.js';

   // Test store creation
   const store = useQuickActionsStore.getState();

   // Verify all required methods exist
   console.assert(typeof store.getAction === 'function', 'getAction should exist');
   console.assert(typeof store.getByHotkey === 'function', 'getByHotkey should exist');
   console.assert(typeof store.getForContext === 'function', 'getForContext should exist');
   console.assert(typeof store.getAll === 'function', 'getAll should exist');
   console.assert(typeof store.hydrate === 'function', 'hydrate should exist');
   console.assert(typeof store._applyUpdate === 'function', '_applyUpdate should exist');
   console.assert(typeof store._applyReorder === 'function', '_applyReorder should exist');
   console.assert(typeof store._setHydrated === 'function', '_setHydrated should exist');

   // Test initial state
   console.assert(store._hydrated === false, 'Initial _hydrated should be false');
   console.assert(Object.keys(store.actions).length === 0, 'Initial actions should be empty');

   console.log('Store tests passed');
   EOF
   ```

4. **Verify O(1) lookup behavior**:
   ```typescript
   // Test that getAction uses direct object access, not array iteration
   const testActions = {
     'uuid-1': { id: 'uuid-1', slug: 'action-1', /* ... */ },
     'uuid-2': { id: 'uuid-2', slug: 'action-2', /* ... */ },
   };
   useQuickActionsStore.getState().hydrate(testActions);

   // This should be O(1), not O(n)
   const result = useQuickActionsStore.getState().getAction('uuid-1');
   console.assert(result?.id === 'uuid-1', 'Should retrieve action by ID');
   ```

### Service Layer Tests

5. **Verify service exports and methods**:
   ```bash
   cat > /tmp/test-service.ts << 'EOF'
   import { quickActionService } from './src/entities/quick-actions/service.js';

   // Verify all required methods exist
   console.assert(typeof quickActionService.hydrate === 'function', 'hydrate should exist');
   console.assert(typeof quickActionService.get === 'function', 'get should exist');
   console.assert(typeof quickActionService.getAll === 'function', 'getAll should exist');
   console.assert(typeof quickActionService.getForContext === 'function', 'getForContext should exist');
   console.assert(typeof quickActionService.getByHotkey === 'function', 'getByHotkey should exist');
   console.assert(typeof quickActionService.update === 'function', 'update should exist');
   console.assert(typeof quickActionService.reorder === 'function', 'reorder should exist');
   console.assert(typeof quickActionService.resolve === 'function', 'resolve should exist');
   console.assert(typeof quickActionService.reloadManifest === 'function', 'reloadManifest should exist');

   console.log('Service tests passed');
   EOF
   ```

### Integration Tests

6. **Verify barrel export completeness**:
   ```bash
   cat > /tmp/test-barrel.ts << 'EOF'
   import {
     useQuickActionsStore,
     quickActionService,
     setupQuickActionListeners,
   } from './src/entities/quick-actions/index.js';

   // Verify exports are defined
   console.assert(useQuickActionsStore !== undefined, 'useQuickActionsStore should be exported');
   console.assert(quickActionService !== undefined, 'quickActionService should be exported');
   console.assert(setupQuickActionListeners !== undefined, 'setupQuickActionListeners should be exported');

   console.log('Barrel export tests passed');
   EOF
   ```

7. **Verify entities index integration**:
   ```bash
   # Check that hydrateEntities includes quick action hydration
   grep -q "quickActionService.hydrate" src/entities/index.ts && echo "Hydration call present" || echo "MISSING: quickActionService.hydrate call"
   grep -q "setupQuickActionListeners" src/entities/index.ts && echo "Listener setup present" || echo "MISSING: setupQuickActionListeners call"
   ```

### File System Tests (Manual Verification)

8. **Verify registry persistence**:
   ```bash
   # After running the app and making changes:
   cat ~/.mort/quick-actions-registry.json
   # Expected: Valid JSON with actionOverrides and slugToId objects
   ```

9. **Verify manifest reading**:
   ```bash
   # Ensure manifest exists and is valid:
   cat ~/.mort/quick-actions/dist/manifest.json
   # Expected: Valid JSON matching QuickActionManifestSchema
   ```

### Context Filtering Tests

10. **Verify context filtering logic**:
    ```typescript
    // Test getForContext with 'all' context actions
    const actionsWithAll = {
      'uuid-1': { id: 'uuid-1', contexts: ['all'], enabled: true, order: 0, /* ... */ },
      'uuid-2': { id: 'uuid-2', contexts: ['thread'], enabled: true, order: 1, /* ... */ },
      'uuid-3': { id: 'uuid-3', contexts: ['plan'], enabled: false, order: 2, /* ... */ },
    };
    useQuickActionsStore.getState().hydrate(actionsWithAll);

    const threadActions = useQuickActionsStore.getState().getForContext('thread');
    // Should include uuid-1 ('all' context) and uuid-2 ('thread' context)
    // Should NOT include uuid-3 (disabled)
    console.assert(threadActions.length === 2, 'Should return 2 enabled thread actions');
    console.assert(threadActions.some(a => a.id === 'uuid-1'), 'Should include all-context action');
    console.assert(threadActions.some(a => a.id === 'uuid-2'), 'Should include thread-context action');
    ```

### Expected Behaviors

- **Hydration**: After `hydrate()`, `_hydrated` should be `true` and `actions` should contain all manifest entries merged with registry overrides
- **UUID stability**: Same slug should always map to same UUID across hydrations (verified via `slugToId` persistence)
- **Hotkey uniqueness**: `getByHotkey()` should return only one action (first match among enabled actions)
- **Order consistency**: `getAll()` and `getForContext()` should return actions sorted by `order` field
- **Registry persistence**: Changes via `update()` or `reorder()` should be immediately written to disk
