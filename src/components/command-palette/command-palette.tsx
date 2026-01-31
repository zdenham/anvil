import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { usePlanContent } from "@/hooks/use-plan-content";
import {
  getThreadPreviewContent,
  getPlanPreviewContent,
  type PreviewableItem,
} from "@/lib/preview-content";
import { navigationService } from "@/stores/navigation-service";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mouseMovedSinceOpen, setMouseMovedSinceOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get all threads and plans
  const threads = useThreadStore((s) => s.getAllThreads());
  const plans = usePlanStore((s) => s.getAll());

  // Build searchable items list
  const items: PreviewableItem[] = useMemo(() => {
    const threadItems: PreviewableItem[] = threads.map((t) => ({
        type: "thread" as const,
        id: t.id,
        name: t.name ?? "Unnamed Thread",
        preview: getThreadPreviewContent(t),
        updatedAt: t.updatedAt,
        repoId: t.repoId,
        worktreeId: t.worktreeId,
      }));

    const planItems: PreviewableItem[] = plans
      .filter((p) => !p.stale)
      .map((p) => ({
        type: "plan" as const,
        id: p.id,
        name: p.relativePath.replace(/\.md$/, ""),
        preview: null, // Loaded on selection
        updatedAt: p.updatedAt,
        repoId: p.repoId,
        worktreeId: p.worktreeId,
      }));

    // Sort by most recently updated
    return [...threadItems, ...planItems].sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }, [threads, plans]);

  // Filter by query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;

    const lowerQuery = query.toLowerCase();
    return items.filter((item) => {
      const nameMatch = item.name.toLowerCase().includes(lowerQuery);
      const previewMatch = item.preview?.toLowerCase().includes(lowerQuery);
      return nameMatch || previewMatch;
    });
  }, [items, query]);

  // Selected item for preview
  const selectedItem = filteredItems[selectedIndex] ?? null;

  // Load plan content for preview when a plan is selected
  const { content: planContent, isLoading: planLoading } = usePlanContent(
    selectedItem?.type === "plan" ? selectedItem.id : null
  );

  // Get preview for selected item
  const selectedPreview = useMemo(() => {
    if (!selectedItem) return null;
    if (selectedItem.type === "thread") {
      return selectedItem.preview;
    }
    return getPlanPreviewContent(planContent);
  }, [selectedItem, planContent]);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setMouseMovedSinceOpen(false);
      // Focus with a slight delay to ensure the modal is rendered
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Keep selectedIndex in bounds
  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector('[data-selected="true"]');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Navigate to selected item (updates content pane and tree selection)
  const navigateToItem = useCallback(
    async (item: PreviewableItem) => {
      if (item.type === "thread") {
        await navigationService.navigateToThread(item.id);
      } else {
        await navigationService.navigateToPlan(item.id);
      }
      onClose();
    },
    [onClose]
  );

  // Keyboard navigation handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle Cmd/Ctrl+P to close the palette (toggle behavior)
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (selectedItem) {
            navigateToItem(selectedItem);
          }
          break;
        default:
          // Stop propagation for other keys to prevent content pane from stealing focus
          e.stopPropagation();
          break;
      }
    },
    [filteredItems.length, selectedItem, navigateToItem, onClose]
  );

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Stop all events from propagating to prevent content pane from stealing focus
  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      onKeyUp={stopPropagation}
      onFocus={stopPropagation}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} onMouseMove={() => setMouseMovedSinceOpen(true)} />

      {/* Palette */}
      <div
        className="relative w-full max-w-2xl bg-surface-900 rounded-xl shadow-2xl border border-surface-700 overflow-hidden"
        onKeyDown={handleKeyDown}
        onMouseMove={() => setMouseMovedSinceOpen(true)}
      >
        {/* Search input */}
        <div className="p-3 border-b border-surface-700">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search threads and plans..."
            className="w-full bg-transparent text-surface-200 placeholder-surface-500 outline-none text-sm"
            autoFocus
          />
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-[240px] overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="p-3 text-center text-surface-500 text-sm">
              No results found
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <CommandPaletteItem
                key={`${item.type}-${item.id}`}
                item={item}
                isSelected={index === selectedIndex}
                onClick={() => navigateToItem(item)}
                onHover={() => mouseMovedSinceOpen && setSelectedIndex(index)}
              />
            ))
          )}
        </div>

        {/* Preview panel - fixed at bottom */}
        <div className="border-t border-dashed border-surface-700 p-3 min-h-[80px]">
          {selectedItem ? (
            <>
              <div className="text-xs text-surface-500 mb-1">
                Preview
              </div>
              <div className="text-sm text-surface-300 whitespace-pre-wrap line-clamp-3">
                {selectedItem.type === "plan" && planLoading ? (
                  <span className="text-surface-500">Loading...</span>
                ) : (
                  selectedPreview ?? (
                    <span className="text-surface-500">No preview available</span>
                  )
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-surface-500">No item selected</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CommandPaletteItemProps {
  item: PreviewableItem;
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
}

function CommandPaletteItem({
  item,
  isSelected,
  onClick,
  onHover,
}: CommandPaletteItemProps) {
  return (
    <div
      data-selected={isSelected}
      className={cn(
        "px-3 py-1.5 cursor-pointer flex items-center gap-2",
        isSelected && "bg-surface-700"
      )}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      {/* Type indicator */}
      <div
        className={cn(
          "w-1.5 h-1.5 rounded-full flex-shrink-0",
          item.type === "thread" ? "bg-accent-500" : "bg-blue-500"
        )}
      />

      {/* Name */}
      <div className="flex-1 min-w-0 text-sm text-surface-200 truncate">
        {item.name}
      </div>

      {/* Type label */}
      <div className="text-xs text-surface-500 flex-shrink-0">
        {item.type === "thread" ? "Thread" : "Plan"}
      </div>
    </div>
  );
}
