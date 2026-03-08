/**
 * CancelledBanner — shown after the last message when a thread was cancelled.
 * Simple centered divider with muted "Cancelled" text.
 */
export function CancelledBanner() {
  return (
    <div
      className="flex items-center gap-3 px-6 py-3 text-surface-500 select-none"
      role="status"
      aria-label="Agent was cancelled"
    >
      <div className="flex-1 h-px bg-surface-700" />
      <span className="text-xs font-medium tracking-wide uppercase">Cancelled</span>
      <div className="flex-1 h-px bg-surface-700" />
    </div>
  );
}
