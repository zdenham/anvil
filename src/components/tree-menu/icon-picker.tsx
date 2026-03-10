import { useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Folder, FolderOpen, Bug, Zap, Star, Bookmark,
  Flag, Tag, Archive, Box, Layers, LayoutGrid,
  Code, Wrench, Shield, Heart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Map of icon name strings to Lucide components.
 *  Used by FolderItem to resolve icon names from FolderMetadata.icon field. */
export const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  "folder": Folder,
  "folder-open": FolderOpen,
  "bug": Bug,
  "zap": Zap,
  "star": Star,
  "bookmark": Bookmark,
  "flag": Flag,
  "tag": Tag,
  "archive": Archive,
  "box": Box,
  "layers": Layers,
  "layout-grid": LayoutGrid,
  "code": Code,
  "wrench": Wrench,
  "shield": Shield,
  "heart": Heart,
};

/** Ordered list of icon names for display in the picker grid. */
export const ICON_OPTIONS = Object.keys(LUCIDE_ICON_MAP);

interface IconPickerProps {
  currentIcon: string;
  anchorPosition: { top: number; left: number };
  onSelect: (iconName: string) => void;
  onClose: () => void;
}

/**
 * Small floating popover showing a 4x4 grid of 16 Lucide icons.
 * Rendered via portal to escape overflow containers.
 * Close on click outside or Escape key.
 */
export function IconPicker({
  currentIcon, anchorPosition, onSelect, onClose,
}: IconPickerProps) {
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
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 bg-surface-900 border border-surface-700 rounded-lg shadow-lg p-2"
      style={{ top: anchorPosition.top, left: anchorPosition.left }}
    >
      <div className="grid grid-cols-4 gap-1">
        {ICON_OPTIONS.map((name) => {
          const Icon = LUCIDE_ICON_MAP[name];
          const isSelected = name === currentIcon;
          return (
            <button
              key={name}
              type="button"
              title={name}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(name);
              }}
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded",
                "transition-colors duration-75",
                isSelected
                  ? "bg-accent-500/20 text-accent-300"
                  : "text-surface-300 hover:bg-surface-800",
              )}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
