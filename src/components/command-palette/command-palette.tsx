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
import { getFileSearchService } from "@/lib/triggers/file-search-service";
import { useMRUWorktree } from "@/hooks/use-mru-worktree";
import { CommandPaletteItem } from "./command-palette-item";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mouseMovedSinceOpen, setMouseMovedSinceOpen] = useState(false);
  const [fileItems, setFileItems] = useState<PreviewableItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get MRU worktree for file search context
  const { workingDirectory, repoId, worktreeId } = useMRUWorktree();

  // Get all threads and plans
  const threads = useThreadStore((s) => s._threadsArray);
  const plans = usePlanStore((s) => s._plansArray);

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

  // Filter by query; append file results when query is non-empty
  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;

    const lowerQuery = query.toLowerCase();
    const matched = items.filter((item) => {
      const nameMatch = item.name.toLowerCase().includes(lowerQuery);
      const previewMatch = item.preview?.toLowerCase().includes(lowerQuery);
      return nameMatch || previewMatch;
    });

    return [...matched, ...fileItems];
  }, [items, query, fileItems]);

  // Selected item for preview
  const selectedItem = filteredItems[selectedIndex] ?? null;

  // Load plan content for preview when a plan is selected
  const { content: planContent, isLoading: planLoading } = usePlanContent(
    selectedItem?.type === "plan" ? selectedItem.id : null
  );

  // Get preview for selected item
  const selectedPreview = useMemo(() => {
    if (!selectedItem) return null;
    if (selectedItem.type === "thread") return selectedItem.preview;
    if (selectedItem.type === "file") return `File — ${selectedItem.filePath}`;
    return getPlanPreviewContent(planContent);
  }, [selectedItem, planContent]);

  // Reset state when opened; eagerly load file search cache
  useEffect(() => {
    if (!isOpen) return;

    setQuery("");
    setSelectedIndex(0);
    setMouseMovedSinceOpen(false);
    setFileItems([]);
    setTimeout(() => inputRef.current?.focus(), 0);

    if (workingDirectory) {
      getFileSearchService().load(workingDirectory);
    }
  }, [isOpen, workingDirectory]);

  // Invalidate file search cache on close/unmount
  useEffect(() => {
    return () => {
      if (workingDirectory) {
        getFileSearchService().invalidate(workingDirectory);
      }
    };
  }, [workingDirectory]);

  // Search files when query changes
  useEffect(() => {
    if (!query.trim() || !workingDirectory) {
      setFileItems([]);
      return;
    }

    let cancelled = false;
    getFileSearchService()
      .search(workingDirectory, query, { maxResults: 20 })
      .then((results) => {
        if (cancelled) return;
        setFileItems(
          results.map((r) => ({
            type: "file" as const,
            id: r.path,
            name: r.path,
            filePath: r.path,
            preview: null,
            updatedAt: 0,
            repoId: repoId ?? "",
            worktreeId: worktreeId ?? "",
          }))
        );
      });

    return () => {
      cancelled = true;
    };
  }, [query, workingDirectory, repoId, worktreeId]);

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
      } else if (item.type === "file" && item.filePath) {
        // File search returns relative paths; resolve to absolute for FileContent
        const absolutePath = workingDirectory
          ? `${workingDirectory}/${item.filePath}`
          : item.filePath;
        await navigationService.navigateToFile(absolutePath, {
          repoId: repoId ?? undefined,
          worktreeId: worktreeId ?? undefined,
        });
      } else {
        await navigationService.navigateToPlan(item.id);
      }
      onClose();
    },
    [onClose, repoId, worktreeId]
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
      data-testid="command-palette"
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
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search threads, plans, and files..."
            className="w-full bg-transparent text-surface-200 placeholder-surface-500 outline-none text-sm"
            autoFocus
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
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
                index={index}
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
