/**
 * Format timestamp as relative time ("2m ago", "1h ago").
 */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.floor((now - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Format timestamp as ISO string for datetime attribute.
 */
export function formatIsoTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Format timestamp as absolute time for tooltips.
 */
export function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Format duration in milliseconds as human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
