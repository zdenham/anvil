import { useCallback, useEffect, useRef, useState } from "react";
import { Cog, Ellipsis, ScrollText, Eye } from "lucide-react";
import { cn } from "../../lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

interface MenuDropdownProps {
  onSettingsClick: () => void;
  onLogsClick: () => void;
  /** Called when user clicks "Show all workspaces" */
  onUnhideAll?: () => void;
  /** Whether any workspaces are hidden or pinned (shows "Show all" option) */
  hasHiddenOrPinned?: boolean;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export function MenuDropdown({ onSettingsClick, onLogsClick, onUnhideAll, hasHiddenOrPinned }: MenuDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const menuItems: MenuItem[] = [
    // Show "Show all workspaces" option when there are hidden/pinned sections
    ...(hasHiddenOrPinned && onUnhideAll
      ? [{ id: "unhide-all", label: "Show all workspaces", icon: <Eye size={12} />, onClick: onUnhideAll }]
      : []),
    { id: "settings", label: "Settings", icon: <Cog size={12} />, onClick: onSettingsClick },
    { id: "logs", label: "Logs", icon: <ScrollText size={12} />, onClick: onLogsClick },
  ];

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Reset focused index when opening
  useEffect(() => {
    if (isOpen) {
      setFocusedIndex(0);
    }
  }, [isOpen]);

  // Scroll focused item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const focusedItem = listRef.current.children[focusedIndex] as HTMLElement;
      focusedItem?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex, isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, menuItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          menuItems[focusedIndex].onClick();
          setIsOpen(false);
          buttonRef.current?.focus();
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          buttonRef.current?.focus();
          break;
        case "Home":
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setFocusedIndex(menuItems.length - 1);
          break;
      }
    },
    [isOpen, menuItems, focusedIndex]
  );

  const handleSelect = (item: MenuItem) => {
    item.onClick();
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={dropdownRef} className="relative" onKeyDown={handleKeyDown}>
      <Tooltip content="More options" side="bottom">
        <button
          ref={buttonRef}
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "flex items-center justify-center w-5 h-5 rounded",
            "hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors",
            "focus:outline-none focus:ring-1 focus:ring-surface-500"
          )}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <Ellipsis size={12} />
        </button>
      </Tooltip>

      {isOpen && (
        <div
          ref={listRef}
          role="menu"
          aria-activedescendant={`menu-option-${focusedIndex}`}
          className={cn(
            "absolute top-full right-0 mt-1 z-50",
            "w-[140px]",
            "bg-surface-800 border border-surface-700 rounded-lg shadow-lg",
            "py-1"
          )}
        >
          {menuItems.map((item, index) => (
            <div
              key={item.id}
              id={`menu-option-${index}`}
              role="menuitem"
              tabIndex={-1}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 cursor-pointer",
                "text-sm text-surface-200",
                index === focusedIndex && "bg-surface-700"
              )}
            >
              <span className="text-surface-400">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
