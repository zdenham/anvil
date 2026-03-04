import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/reusable/Button.js';
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
      setError(`\u2318${num} is already assigned to another action`);
      return;
    }

    setHotkey(num);
    setError(null);
  };

  const handleSave = useCallback(() => {
    if (error) return;
    onSave({ hotkey });
  }, [error, hotkey, onSave]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && !error) {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handleSave, error]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        data-testid="quick-action-edit-modal"
        className="relative bg-surface-800 rounded-lg border border-surface-700 shadow-xl w-full max-w-md mx-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-700">
          <h2 id="edit-modal-title" className="text-lg font-semibold text-surface-100">
            Edit {action.title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-200 mb-1">
              Hotkey ({'\u2318'}0-9)
            </label>
            <input
              type="text"
              value={hotkey ?? ''}
              onChange={(e) => handleHotkeyChange(e.target.value)}
              placeholder="None"
              className="w-20 px-3 py-2 bg-surface-900 border border-surface-600 rounded-md text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
              maxLength={1}
              autoFocus
            />
            {error && (
              <p className="mt-1 text-sm text-red-400">{error}</p>
            )}
          </div>

          <div className="text-sm text-surface-400">
            <p>
              <strong className="text-surface-300">Contexts:</strong> {action.contexts.join(', ')}
            </p>
            {action.description && (
              <p className="mt-1">{action.description}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-surface-700">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!!error}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
