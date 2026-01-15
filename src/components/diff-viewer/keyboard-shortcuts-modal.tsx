import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { key: "j", description: "Next file" },
  { key: "k", description: "Previous file" },
  { key: "e", description: "Expand all collapsed regions" },
  { key: "c", description: "Collapse all regions" },
  { key: "?", description: "Show keyboard shortcuts" },
] as const;

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
}: KeyboardShortcutsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Focus trap
  useEffect(() => {
    if (isOpen) {
      modalRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className={cn(
          "w-full max-w-sm bg-surface-900 border border-surface-700 rounded-lg shadow-xl",
          "focus:outline-none"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
          <h2 id="shortcuts-title" className="text-sm font-medium text-surface-100">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-700 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4 text-surface-400" />
          </button>
        </div>

        <div className="p-4">
          <table className="w-full">
            <tbody>
              {shortcuts.map(({ key, description }) => (
                <tr key={key}>
                  <td className="py-1.5 pr-4">
                    <kbd
                      className={cn(
                        "inline-flex items-center justify-center",
                        "min-w-[24px] px-2 py-0.5",
                        "bg-surface-800 border border-surface-600 rounded",
                        "text-xs font-mono text-surface-200"
                      )}
                    >
                      {key}
                    </kbd>
                  </td>
                  <td className="py-1.5 text-sm text-surface-300">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
