import { useState, useEffect, useRef } from "react";
import { Trash2, Loader2 } from "lucide-react";

interface DeleteButtonProps {
  onDelete: () => void | Promise<void>;
}

export function DeleteButton({ onDelete }: DeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        console.log(`[DeleteButton] Click outside detected, cancelling confirmation`);
        setConfirming(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [confirming]);

  const handleClick = async (e: React.MouseEvent) => {
    console.log(`[DeleteButton] handleClick called, confirming: ${confirming}, isDeleting: ${isDeleting}`);
    e.stopPropagation();

    if (isDeleting) {
      console.log(`[DeleteButton] Already deleting, ignoring click`);
      return;
    }

    if (confirming) {
      console.log(`[DeleteButton] Confirmation click - starting deletion`);
      setIsDeleting(true);
      try {
        console.log(`[DeleteButton] Calling onDelete callback`);
        await onDelete();
        console.log(`[DeleteButton] onDelete completed successfully`);
      } catch (error) {
        console.error(`[DeleteButton] Error during deletion:`, error);
        throw error;
      } finally {
        console.log(`[DeleteButton] Resetting delete state`);
        setIsDeleting(false);
        setConfirming(false);
      }
    } else {
      console.log(`[DeleteButton] First click - showing confirmation`);
      setConfirming(true);
    }
  };

  if (isDeleting) {
    return (
      <span className="p-1 text-surface-500">
        <Loader2 size={14} className="animate-spin" />
      </span>
    );
  }

  return (
    <button
      ref={buttonRef}
      className={`opacity-100 p-1 transition-opacity ${
        confirming
          ? "opacity-100 text-red-400 text-xs font-medium"
          : "text-surface-500 hover:text-red-400"
      }`}
      onClick={handleClick}
    >
      {confirming ? "Confirm" : <Trash2 size={14} />}
    </button>
  );
}
