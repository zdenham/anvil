import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { ClipboardEntryPreview, ClipboardEntryPreviewSchema } from "./types";
import { ClipboardList } from "./clipboard-list";
import { ClipboardPreview } from "./clipboard-preview";
import { SearchInput } from "../reusable/search-input";
import { logger } from "../../lib/logger-client";
import { eventBus } from "../../entities";

// Note: This component is remounted on each panel-hidden event (see clipboard-main.tsx)
// This ensures fresh state (selectedIndex=0) with no flash of old selection

export class ClipboardController {
  async getHistory(query?: string): Promise<ClipboardEntryPreview[]> {
    const raw = await invoke<unknown>("get_clipboard_history", { query });
    return z.array(ClipboardEntryPreviewSchema).parse(raw);
  }

  async getContent(id: string): Promise<string | null> {
    return invoke<string | null>("get_clipboard_content", { id });
  }

  async pasteEntry(id: string): Promise<void> {
    await invoke("paste_clipboard_entry", { id });
  }

  async hideClipboardManager(): Promise<void> {
    await invoke("hide_clipboard_manager");
  }
}

export const ClipboardManager = () => {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<ClipboardEntryPreview[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<ClipboardController>(new ClipboardController());

  // Use a ref to track the latest request to prevent race conditions
  const loadRequestIdRef = useRef(0);
  const contentRequestIdRef = useRef(0);

  const loadEntries = useCallback(async (searchQuery?: string) => {
    const controller = controllerRef.current;
    const requestId = ++loadRequestIdRef.current;
    logger.log("[clipboard] loadEntries called", { searchQuery, requestId });

    const results = await controller.getHistory(searchQuery);

    // Only update state if this is still the latest request
    if (requestId !== loadRequestIdRef.current) {
      logger.log("[clipboard] loadEntries skipped (stale)", {
        requestId,
        currentId: loadRequestIdRef.current,
      });
      return;
    }

    logger.log("[clipboard] loadEntries completed", {
      requestId,
      resultCount: results.length,
    });
    setEntries(results);
    setSelectedIndex((prevIndex) =>
      prevIndex >= results.length ? Math.max(0, results.length - 1) : prevIndex
    );
  }, []);

  // Load content when selection changes
  const selectedEntry = entries[selectedIndex] || null;
  useEffect(() => {
    if (!selectedEntry) {
      setSelectedContent(null);
      return;
    }

    const controller = controllerRef.current;
    const requestId = ++contentRequestIdRef.current;

    controller.getContent(selectedEntry.id).then((content) => {
      // Only update if this is still the latest request
      if (requestId === contentRequestIdRef.current) {
        setSelectedContent(content);
      }
    });
  }, [selectedEntry?.id]);

  const activateEntry = useCallback(async (entry: ClipboardEntryPreview) => {
    const controller = controllerRef.current;
    await controller.pasteEntry(entry.id);
    await controller.hideClipboardManager();
  }, []);

  // Load entries on mount and when query changes
  useEffect(() => {
    const searchQuery = query.trim() || undefined;
    loadEntries(searchQuery);
  }, [query, loadEntries]);

  // Refresh entries when new clipboard entry is added via eventBus
  useEffect(() => {
    const handleClipboardEntryAdded = () => {
      logger.log(
        "[clipboard] clipboard-entry-added received",
        new Date().toISOString()
      );
      const searchQuery = query.trim() || undefined;
      loadEntries(searchQuery);
    };

    eventBus.on("clipboard-entry-added", handleClipboardEntryAdded);

    return () => {
      eventBus.off("clipboard-entry-added", handleClipboardEntryAdded);
    };
  }, [loadEntries, query]);

  // Focus input when panel gains focus via eventBus
  useEffect(() => {
    const handleFocusChanged = ({ focused }: { focused: boolean }) => {
      logger.log("[clipboard] focus changed", { focused });
      if (focused) {
        inputRef.current?.focus();
      }
    };

    eventBus.on("window:focus-changed", handleFocusChanged);

    return () => {
      eventBus.off("window:focus-changed", handleFocusChanged);
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    inputRef.current?.focus();
    const controller = controllerRef.current;

    const handleKeyDown = async (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          await controller.hideClipboardManager();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < entries.length - 1 ? prev + 1 : prev
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (entries.length > 0 && entries[selectedIndex]) {
            await activateEntry(entries[selectedIndex]);
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [entries, selectedIndex, activateEntry]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (entries.length > 0 && entries[selectedIndex]) {
      activateEntry(entries[selectedIndex]);
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Search input */}
      <form onSubmit={handleSubmit}>
        <SearchInput
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          hasContentBelow
          autoFocus
        />
      </form>

      {/* Main content area with list and preview */}
      <div className="flex flex-1 overflow-hidden bg-gradient-to-br from-surface-900 to-surface-800 border border-t-0 border-surface-700/50 rounded-b-xl">
        {/* Left panel: list */}
        <div className="w-1/2 border-r border-surface-700/50 overflow-hidden">
          <ClipboardList
            entries={entries}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onActivate={activateEntry}
          />
        </div>

        {/* Right panel: preview */}
        <div className="w-1/2 overflow-hidden">
          <ClipboardPreview entry={selectedEntry} content={selectedContent} />
        </div>
      </div>
    </div>
  );
};
