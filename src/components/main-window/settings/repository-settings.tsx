import { useState, useEffect } from "react";
import { Folder, Check, AlertCircle, FolderOpen, Terminal } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { SettingsSection } from "../settings-section";
import { useRepoStore, repoService, type Repository } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { threadService } from "@/entities/threads";
import { appData, loadSettings, saveSettings } from "@/lib/app-data-store";
import { repoCommands } from "@/lib/tauri-commands";
import { logger } from "@/lib/logger-client";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

interface RepoStatus {
  worktreeCount: number;
  activeThreads: number;
  pathValid: boolean;
}

export function RepositorySettings() {
  const repositoriesMap = useRepoStore((state) => state.repositories);
  const repositories = Object.values(repositoriesMap);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Setup prompt editing state
  const [editingSetupPrompt, setEditingSetupPrompt] = useState<string | null>(null);
  const [setupPromptValue, setSetupPromptValue] = useState("");

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
      title: "Locate Project Folder",
    });

    if (selectedPath && typeof selectedPath === "string") {
      // Validate that the selected path is a git repository
      const validation = await repoCommands.validateRepository(selectedPath);
      if (!validation.exists) {
        setLocateError("Selected path does not exist");
        return;
      }
      if (!validation.is_git_repo) {
        setLocateError("This folder is not a git repository. Please select a git-tracked project folder.");
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

  const handleToggleSetupPrompt = async (repoName: string) => {
    if (editingSetupPrompt === repoName) {
      setEditingSetupPrompt(null);
      return;
    }

    try {
      const slug = slugify(repoName);
      const settings = await loadSettings(slug);
      setSetupPromptValue(settings.worktreeSetupPrompt ?? "");
      setEditingSetupPrompt(repoName);
    } catch (err) {
      logger.error(`[RepositorySettings] Failed to load setup prompt for ${repoName}:`, err);
    }
  };

  const handleSaveSetupPrompt = async (repoName: string) => {
    try {
      const slug = slugify(repoName);
      const settings = await loadSettings(slug);
      const trimmed = setupPromptValue.trim();
      settings.worktreeSetupPrompt = trimmed.length > 0 ? trimmed : null;
      await saveSettings(slug, settings);
      logger.debug(`[RepositorySettings] Saved setup prompt for ${repoName}`);
    } catch (err) {
      logger.error(`[RepositorySettings] Failed to save setup prompt for ${repoName}:`, err);
    }
  };

  return (
    <SettingsSection
      title="Projects"
      description="Connected code projects"
    >
      <div data-testid="repository-settings" className="space-y-2">
        {repositories.map((repo) => {
          const status = repoStatuses[repo.name];

          return (
            <div
              key={repo.name}
              data-testid={`repo-item-${repo.sourcePath ?? repo.name}`}
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

                {/* Status badges and setup button */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {status && (
                    <>
                      {status.worktreeCount > 0 && (
                        <span
                          className="px-1.5 py-0.5 bg-surface-700 rounded text-surface-400"
                          title={`${status.worktreeCount} workspace${status.worktreeCount !== 1 ? "s" : ""}`}
                        >
                          {status.worktreeCount} workspace{status.worktreeCount !== 1 ? "s" : ""}
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
                  <button
                    onClick={() => handleToggleSetupPrompt(repo.name)}
                    className="text-surface-400 hover:text-surface-200 flex items-center gap-1 flex-shrink-0"
                    title="Configure workspace setup prompt"
                  >
                    <Terminal size={12} />
                    <span>Setup</span>
                  </button>
                </div>
              </div>

              {/* Setup prompt editor */}
              {editingSetupPrompt === repo.name && (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-surface-700/50">
                  <label className="text-xs text-surface-400">
                    Workspace setup prompt
                  </label>
                  <textarea
                    className="w-full bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-xs text-surface-200 placeholder-surface-600 resize-y min-h-[60px] focus:outline-none focus:border-accent-500"
                    placeholder="e.g., Copy .env from the main workspace, run npm install, run db:migrate..."
                    value={setupPromptValue}
                    onChange={(e) => setSetupPromptValue(e.target.value)}
                    onBlur={() => handleSaveSetupPrompt(repo.name)}
                    rows={3}
                  />
                  <p className="text-[11px] text-surface-600">
                    Runs automatically when a new workspace is created. Leave blank to disable.
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {repositories.length === 0 && (
          <p className="text-sm text-surface-500 py-2">No projects connected. Use the + button in the side panel to add one.</p>
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
