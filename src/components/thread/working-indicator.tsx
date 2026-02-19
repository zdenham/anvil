import { cn } from "@/lib/utils";
import { useHeartbeatStore, type HeartbeatStatus } from "@/stores/heartbeat-store";

interface WorkingIndicatorProps {
  className?: string;
  /** Thread ID — when provided, shows heartbeat health status */
  threadId?: string;
}

/** Maps heartbeat status to Tailwind color classes */
const HEARTBEAT_DOT_CLASSES: Record<HeartbeatStatus, string> = {
  healthy: "bg-green-500",
  degraded: "bg-amber-400 animate-pulse",
  stale: "bg-red-500 animate-pulse",
};

/** Maps heartbeat status to human-readable labels */
const HEARTBEAT_LABELS: Record<HeartbeatStatus, string> = {
  healthy: "Heartbeat healthy",
  degraded: "Heartbeat degraded — missed heartbeats",
  stale: "Heartbeat stale — recovering from disk",
};

/**
 * Pulsing green dot with "Working" text, shown while
 * the assistant is processing but hasn't started streaming content.
 *
 * When threadId is provided, also shows a heartbeat health indicator
 * dot (green/yellow/red) with a tooltip showing diagnostic details.
 *
 * Inspired by Claude Code's terminal status indicator.
 */
export function WorkingIndicator({ className, threadId }: WorkingIndicatorProps) {
  const heartbeat = useHeartbeatStore(
    (s) => (threadId ? s.heartbeats[threadId] : undefined)
  );

  const tooltipText = heartbeat
    ? `${HEARTBEAT_LABELS[heartbeat.status]} | Last: ${new Date(heartbeat.lastReceivedAt).toLocaleTimeString()} | Seq: ${heartbeat.lastSeq} | Missed: ${heartbeat.missedCount}`
    : undefined;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-3",
        className
      )}
      role="status"
      aria-label="Assistant is working"
    >
      <span
        className="working-dot"
        aria-hidden="true"
      />
      <span className="text-sm text-surface-400">Working</span>

      {/* Heartbeat health indicator */}
      {heartbeat && (
        <span
          className={cn(
            "inline-block w-2 h-2 rounded-full ml-1",
            HEARTBEAT_DOT_CLASSES[heartbeat.status]
          )}
          title={tooltipText}
          aria-label={HEARTBEAT_LABELS[heartbeat.status]}
        />
      )}

      <span className="sr-only">Assistant is working on your request</span>
    </div>
  );
}
