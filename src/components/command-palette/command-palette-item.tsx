import type { PreviewableItem } from "@/lib/preview-content";
import { getFileIconUrl } from "@/components/file-browser/file-icons";
import { cn } from "@/lib/utils";

interface CommandPaletteItemProps {
  item: PreviewableItem;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
}

function getTypeLabel(type: PreviewableItem["type"]): string {
  if (type === "thread") return "Thread";
  if (type === "file") return "File";
  return "Plan";
}

function ItemIcon({ item }: { item: PreviewableItem }) {
  if (item.type === "thread") {
    return (
      <img
        src="/material-icons/folder-messages.svg"
        className="w-3.5 h-3.5 flex-shrink-0"
      />
    );
  }

  if (item.type === "file") {
    const filename = item.name.split("/").pop() || item.name;
    return (
      <img
        src={getFileIconUrl(filename)}
        className="w-3.5 h-3.5 flex-shrink-0"
      />
    );
  }

  return (
    <img
      src="/material-icons/todo.svg"
      className="w-3.5 h-3.5 flex-shrink-0"
    />
  );
}

export function CommandPaletteItem({
  item,
  index,
  isSelected,
  onClick,
  onHover,
}: CommandPaletteItemProps) {
  return (
    <div
      data-testid={`command-palette-item-${index}`}
      data-selected={isSelected}
      className={cn(
        "px-3 py-1.5 cursor-pointer flex items-center gap-2",
        isSelected && "bg-surface-700"
      )}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      <ItemIcon item={item} />

      <div className="flex-1 min-w-0 text-sm text-surface-200 truncate">
        {item.name}
      </div>

      <div className="text-xs text-surface-500 flex-shrink-0">
        {getTypeLabel(item.type)}
      </div>
    </div>
  );
}
