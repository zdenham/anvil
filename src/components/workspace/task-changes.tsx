import { DiffViewer } from "@/components/diff-viewer/diff-viewer";
import { DiffViewerSkeleton } from "@/components/diff-viewer/diff-viewer-skeleton";
import { DiffEmptyState } from "@/components/diff-viewer/diff-empty-state";
import type { FileChange } from "@/lib/types/agent-messages";

interface TaskChangesProps {
  fileChanges: Map<string, FileChange>;
  fullFileContents: Record<string, string[]>;
  workingDirectory: string;
  filesLoading?: boolean;
}

export function TaskChanges({
  fileChanges,
  fullFileContents,
  workingDirectory,
  filesLoading = false,
}: TaskChangesProps) {
  return (
    <div className="overflow-auto h-full p-4">
      <h3 className="text-sm font-medium text-surface-400 mb-4">
        Changes {fileChanges.size > 0 && `(${fileChanges.size} file${fileChanges.size !== 1 ? 's' : ''})`}
      </h3>
      {filesLoading ? (
        <DiffViewerSkeleton />
      ) : fileChanges.size === 0 ? (
        <DiffEmptyState />
      ) : (
        <DiffViewer
          fileChanges={fileChanges}
          fullFileContents={fullFileContents}
          workingDirectory={workingDirectory}
        />
      )}
    </div>
  );
}
