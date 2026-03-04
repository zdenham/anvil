import { NetworkRequestList } from "./network-request-list";
import { NetworkRequestDetail } from "./network-request-detail";

/**
 * Network Debugger -- two-panel layout for inspecting agent HTTP requests.
 *
 * Left panel (60%): Scrollable request list with filters and capture controls.
 * Right panel (40%): Selected request detail with headers, body, and timing.
 */
export function NetworkDebugger() {
  return (
    <div data-testid="network-debugger" className="flex h-full min-h-0">
      {/* Left panel -- Request list */}
      <div className="w-[60%] h-full border-r border-surface-700 min-h-0">
        <NetworkRequestList />
      </div>

      {/* Right panel -- Request detail */}
      <div className="w-[40%] h-full min-h-0">
        <NetworkRequestDetail />
      </div>
    </div>
  );
}
