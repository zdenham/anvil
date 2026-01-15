import { useMemo } from "react";
import { TaskOverview } from "./task-overview";
import { TaskChanges } from "./task-changes";
import { GitCommitsList } from "./git-commits-list";
import type { WorkspaceTab } from "./left-menu";
import type { FileChange } from "@/lib/types/agent-messages";

interface MainContentPaneProps {
  tab: WorkspaceTab;
  taskId: string;
  fileChanges: Map<string, FileChange>;
  fullFileContents: Record<string, string[] | null>;
  workingDirectory: string;
  filesLoading?: boolean;
  branchName?: string | null;
}

/**
 * Main content pane that renders content based on active tab.
 * - Overview: Task markdown content
 * - Changes: File changes/diff viewer
 * - Git: Git history and operations
 */
export function MainContentPane({
  tab,
  taskId,
  fileChanges,
  fullFileContents,
  workingDirectory,
  filesLoading,
  branchName,
}: MainContentPaneProps) {
  // Filter out null values from fullFileContents for DiffViewer
  const validFileContents = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const [path, lines] of Object.entries(fullFileContents)) {
      if (lines !== null) {
        result[path] = lines;
      }
    }
    return result;
  }, [fullFileContents]);

  // Add left padding when sidebar is collapsed to account for the collapse button
  const contentClass = "flex-1 min-h-0 overflow-hidden";

  switch (tab) {
    case "overview":
      return (
        <div className={contentClass}>
          <TaskOverview taskId={taskId} />
        </div>
      );

    case "changes":
      return (
        <div className={contentClass}>
          <TaskChanges
            fileChanges={fileChanges}
            fullFileContents={validFileContents}
            workingDirectory={workingDirectory}
            filesLoading={filesLoading}
          />
        </div>
      );

    case "git":
      return (
        <div className={contentClass}>
          <GitCommitsList
            branchName={branchName}
            workingDirectory={workingDirectory}
          />
        </div>
      );

    default:
      return null;
  }
}
