import { useNavigationBannerStore } from '@/stores/navigation-banner-store';
import { useEffect, useState } from 'react';
import { CheckCircle, ArrowRight } from 'lucide-react';

export function NavigationBanner() {
  const { isVisible, completionMessage, nextTaskMessage } = useNavigationBannerStore();
  const [shouldRender, setShouldRender] = useState(false);

  // Handle mount/unmount for smooth animations
  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
    } else {
      // Delay unmounting to allow exit animation
      const timer = setTimeout(() => setShouldRender(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  if (!shouldRender) return null;

  return (
    <div
      className={`
        absolute inset-x-0 bottom-[60px] z-50
        h-[120px] flex items-center justify-center
        backdrop-blur-lg bg-black/40
        transition-all duration-200 ease-out
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
      `}
      role="status"
      aria-live="polite"
    >
      <div className="bg-black/30 text-white px-6 py-4 rounded-lg text-sm font-medium border border-white/10">
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-2 text-green-300">
            <CheckCircle size={16} />
            <span>{completionMessage}</span>
          </div>
          <ArrowRight size={16} className="text-white/60" />
          <div className="text-white">
            {nextTaskMessage}
          </div>
        </div>
      </div>
    </div>
  );
}