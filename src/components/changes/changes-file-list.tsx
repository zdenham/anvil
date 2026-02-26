/**
 * ChangesFileList — Sidebar panel listing all changed files in the diff.
 *
 * Shows file icons, operation badges, and +/- stats. Clicking a file
 * triggers scroll-to in the main diff area via the changes view store.
 */

import type { ParsedDiffFile } from "@/lib/diff-parser";
import { getFileIconUrl } from "@/components/file-browser/file-icons";
import { useChangesViewStore } from "@/stores/changes-view-store";
import { cn } from "@/lib/utils";

interface ChangesFileListProps {
  files: ParsedDiffFile[];
  onSelectFile: (filePath: string) => void;
}

const OPERATION_COLORS: Record<ParsedDiffFile["type"], string> = {
  added: "text-green-400",
  modified: "text-blue-400",
  deleted: "text-red-400",
  renamed: "text-yellow-400",
  binary: "text-surface-400",
};

const OPERATION_LABELS: Record<ParsedDiffFile["type"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  binary: "B",
};

function getFilePath(file: ParsedDiffFile): string {
  return file.newPath ?? file.oldPath ?? "";
}

function getFileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function getDirectoryPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

export function ChangesFileList({ files, onSelectFile }: ChangesFileListProps) {
  const selectedFilePath = useChangesViewStore((s) => s.selectedFilePath);

  return (
    <div className="w-64 flex-shrink-0 bg-surface-900 border-l border-surface-700 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-surface-700 flex-shrink-0">
        <span className="text-xs font-medium text-surface-300">
          Files changed
        </span>
        <span className="text-xs text-surface-500 ml-1.5">
          {files.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {files.map((file) => {
          const filePath = getFilePath(file);
          return (
            <FileRow
              key={filePath}
              file={file}
              filePath={filePath}
              isActive={selectedFilePath === filePath}
              onSelect={onSelectFile}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface FileRowProps {
  file: ParsedDiffFile;
  filePath: string;
  isActive: boolean;
  onSelect: (filePath: string) => void;
}

function FileRow({ file, filePath, isActive, onSelect }: FileRowProps) {
  const fileName = getFileName(filePath);
  const dirPath = getDirectoryPath(filePath);
  const iconUrl = getFileIconUrl(fileName);

  return (
    <button
      type="button"
      className={cn(
        "w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-surface-800 transition-colors",
        isActive && "bg-surface-800",
      )}
      onClick={() => onSelect(filePath)}
      title={filePath}
    >
      <img src={iconUrl} alt="" className="w-4 h-4 flex-shrink-0" />

      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-xs text-surface-200 truncate">
          {fileName}
        </span>
        {dirPath && (
          <span className="text-xs text-surface-500 truncate flex-shrink">
            {dirPath}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <FileStats additions={file.stats.additions} deletions={file.stats.deletions} />
        <span className={cn("text-[10px] font-medium", OPERATION_COLORS[file.type])}>
          {OPERATION_LABELS[file.type]}
        </span>
      </div>
    </button>
  );
}

function FileStats({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;

  return (
    <span className="text-[10px] text-surface-500">
      {additions > 0 && <span className="text-green-400">+{additions}</span>}
      {additions > 0 && deletions > 0 && " "}
      {deletions > 0 && <span className="text-red-400">-{deletions}</span>}
    </span>
  );
}
