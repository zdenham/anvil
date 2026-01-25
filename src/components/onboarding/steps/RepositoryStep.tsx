import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../../reusable/Button";
import { repoService } from "@/entities/repositories";

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
        title: "Select a repository folder",
      });

      if (!selectedPath) {
        // User cancelled the dialog
        return;
      }

      // Validate that it's a git repository
      const validation = await repoService.validateNewRepository(selectedPath);
      if (!validation.valid) {
        setError(validation.error ?? "Invalid repository");
        return;
      }

      onRepositorySelected(selectedPath);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to select repository"
      );
    } finally {
      setIsSelecting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-surface-100 font-mono">Select Your Repository</h2>
        <p className="text-surface-300">
          mort will write code to this directory
        </p>
      </div>

      <div className="space-y-4">
        <div className="border-2 border-dashed border-surface-600 rounded-lg p-6">
          {selectedRepository ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-sm text-surface-400">
                  {existingRepoName ? "Existing Repository:" : "Selected Repository:"}
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
            <div className="space-y-3">
              <div className="text-surface-400">No repository selected</div>
              <Button variant="light" onClick={handleBrowse} disabled={isSelecting}>
                {isSelecting ? "Selecting..." : "Browse for Repository"}
              </Button>
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