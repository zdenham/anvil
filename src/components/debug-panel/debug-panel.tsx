import { useCallback } from "react";
import { X, ScrollText, Activity, Radio } from "lucide-react";
import { useDebugPanelStore, debugPanelService, type DebugPanelTab } from "@/stores/debug-panel";
import { LogsPage } from "@/components/main-window/logs-page";
import { FpsSection } from "@/components/diagnostics/fps-section";
import { EventDebugger } from "@/components/debug-panel/event-debugger";
import { cn } from "@/lib/utils";

const TABS: { id: DebugPanelTab; label: string; icon: typeof ScrollText }[] = [
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "diagnostics", label: "Frame Rate", icon: Activity },
  { id: "events", label: "Events", icon: Radio },
];

export function DebugPanel() {
  const activeTab = useDebugPanelStore((s) => s.activeTab);

  const handleTabClick = useCallback((tab: DebugPanelTab) => {
    debugPanelService.setActiveTab(tab);
  }, []);

  const handleClose = useCallback(() => {
    debugPanelService.close();
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-900 border-t border-surface-700">
      {/* Tab bar */}
      <div className="flex items-center gap-0 px-2 h-8 flex-shrink-0 bg-surface-950 border-b border-surface-800">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-full text-xs transition-colors",
                isActive
                  ? "text-surface-100 border-b border-accent-500"
                  : "text-surface-400 hover:text-surface-200"
              )}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}

        <div className="flex-1" />

        <button
          onClick={handleClose}
          className="p-1 text-surface-400 hover:text-surface-200 transition-colors"
          title="Close debug panel (Cmd+Shift+D)"
        >
          <X size={12} />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === "logs" && <LogsPage />}
        {activeTab === "diagnostics" && (
          <div className="p-4">
            <FpsSection />
          </div>
        )}
        {activeTab === "events" && <EventDebugger />}
      </div>
    </div>
  );
}
