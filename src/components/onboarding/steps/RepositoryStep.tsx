import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderGit2, Plus } from "lucide-react";
import { Button } from "../../reusable/Button";
import { repoService } from "@/entities/repositories";
import { createNewProject } from "@/lib/project-creation-service";

interface RepositoryStepProps {
  selectedRepository: string | null;
  onRepositorySelected: (path: string | null) => void;
  existingRepoName?: string | null;
  onClear?: () => void;
}

export const RepositoryStep = ({
  selectedRepository,
  onRepositorySelected,
  existingRepoName,
  onClear,
}: RepositoryStepProps) => {
  const [isSelecting, setIsSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBrowse = async () => {
    setIsSelecting(true);
    setError(null);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select a project folder",
      });

      if (!selectedPath) return;

      const validation = await repoService.validateNewRepository(selectedPath);
      if (!validation.valid) {
        setError(validation.error ?? "Invalid project folder");
        return;
      }

      onRepositorySelected(selectedPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select project");
    } finally {
      setIsSelecting(false);
    }
  };

  const handleCreate = async () => {
    setIsSelecting(true);
    setError(null);

    try {
      const projectPath = await createNewProject();
      if (projectPath) {
        onRepositorySelected(projectPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setIsSelecting(false);
    }
  };

  return (
    <div data-testid="onboarding-step-repository" className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-surface-100 font-mono">Select Your Project</h2>
        <p className="text-surface-300">
          anvil will write code to this directory
        </p>
      </div>

      <div className="space-y-4">
        <div className="border-2 border-dashed border-surface-600 rounded-lg p-6">
          {selectedRepository ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-sm text-surface-400">
                  {existingRepoName ? "Existing Project:" : "Selected Project:"}
                </div>
                {existingRepoName && (
                  <span className="text-xs bg-accent-500/20 text-accent-400 px-2 py-0.5 rounded">
                    Already configured
                  </span>
                )}
              </div>
              <div className="font-mono text-sm bg-surface-700 text-surface-100 px-3 py-2 rounded border">
                {selectedRepository}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={handleBrowse} disabled={isSelecting}>
                  {isSelecting ? "Selecting..." : "Change"}
                </Button>
                {onClear && (
                  <Button variant="ghost" onClick={onClear}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleBrowse}
                disabled={isSelecting}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border border-surface-600 hover:border-surface-400 hover:bg-surface-800/50 transition-colors text-center disabled:opacity-50"
              >
                <FolderGit2 size={20} className="text-surface-300" />
                <span className="text-sm font-medium text-surface-200">Import existing</span>
                <span className="text-xs text-surface-400">Open a git repository</span>
              </button>
              <button
                onClick={handleCreate}
                disabled={isSelecting}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border border-surface-600 hover:border-surface-400 hover:bg-surface-800/50 transition-colors text-center disabled:opacity-50"
              >
                <Plus size={20} className="text-surface-300" />
                <span className="text-sm font-medium text-surface-200">Create new project</span>
                <span className="text-xs text-surface-400">Start from scratch</span>
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};