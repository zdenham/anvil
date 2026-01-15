import { ClipboardEntryPreview } from "./types";
import { ClipboardItem } from "./clipboard-item";
import { useEffect, useRef } from "react";

interface ClipboardListProps {
  entries: ClipboardEntryPreview[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onActivate: (entry: ClipboardEntryPreview) => void;
}

export const ClipboardList = ({
  entries,
  selectedIndex,
  onSelectIndex,
  onActivate,
}: ClipboardListProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      selectedRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex]);

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-surface-500 text-sm">
        No clipboard history
      </div>
    );
  }

  return (
    <div ref={listRef} className="flex flex-col overflow-y-auto h-full">
      {entries.map((entry, index) => (
        <div
          key={`${entry.id}-${index}`}
          ref={index === selectedIndex ? selectedRef : null}
        >
          <ClipboardItem
            entry={entry}
            isSelected={index === selectedIndex}
            onSelect={() => onSelectIndex(index)}
            onActivate={() => onActivate(entry)}
          />
        </div>
      ))}
    </div>
  );
};
