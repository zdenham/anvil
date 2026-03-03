import { EventList } from "@/components/debug-panel/event-list";
import { EventDetail } from "@/components/debug-panel/event-detail";

/**
 * Event Debugger — two-panel layout for inspecting agent events.
 *
 * Left panel (60%): Scrollable event list with filters and capture controls.
 * Right panel (40%): Selected event detail with payload inspection and disk state reader.
 */
export function EventDebugger() {
  return (
    <div className="flex h-full min-h-0">
      {/* Left panel — Event list */}
      <div className="w-[60%] h-full border-r border-surface-700 min-h-0">
        <EventList />
      </div>

      {/* Right panel — Event detail */}
      <div className="w-[40%] h-full min-h-0">
        <EventDetail />
      </div>
    </div>
  );
}
