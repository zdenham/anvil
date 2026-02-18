import { StatusDot } from "./status-dot";

/**
 * StatusLegend - A small legend explaining the color dots used in inbox lists.
 *
 * Color meanings:
 * - Green pulsing: Agent is currently running
 * - Blue: Has unread thread activity
 * - Grey: All threads read, no activity
 */
export function StatusLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-surface-500 overflow-hidden">
      <div className="flex items-center gap-1.5">
        <StatusDot variant="running" />
        <span>Running</span>
      </div>
      <div className="flex items-center gap-1.5">
        <StatusDot variant="needs-input" />
        <span className="whitespace-nowrap">Needs Input</span>
      </div>
      <div className="flex items-center gap-1.5">
        <StatusDot variant="unread" />
        <span>Unread</span>
      </div>
      <div className="flex items-center gap-1.5">
        <StatusDot variant="read" />
        <span>Read</span>
      </div>
    </div>
  );
}
