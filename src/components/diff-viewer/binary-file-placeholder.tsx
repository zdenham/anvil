import { FileQuestion } from "lucide-react";
import type { ParsedDiffFile } from "./types";

interface BinaryFilePlaceholderProps {
  /** The parsed file metadata */
  file: ParsedDiffFile;
}

/**
 * Placeholder for binary files that can't be diffed.
 */
export function BinaryFilePlaceholder({ file }: BinaryFilePlaceholderProps) {
  const path = file.newPath ?? file.oldPath ?? "Unknown file";

  return (
    <div
      className="flex flex-col items-center justify-center py-8 text-surface-400 bg-surface-900/50"
      role="status"
    >
      <FileQuestion className="w-10 h-10 mb-3 opacity-50" aria-hidden="true" />
      <p className="text-sm">Binary file changed</p>
      <p className="text-xs text-surface-500 mt-1 font-mono">{path}</p>
    </div>
  );
}
