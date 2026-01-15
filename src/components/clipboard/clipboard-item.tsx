import { cn } from "../../lib/utils";
import { ClipboardEntryPreview } from "./types";

interface ClipboardItemProps {
  entry: ClipboardEntryPreview;
  isSelected: boolean;
  onSelect: () => void;
  onActivate: () => void;
}

export const ClipboardItem = ({
  entry,
  isSelected,
  onSelect,
  onActivate,
}: ClipboardItemProps) => {
  const timeAgo = formatTimeAgo(entry.timestamp);
  // Truncate preview for display (backend sends ~200 chars, we show ~60)
  const displayPreview = truncatePreview(entry.preview);

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 h-8 cursor-pointer transition-all duration-100 shrink-0",
        isSelected
          ? "bg-surface-700 text-surface-100"
          : "text-surface-300 hover:bg-surface-700/50"
      )}
      onMouseMove={(e) => {
        // Only select on actual mouse movement, not synthetic events from window resize
        const hasActualMovement = e.movementX !== 0 || e.movementY !== 0;
        if (hasActualMovement && !isSelected) {
          onSelect();
        }
      }}
      onClick={onActivate}
    >
      <span className="flex-1 text-sm truncate font-mono">{displayPreview}</span>
      <span
        className={cn(
          "text-xs shrink-0",
          isSelected ? "text-white/60" : "text-surface-500"
        )}
      >
        {timeAgo}
      </span>
    </div>
  );
};

function truncatePreview(preview: string): string {
  return preview.length > 60 ? preview.slice(0, 60) + "…" : preview;
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
