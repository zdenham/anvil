import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// useContextMenu hook
// ---------------------------------------------------------------------------

interface ContextMenuState {
  show: boolean;
  position: { top: number; left: number };
  open: (e: React.MouseEvent) => void;
  close: () => void;
}

export function useContextMenu(): ContextMenuState {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPosition({ top: e.clientY, left: e.clientX });
    setShow(true);
  };

  const close = () => setShow(false);

  return { show, position, open, close };
}

// ---------------------------------------------------------------------------
// ContextMenu (portal wrapper)
// ---------------------------------------------------------------------------

interface ContextMenuProps {
  position: { top: number; left: number };
  onClose: () => void;
  children: React.ReactNode;
}

export function ContextMenu({ position, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 bg-surface-900 border border-surface-700 rounded-lg shadow-lg p-1.5 min-w-[180px]"
      style={{ top: position.top, left: position.left }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// ContextMenuItem
// ---------------------------------------------------------------------------

interface ContextMenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

export function ContextMenuItem({ icon: Icon, label, onClick }: ContextMenuItemProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
    >
      <Icon size={11} className="flex-shrink-0" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ContextMenuItemDanger (red styling for destructive actions)
// ---------------------------------------------------------------------------

interface ContextMenuItemDangerProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

export function ContextMenuItemDanger({ icon: Icon, label, onClick }: ContextMenuItemDangerProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="w-full px-2.5 py-1 text-left text-xs text-red-400 hover:bg-red-500/10 rounded flex items-center gap-2 whitespace-nowrap"
    >
      <Icon size={11} className="flex-shrink-0" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ContextMenuDivider
// ---------------------------------------------------------------------------

export function ContextMenuDivider() {
  return <div className="h-px bg-surface-700 my-1" />;
}
