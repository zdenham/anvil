import { useQuickActionsStore } from './store.js';
import type {
  QuickActionMetadata,
  QuickActionManifest,
  QuickActionsRegistry,
  UpdateQuickActionInput,
  ResolvedQuickAction,
} from './types.js';
import { QuickActionManifestSchema, QuickActionsRegistrySchema } from '@core/types/quick-actions.js';
import { persistence } from '@/lib/persistence.js';
import { logger } from '@/lib/logger-client.js';

const REGISTRY_FILENAME = 'quick-actions-registry.json';
const QUICK_ACTIONS_DIR = 'quick-actions';

async function readRegistry(): Promise<QuickActionsRegistry> {
  try {
    const content = await persistence.readJson<QuickActionsRegistry>(REGISTRY_FILENAME);
    if (!content) {
      return { actionOverrides: {}, slugToId: {} };
    }
    return QuickActionsRegistrySchema.parse(content);
  } catch {
    return { actionOverrides: {}, slugToId: {} };
  }
}

async function writeRegistry(registry: QuickActionsRegistry): Promise<void> {
  await persistence.writeJson(REGISTRY_FILENAME, registry);
}

async function readManifest(): Promise<QuickActionManifest | null> {
  const manifestPath = `${QUICK_ACTIONS_DIR}/dist/manifest.json`;

  try {
    const content = await persistence.readJson<QuickActionManifest>(manifestPath);
    if (!content) {
      return null;
    }
    return QuickActionManifestSchema.parse(content);
  } catch {
    return null;
  }
}

export const quickActionService = {
  /**
   * Hydrate the store from disk (manifest + registry)
   */
  async hydrate(): Promise<void> {
    logger.log('[quickActionService:hydrate] Starting quick action hydration...');

    const projectPath = await persistence.getAbsolutePath(QUICK_ACTIONS_DIR);

    const manifest = await readManifest();
    if (!manifest) {
      logger.log('[quickActionService:hydrate] No manifest found, skipping');
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
        id = crypto.randomUUID();
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

    logger.log(`[quickActionService:hydrate] Complete. Loaded ${Object.keys(actions).length} actions`);
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
