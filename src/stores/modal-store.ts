import { create } from 'zustand';

/**
 * Simple store for tracking whether any modal is currently open.
 * Used by hotkey handlers to disable hotkeys when modals are open (DD #16).
 *
 * Modal components should call openModal() on mount and closeModal() on unmount.
 * For modals using Radix UI Dialog, integrate with onOpenChange callback.
 */
interface ModalState {
  /** Count of currently open modals (supports nested modals) */
  openCount: number;

  /** Derived: true if any modal is open */
  isOpen: boolean;

  /** Call when a modal opens */
  openModal: () => void;

  /** Call when a modal closes */
  closeModal: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  openCount: 0,
  isOpen: false,

  openModal: () =>
    set((state) => ({
      openCount: state.openCount + 1,
      isOpen: true,
    })),

  closeModal: () =>
    set((state) => ({
      openCount: Math.max(0, state.openCount - 1),
      isOpen: state.openCount - 1 > 0,
    })),
}));

/**
 * Get current modal state (non-reactive, for use outside React).
 */
export function getModalState(): Pick<ModalState, 'isOpen' | 'openCount'> {
  const { isOpen, openCount } = useModalStore.getState();
  return { isOpen, openCount };
}
