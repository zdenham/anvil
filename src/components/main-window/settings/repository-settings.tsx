import { useState, useEffect } from "react";
import { Folder, Check, AlertCircle, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { SettingsSection } from "../settings-section";
import { useRepoStore, repoService, type Repository } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { threadService } from "@/entities/threads";
import { appData } from "@/lib/app-data-store";
import { repoCommands } from "@/lib/tauri-commands";

interface RepoStatus {
  worktreeCount: number;
  activeThreads: number;
  pathValid: boolean;
}

export function RepositorySettings() {
  const repositoriesMap = useRepoStore((state) => state.repositories);
  const repositories = Object.values(repositoriesMap);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Status for each repo
  const [repoStatuses, setRepoStatuses] = useState<Record<string, RepoStatus>>({});

  // Load status for all repositories on mount and when repositories change
  useEffect(() => {
    const loadStatuses = async () => {
      const statuses: Record<string, RepoStatus> = {};

      for (const repo of repositories) {
        statuses[repo.name] = await getRepoStatus(repo);
      }

      setRepoStatuses(statuses);
    };

    loadStatuses();
  }, [repositories.length]); // Re-run when repository count changes

  const getRepoStatus = async (repo: Repository): Promise<RepoStatus> => {
    // Get worktree count via sync
    let worktreeCount = 0;
    try {
      const worktrees = await worktreeService.sync(repo.name);
      worktreeCount = worktrees.length;
    } catch {
      // If sync fails, fall back to versions count
      worktreeCount = repo.versions?.length ?? 0;
    }

    // Get active thread count for this repo
    const threads = threadService.getByRepo(repo.name);
    const activeThreads = threads.filter(
      (t) => t.status === "running" || t.status === "idle"
    ).length;

    // Check if source path exists
    let pathValid = true;
    if (repo.sourcePath) {
      pathValid = await appData.absolutePathExists(repo.sourcePath);
    }

    return { worktreeCount, activeThreads, pathValid };
  };

  const handleLocate = async (repoId: string) => {
    setLocateError(null);
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Locate Repository Folder",
    });

    if (selectedPath && typeof selectedPath === "string") {
      // Validate that the selected path is a git repository
      const validation = await repoCommands.validateRepository(selectedPath);
      if (!validation.exists) {
        setLocateError("Selected path does not exist");
        return;
      }
      if (!validation.is_git_repo) {
        setLocateError("This folder is not a git repository. Please select a folder with git tracking.");
        return;
      }

      // Update the repository's source path
      const repo = repositoriesMap[repoId];
      if (repo) {
        // Use update to change the source path
        await repoService.update(repoId, { sourcePath: selectedPath });
        await repoService.hydrate();
      }
    }
  };

  const truncatePath = (path: string, maxLength: number = 40): string => {
    if (path.length <= maxLength) return path;
    const start = path.substring(0, 15);
    const end = path.substring(path.length - 22);
    return `${start}...${end}`;
  };

  return (
    <SettingsSection
      title="Repositories"
      description="Connected code repositories"
    >
      <div className="space-y-2">
        {repositories.map((repo) => {
          const status = repoStatuses[repo.name];

          return (
            <div
              key={repo.name}
              className="flex flex-col gap-2 py-3 px-3 bg-surface-800/50 rounded border border-surface-700/50"
            >
              {/* Top row: name */}
              <div className="flex items-center gap-2">
                <Folder size={16} className="text-surface-400 flex-shrink-0" />
                <span className="font-medium text-surface-200 truncate">{repo.name}</span>
              </div>

              {/* Bottom row: path and status badges */}
              <div className="flex items-center justify-between gap-2 text-xs">
                {/* Path with validity indicator */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {status?.pathValid === false ? (
                    <>
                      <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
                      <span className="text-red-400 truncate" title={repo.sourcePath ?? ""}>
                        {truncatePath(repo.sourcePath ?? "Path missing")}
                      </span>
                      <button
                        onClick={() => handleLocate(repo.name)}
                        className="text-accent-400 hover:text-accent-300 flex items-center gap-1 flex-shrink-0 ml-1"
                        title="Locate folder"
                      >
                        <FolderOpen size={12} />
                        <span>Locate</span>
                      </button>
                    </>
                  ) : status?.pathValid === true ? (
                    <>
                      <Check size={12} className="text-green-400 flex-shrink-0" />
                      <span className="text-surface-500 truncate" title={repo.sourcePath ?? ""}>
                        {truncatePath(repo.sourcePath ?? "")}
                      </span>
                    </>
                  ) : repo.sourcePath ? (
                    <span className="text-surface-500 truncate" title={repo.sourcePath}>
                      {truncatePath(repo.sourcePath)}
                    </span>
                  ) : null}
                </div>

                {/* Status badges */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {status && (
                    <>
                      {status.worktreeCount > 0 && (
                        <span
                          className="px-1.5 py-0.5 bg-surface-700 rounded text-surface-400"
                          title={`${status.worktreeCount} worktree${status.worktreeCount !== 1 ? "s" : ""}`}
                        >
                          {status.worktreeCount} worktree{status.worktreeCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {status.activeThreads > 0 && (
                        <span
                          className="px-1.5 py-0.5 bg-accent-900/30 text-accent-400 rounded"
                          title={`${status.activeThreads} active thread${status.activeThreads !== 1 ? "s" : ""}`}
                        >
                          {status.activeThreads} active
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {repositories.length === 0 && (
          <p className="text-sm text-surface-500 py-2">No repositories connected. Use the + button in the side panel to add one.</p>
        )}
        {locateError && (
          <div className="py-2 px-3 bg-red-900/20 border border-red-800 rounded text-red-400 text-sm">
            {locateError}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
