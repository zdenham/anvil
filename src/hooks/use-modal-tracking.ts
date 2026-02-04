import { useEffect } from 'react';
import { useModalStore } from '@/stores/modal-store.js';

/**
 * Hook to automatically track modal open/close state.
 * Call this in modal components to register with the modal store.
 *
 * @param isOpen - Whether the modal is currently open
 *
 * @example
 * function MyModal({ open, onOpenChange }) {
 *   useModalTracking(open);
 *   return <Dialog open={open} onOpenChange={onOpenChange}>...</Dialog>;
 * }
 */
export function useModalTracking(isOpen: boolean) {
  const openModal = useModalStore((s) => s.openModal);
  const closeModal = useModalStore((s) => s.closeModal);

  useEffect(() => {
    if (isOpen) {
      openModal();
      return () => closeModal();
    }
  }, [isOpen, openModal, closeModal]);
}
