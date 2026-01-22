import { create } from 'zustand';

interface NavigationBannerState {
  isVisible: boolean;
  completionMessage: string;
  nextItemMessage: string;
  showBanner: (completionMessage: string, nextItemMessage: string) => void;
  hideBanner: () => void;
}

export const useNavigationBannerStore = create<NavigationBannerState>((set, get) => ({
  isVisible: false,
  completionMessage: '',
  nextItemMessage: '',

  showBanner: (completionMessage: string, nextItemMessage: string) => {
    set({ isVisible: true, completionMessage, nextItemMessage });

    // Auto-hide after 600ms
    setTimeout(() => {
      get().hideBanner();
    }, 600);
  },

  hideBanner: () => set({ isVisible: false, completionMessage: '', nextItemMessage: '' }),
}));