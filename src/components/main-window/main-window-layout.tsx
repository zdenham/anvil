import { useState, useEffect, useMemo, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./sidebar";
import { WorktreesPage } from "./worktrees-page";
import { LogsPage } from "./logs-page";
import { SettingsPage } from "./settings-page";
import { BuildModeIndicator } from "../ui/BuildModeIndicator";
import { UnifiedInbox, InboxHeader } from "../inbox";
import { StatusLegend } from "@/components/ui/status-legend";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useThreadLastMessages } from "@/hooks/use-thread-last-messages";
import { threadService } from "@/entities/threads/service";
import { planService } from "@/entities/plans/service";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import { logger } from "@/lib/logger-client";
import { showControlPanelWithView } from "@/lib/hotkey-service";

export type TabId = "inbox" | "worktrees" | "logs" | "settings";

const VALID_TABS: TabId[] = ["inbox", "worktrees", "logs", "settings"];

export function MainWindowLayout() {
  const [activeTab, setActiveTab] = useState<TabId>("inbox");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get threads and plans from stores
  const threadsMap = useThreadStore((s) => s.threads);
  const plansMap = usePlanStore((s) => s.plans);

  // Convert to arrays
  const threads = useMemo(() => Object.values(threadsMap), [threadsMap]);
  const plans = useMemo(() => Object.values(plansMap), [plansMap]);

  // Get last messages for threads
  const threadLastMessages = useThreadLastMessages(threads);

  // Filter threads based on search query
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;

    const query = searchQuery.toLowerCase();
    return threads.filter((t) =>
      t.id.toLowerCase().includes(query) ||
      threadLastMessages[t.id]?.toLowerCase().includes(query)
    );
  }, [threads, searchQuery, threadLastMessages]);

  // Filter plans based on search query
  const filteredPlans = useMemo(() => {
    if (!searchQuery.trim()) return plans;

    const query = searchQuery.toLowerCase();
    return plans.filter((p) =>
      p.id.toLowerCase().includes(query) ||
      p.relativePath?.toLowerCase().includes(query)
    );
  }, [plans, searchQuery]);

  // Handle refresh - reload data from disk
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        threadService.hydrate(),
        planService.hydrate(),
      ]);
      logger.info("[MainWindowLayout] Refreshed threads and plans from disk");
    } catch (error) {
      logger.error("[MainWindowLayout] Failed to refresh:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Handle thread selection - open control panel with thread view
  const handleThreadSelect = useCallback(async (thread: ThreadMetadata) => {
    logger.info("[MainWindowLayout] Thread selected:", thread.id);

    // Route through Rust to ensure event reaches control panel window
    await showControlPanelWithView({ type: "thread", threadId: thread.id });
  }, []);

  // Handle plan selection - open control panel with plan view
  const handlePlanSelect = useCallback(async (plan: PlanMetadata) => {
    logger.info("[MainWindowLayout] Plan selected:", plan.id);

    // Route through Rust to ensure event reaches control panel window
    await showControlPanelWithView({ type: "plan", planId: plan.id });
  }, []);

  // Listen for navigation events from the native macOS menu
  useEffect(() => {
    const unlisten = listen<string>("navigate", (event) => {
      const tab = event.payload as TabId;
      if (VALID_TABS.includes(tab)) {
        setActiveTab(tab);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="flex h-full bg-surface-900">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      <main className="flex-1 overflow-hidden">
        {activeTab === "inbox" && (
          <div className="flex flex-col h-full">
            <InboxHeader
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
              onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            />
            <div className="flex-1 overflow-auto">
              <UnifiedInbox
                threads={filteredThreads}
                plans={filteredPlans}
                threadLastMessages={threadLastMessages}
                onThreadSelect={handleThreadSelect}
                onPlanSelect={handlePlanSelect}
              />
            </div>
            <footer className="px-4 py-2 border-t border-surface-700/50">
              <StatusLegend />
            </footer>
          </div>
        )}
        {activeTab === "worktrees" && <WorktreesPage />}
        {activeTab === "logs" && <LogsPage />}
        {activeTab === "settings" && <SettingsPage />}
      </main>
      <BuildModeIndicator />
    </div>
  );
}
