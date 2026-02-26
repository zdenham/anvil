/**
 * ContentPane
 *
 * Main wrapper component for content panes. Renders:
 * - ContentPaneHeader (based on view type)
 * - View-specific content (thread, plan, settings, logs, empty)
 *
 * Each pane has a UUID and manages its own state independently.
 */

import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { ContentPaneHeader } from "./content-pane-header";
import { FindBar } from "./find-bar";
import { ThreadContent } from "./thread-content";
import { PlanContent } from "./plan-content";
import { TerminalContent } from "./terminal-content";
import { FileContent } from "./file-content";
import { PullRequestContent } from "./pull-request-content";
import { ArchiveView } from "./archive-view";
import { EmptyPaneContent } from "./empty-pane-content";
import { ChangesTab } from "../control-panel/changes-tab";
import { SettingsPage } from "../main-window/settings-page";
import { LogsPage } from "../main-window/logs-page";
import { useContentSearch } from "./use-content-search";
import { InputStoreProvider } from "@/stores/input-store";
import { useSearchState } from "@/stores/search-state";
import { logger } from "@/lib/logger-client";
import type { ContentPaneProps, ContentPaneView } from "./types";

const ChangesView = lazy(() => import("../changes/changes-view"));

export function ContentPane({
  paneId: _paneId,
  view,
  onClose,
  onPopOut,
}: ContentPaneProps) {
  // Note: paneId is available for future use (e.g., per-pane state management)
  void _paneId;

  // Timing: Track when ContentPane first mounts with this view
  const mountTimeRef = useRef<number>(Date.now());
  const viewIdRef = useRef<string>(view.type === "thread" ? view.threadId : view.type);

  // Log on mount
  useEffect(() => {
    if (view.type === "thread") {
      const now = Date.now();
      logger.info(`[ContentPane:TIMING] MOUNTED with thread view`, {
        threadId: view.threadId,
        mountTime: now,
        timestamp: new Date(now).toISOString(),
      });
      mountTimeRef.current = now;
      viewIdRef.current = view.threadId;
    }
  }, [view]);

  // Track thread tab state locally
  const [threadTab, setThreadTab] = useState<"conversation" | "changes">(
    "conversation"
  );

  // Derive streaming state for header
  const isStreaming = useThreadStreamingState(view);

  // Thread data selectors for both ThreadContent and ChangesTab
  const threadId = view.type === "thread" ? view.threadId : null;

  const activeMetadata = useThreadStore(
    useCallback((s) => (threadId ? s.threads[threadId] : undefined), [threadId])
  );
  const activeState = useThreadStore(
    useCallback((s) => (threadId ? s.threadStates[threadId] : undefined), [threadId])
  );
  const isLoadingThreadState = useThreadStore((s) => s.activeThreadLoading);

  // Derive initial prompt from thread metadata
  const initialPrompt = activeMetadata?.turns[0]?.prompt;

  // Find-in-page
  const [findBarOpen, setFindBarOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const search = useContentSearch(contentRef);
  const isSearchable =
    view.type !== "empty" && view.type !== "terminal" && view.type !== "settings" && view.type !== "thread";

  const searchClearRef = useRef(search.clear);
  searchClearRef.current = search.clear;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && isSearchable) {
        e.preventDefault();
        setFindBarOpen((prev) => {
          if (prev) searchClearRef.current();
          return !prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isSearchable]);

  // Auto-open FindBar from global search panel via searchState store
  const { isEnabled: searchEnabled, searchQuery: globalSearchQuery, nonce: searchNonce } = useSearchState();
  useEffect(() => {
    if (searchEnabled && globalSearchQuery && isSearchable) {
      setFindBarOpen(true);
      search.setQuery(globalSearchQuery);
    }
  }, [searchEnabled, globalSearchQuery, searchNonce, isSearchable]);

  const closeFindBar = useCallback(() => {
    search.clear();
    setFindBarOpen(false);
  }, [search]);

  return (
    <div className="flex flex-col h-full bg-surface-900">
      <ContentPaneHeader
        view={view}
        threadTab={threadTab}
        onThreadTabChange={setThreadTab}
        isStreaming={isStreaming}
        onClose={onClose}
        onPopOut={onPopOut}
      />

      <div ref={contentRef} className="flex-1 min-h-0 relative">
        {isSearchable && findBarOpen && (
          <FindBar search={search} onClose={closeFindBar} />
        )}
        <InputStoreProvider active>
          {view.type === "empty" && <EmptyPaneContent />}
          {view.type === "thread" && threadTab === "conversation" && (
            <ThreadContent
              threadId={view.threadId}
              onPopOut={onPopOut}
              autoFocus={view.autoFocus}
              initialPrompt={initialPrompt}
            />
          )}
          {view.type === "thread" && threadTab === "changes" && activeMetadata && (
            <ChangesTab
              threadMetadata={activeMetadata}
              threadState={activeState}
              isLoadingThreadState={isLoadingThreadState}
            />
          )}
          {view.type === "plan" && (
            <PlanContent planId={view.planId} onPopOut={onPopOut} />
          )}
        </InputStoreProvider>
        {view.type === "settings" && <SettingsPage />}
        {view.type === "logs" && <LogsPage />}
        {view.type === "archive" && <ArchiveView />}
        {view.type === "terminal" && (
          <TerminalContent
            key={view.terminalId}
            terminalId={view.terminalId}
            onClose={onClose}
          />
        )}
        {view.type === "file" && (
          <FileContent
            filePath={view.filePath}
            lineNumber={view.lineNumber}
          />
        )}
        {view.type === "pull-request" && (
          <PullRequestContent prId={view.prId} onPopOut={onPopOut} />
        )}
        {view.type === "changes" && (
          <Suspense fallback={<div className="flex items-center justify-center h-full text-surface-400 text-sm">Loading...</div>}>
            <ChangesView
              repoId={view.repoId}
              worktreeId={view.worktreeId}
              uncommittedOnly={view.uncommittedOnly}
              commitHash={view.commitHash}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

/**
 * Helper hook to get streaming state for thread views.
 */
function useThreadStreamingState(view: ContentPaneView): boolean {
  const threadId = view.type === "thread" ? view.threadId : null;
  const status = useThreadStore(
    useCallback(
      (s) => (threadId ? s.threads[threadId]?.status : null),
      [threadId]
    )
  );
  return status === "running";
}

