import { useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { quickActionService } from '@/entities/quick-actions/service.js';
import { QuickActionListItem } from './quick-action-list-item.js';
import { QuickActionEditModal } from './quick-action-edit-modal.js';
import { Button } from '@/components/reusable/Button.js';
import { toast } from '@/lib/toast.js';

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
            Manage your quick actions and assign hotkeys ({'\u2318'}0-9)
          </p>
        </div>
        <Button
          variant="ghost"
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
