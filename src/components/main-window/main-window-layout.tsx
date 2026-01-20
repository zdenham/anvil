import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./sidebar";
import { TasksPage } from "./tasks-page";
import { WorktreesPage } from "./worktrees-page";
import { LogsPage } from "./logs-page";
import { SettingsPage } from "./settings-page";
import { BuildModeIndicator } from "../ui/BuildModeIndicator";

export type TabId = "tasks" | "worktrees" | "logs" | "settings";

const VALID_TABS: TabId[] = ["tasks", "worktrees", "logs", "settings"];

export function MainWindowLayout() {
  const [activeTab, setActiveTab] = useState<TabId>("tasks");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
    <div className="flex h-full bg-surface-900">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      <main className="flex-1 overflow-hidden">
        {activeTab === "tasks" && <TasksPage onCloseSidebar={handleToggleSidebar} />}
        {activeTab === "worktrees" && <WorktreesPage />}
        {activeTab === "logs" && <LogsPage />}
        {activeTab === "settings" && <SettingsPage />}
      </main>
      <BuildModeIndicator />
    </div>
  );
}
