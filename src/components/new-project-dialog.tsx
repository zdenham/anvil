import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useModalTracking } from "@/hooks/use-modal-tracking";
import { Input } from "@/components/reusable/Input";
import { Button } from "@/components/reusable/Button";

interface NewProjectDialogStore {
  isOpen: boolean;
  resolve: ((name: string | null) => void) | null;
  open: (resolve: (name: string | null) => void) => void;
  close: () => void;
}

const useNewProjectDialogStore = create<NewProjectDialogStore>((set) => ({
  isOpen: false,
  resolve: null,
  open: (resolve) => set({ isOpen: true, resolve }),
  close: () =>
    set((state) => {
      state.resolve?.(null);
      return { isOpen: false, resolve: null };
    }),
}));

/**
 * Opens the "New Project" dialog and returns the project name,
 * or null if the user cancels.
 */
export function requestNewProjectName(): Promise<string | null> {
  return new Promise((resolve) => {
    useNewProjectDialogStore.getState().open(resolve);
  });
}

export function NewProjectDialog() {
  const { isOpen, resolve, close } = useNewProjectDialogStore();
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useModalTracking(isOpen);

  // Auto-focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      // Delay focus to after portal render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed || !resolve) return;
    resolve(trimmed);
    useNewProjectDialogStore.setState({ isOpen: false, resolve: null });
  }, [name, resolve]);

  const handleCancel = useCallback(() => {
    close();
  }, [close]);

  // Keyboard: Escape to cancel, Enter to submit
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, handleCancel, handleSubmit]);

  if (!isOpen) return null;

  const isValid = name.trim().length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleCancel}
    >
      <div
        className="bg-surface-800 border border-surface-700 rounded-lg shadow-xl w-[400px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-surface-700">
          <h2 className="text-sm font-medium text-surface-100">New Project</h2>
        </div>
        <div className="p-4">
          <label className="block text-xs text-surface-400 mb-2">
            Project name
          </label>
          <Input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-project"
            className="w-full text-surface-100 border-surface-600 placeholder:text-surface-500 focus-visible:ring-surface-400"
          />
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-surface-700">
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!isValid}>
            Create
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
