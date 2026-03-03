import { useToastStore } from "@/lib/toast";

const typeStyles: Record<string, string> = {
  info: "bg-surface-700 border-surface-600 text-surface-100",
  success: "bg-emerald-700 border-emerald-600 text-white",
  error: "bg-red-700 border-red-600 text-white",
};

export function GlobalToast() {
  const toast = useToastStore((s) => s.toast);
  const hideToast = useToastStore((s) => s.hideToast);

  if (!toast) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]">
      <div
        className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg shadow-lg border animate-in fade-in slide-in-from-bottom-2 duration-200 ${typeStyles[toast.type] ?? typeStyles.info}`}
      >
        <span>{toast.message}</span>
        {toast.options?.action && (
          <button
            onClick={toast.options.action.onClick}
            className="underline underline-offset-2 opacity-80 hover:opacity-100"
          >
            {toast.options.action.label}
          </button>
        )}
        <button
          onClick={hideToast}
          className="ml-1 opacity-60 hover:opacity-100"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
