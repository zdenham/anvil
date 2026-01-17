/**
 * TaskLegend - A small legend explaining the color dots used in task lists.
 *
 * Color meanings (from task-colors.ts):
 * - Green pulsing: Agent is currently running
 * - Blue: Has unread thread activity
 * - Grey: All threads read, no activity
 */
export function TaskLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-surface-500">
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span>Running</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <span>Unread</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-zinc-400" />
        <span>Read</span>
      </div>
    </div>
  );
}
