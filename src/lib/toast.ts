/**
 * Toast Notification Utility
 *
 * Simple in-memory toast notification system for the Quick Actions SDK.
 * Uses a zustand store to manage toast state.
 */

import { create } from 'zustand';

export interface ToastOptions {
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface ToastState {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  options?: ToastOptions;
}

interface ToastStore {
  toast: ToastState | null;
  showToast: (message: string, type: ToastState['type'], options?: ToastOptions) => void;
  hideToast: () => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toast: null,

  showToast: (message: string, type: ToastState['type'], options?: ToastOptions) => {
    const id = crypto.randomUUID();
    set({ toast: { id, message, type, options } });

    // Auto-hide after duration (default 3 seconds)
    const duration = options?.duration ?? 3000;
    setTimeout(() => {
      // Only hide if still showing the same toast
      if (get().toast?.id === id) {
        get().hideToast();
      }
    }, duration);
  },

  hideToast: () => set({ toast: null }),
}));

/**
 * Toast notification helper
 *
 * Usage:
 *   toast.info('Message sent');
 *   toast.success('Action completed');
 *   toast.error('Failed to execute', { action: { label: 'View logs', onClick: openLogs } });
 */
export const toast = {
  info: (message: string, options?: ToastOptions) => {
    useToastStore.getState().showToast(message, 'info', options);
  },
  success: (message: string, options?: ToastOptions) => {
    useToastStore.getState().showToast(message, 'success', options);
  },
  error: (message: string, options?: ToastOptions) => {
    useToastStore.getState().showToast(message, 'error', options);
  },
};
