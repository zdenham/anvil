import { useState } from "react";
import { Sidebar } from "./sidebar";
import { TasksPage } from "./tasks-page";
import { LogsPage } from "./logs-page";
import { SettingsPage } from "./settings-page";
import { BuildModeIndicator } from "../ui/BuildModeIndicator";

export type TabId = "tasks" | "logs" | "settings";

export function MainWindowLayout() {
  const [activeTab, setActiveTab] = useState<TabId>("tasks");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
        {activeTab === "logs" && <LogsPage />}
        {activeTab === "settings" && <SettingsPage />}
      </main>
      <BuildModeIndicator />
    </div>
  );
}
