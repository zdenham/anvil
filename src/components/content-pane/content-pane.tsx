/**
 * ContentPane
 *
 * Main wrapper component for content panes. Renders:
 * - ContentPaneHeader (based on view type)
 * - View-specific content (thread, plan, settings, logs, empty)
 *
 * Each pane has a UUID and manages its own state independently.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { ContentPaneHeader } from "./content-pane-header";
import { ThreadContent } from "./thread-content";
import { PlanContent } from "./plan-content";
import { TerminalContent } from "./terminal-content";
import { EmptyPaneContent } from "./empty-pane-content";
import { SettingsPage } from "../main-window/settings-page";
import { LogsPage } from "../main-window/logs-page";
import { logger } from "@/lib/logger-client";
import type { ContentPaneProps, ContentPaneView } from "./types";

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

  // Get initial prompt from optimistic thread metadata for immediate display
  const initialPrompt = useThreadStore(
    useCallback(
      (s) => {
        if (view.type === "thread") {
          const prompt = s.threads[view.threadId]?.turns[0]?.prompt;
          const now = Date.now();
          const elapsed = now - mountTimeRef.current;
          logger.info(`[ContentPane:TIMING] useThreadStore selector ran for initialPrompt`, {
            threadId: view.threadId,
            hasPrompt: !!prompt,
            promptLength: prompt?.length ?? 0,
            elapsedSinceMount: elapsed,
            timestamp: new Date(now).toISOString(),
          });
          return prompt;
        }
        return undefined;
      },
      [view]
    )
  );

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

      <div className="flex-1 min-h-0">
        {view.type === "empty" && <EmptyPaneContent />}
        {view.type === "thread" && (() => {
          const now = Date.now();
          logger.info(`[ContentPane:TIMING] About to render ThreadContent`, {
            threadId: view.threadId,
            hasInitialPrompt: !!initialPrompt,
            promptLength: initialPrompt?.length ?? 0,
            elapsedSinceMount: now - mountTimeRef.current,
            timestamp: new Date(now).toISOString(),
          });
          return (
            <ThreadContent
              threadId={view.threadId}
              onPopOut={onPopOut}
              autoFocus={view.autoFocus}
              initialPrompt={initialPrompt}
            />
          );
        })()}
        {view.type === "plan" && (
          <PlanContent planId={view.planId} onPopOut={onPopOut} />
        )}
        {view.type === "settings" && <SettingsPage />}
        {view.type === "logs" && <LogsPage />}
        {view.type === "terminal" && (
          <TerminalContent
            terminalId={view.terminalId}
            onClose={onClose}
          />
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

