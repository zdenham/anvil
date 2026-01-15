import { create } from 'zustand';

interface NavigationBannerState {
  isVisible: boolean;
  completionMessage: string;
  nextTaskMessage: string;
  showBanner: (completionMessage: string, nextTaskMessage: string) => void;
  hideBanner: () => void;
}

export const useNavigationBannerStore = create<NavigationBannerState>((set, get) => ({
  isVisible: false,
  completionMessage: '',
  nextTaskMessage: '',

  showBanner: (completionMessage: string, nextTaskMessage: string) => {
    set({ isVisible: true, completionMessage, nextTaskMessage });

    // Auto-hide after 600ms
    setTimeout(() => {
      get().hideBanner();
    }, 600);
  },

  hideBanner: () => set({ isVisible: false, completionMessage: '', nextTaskMessage: '' }),
}));