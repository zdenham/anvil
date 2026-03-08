import { StatusLegend } from './status-legend';
import { QuickActionsPanel } from '@/components/quick-actions/quick-actions-panel';

/**
 * BottomGutter - Thin full-width bar at the bottom of the main window.
 *
 * Left side: StatusLegend (running/needs-input/unread/read dots)
 * Right side: QuickActionsPanel (muted action buttons with hotkey hints)
 *
 * Mirrors the titlebar's dashed border style for visual consistency.
 */
export function BottomGutter() {
  return (
    <div className="flex items-center justify-between px-3 py-1 border-t border-dashed border-surface-600/40 bg-surface-900">
      <StatusLegend />
      <QuickActionsPanel />
    </div>
  );
}
