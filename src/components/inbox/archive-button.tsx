import { useState, useEffect, useRef } from "react";
import { Trash2, Loader2 } from "lucide-react";

interface ArchiveButtonProps {
  onArchive: () => void | Promise<void>;
}

/**
 * A two-click archive button with confirmation pattern.
 *
 * Behavior:
 * 1. Hidden by default (opacity-0), visible on row hover (group-hover:opacity-100)
 * 2. First click shows "Confirm" text
 * 3. Second click triggers the archive action with loading spinner
 * 4. Click outside cancels confirmation state
 */
export function ArchiveButton({ onArchive }: ArchiveButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Click outside to cancel confirmation
  useEffect(() => {
    if (!confirming) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setConfirming(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [confirming]);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isArchiving) return;

    if (confirming) {
      // Second click - execute archive
      setIsArchiving(true);
      try {
        await onArchive();
      } finally {
        setIsArchiving(false);
        setConfirming(false);
      }
    } else {
      // First click - show confirmation
      setConfirming(true);
    }
  };

  if (isArchiving) {
    return (
      <span className="p-1 text-surface-500" data-testid="archive-loading">
        <Loader2 size={14} className="animate-spin" />
      </span>
    );
  }

  return (
    <button
      ref={buttonRef}
      className={`p-1 transition-colors ${
        confirming
          ? "opacity-100 text-red-400 text-xs font-medium"
          : "opacity-0 group-hover:opacity-100 text-surface-500 hover:text-red-400"
      }`}
      onClick={handleClick}
      aria-label={confirming ? "Confirm archive" : "Archive"}
      data-testid="archive-button"
      data-confirming={confirming}
    >
      {confirming ? "Confirm" : <Trash2 size={14} />}
    </button>
  );
}
