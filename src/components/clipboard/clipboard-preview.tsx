import { ClipboardEntryPreview } from "./types";

interface ClipboardPreviewProps {
  entry: ClipboardEntryPreview | null;
  content: string | null;
}

export const ClipboardPreview = ({ entry, content }: ClipboardPreviewProps) => {
  if (!entry) {
    return (
      <div className="flex items-center justify-center h-full text-surface-500 text-sm">
        Select an item to preview
      </div>
    );
  }

  const formattedDate = new Date(entry.timestamp * 1000).toLocaleString();
  const displayContent = content ?? entry.preview;
  const charCount = content?.length ?? entry.content_size;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-surface-700/50 shrink-0">
        <span className="text-xs text-surface-500">{formattedDate}</span>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <pre className="text-sm text-surface-200 whitespace-pre-wrap break-words font-mono leading-relaxed">
          {displayContent}
        </pre>
      </div>
      <div className="px-4 py-2 border-t border-surface-700/50 shrink-0">
        <div className="flex items-center justify-between text-xs text-surface-500">
          <span>{charCount.toLocaleString()} characters</span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-surface-700 font-medium">
              ↵
            </kbd>
            <span>to paste</span>
          </span>
        </div>
      </div>
    </div>
  );
};
