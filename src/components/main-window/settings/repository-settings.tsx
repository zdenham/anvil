import { Folder, Plus, Trash2 } from "lucide-react";
import { SettingsSection } from "../settings-section";
import { useRepoStore, repoService } from "@/entities/repositories";

export function RepositorySettings() {
  const repositoriesMap = useRepoStore((state) => state.repositories);
  const repositories = Object.values(repositoriesMap);

  const handleAddRepository = async () => {
    // TODO: Open file picker dialog to select repository folder
    console.log("Add repository");
  };

  const handleRemoveRepository = async (name: string) => {
    // TODO: Confirm before deletion
    await repoService.delete(name);
  };

  return (
    <SettingsSection
      title="Repositories"
      description="Connected code repositories"
    >
      <div className="space-y-2">
        {repositories.map((repo) => (
          <div
            key={repo.name}
            className="flex items-center justify-between py-2 px-3 bg-surface-800/50 rounded"
          >
            <div className="flex items-center gap-2 text-surface-300">
              <Folder size={16} />
              <span className="font-medium">{repo.name}</span>
              {repo.sourcePath && (
                <span className="text-xs text-surface-500">{repo.sourcePath}</span>
              )}
            </div>
            <button
              onClick={() => handleRemoveRepository(repo.name)}
              className="text-surface-500 hover:text-red-400"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {repositories.length === 0 && (
          <p className="text-sm text-surface-500 py-2">No repositories connected</p>
        )}
        <button
          onClick={handleAddRepository}
          className="w-full py-2 px-3 border border-dashed border-surface-700
                    rounded text-surface-500 hover:text-surface-400 hover:border-surface-600
                    flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          Add Repository
        </button>
      </div>
    </SettingsSection>
  );
}
