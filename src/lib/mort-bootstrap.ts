import { FilesystemClient } from "./filesystem-client";
import { RepoStoreClient } from "./repo-store-client";
import { SettingsStoreClient } from "./settings-store-client";
import { persistence } from "./persistence";

/**
 * Mort store clients for accessing the .mort directory structure
 */
export interface MortStores {
  fs: FilesystemClient;
  repos: RepoStoreClient;
  settings: SettingsStoreClient;
}

/**
 * Bootstraps the .mort directory structure in Documents.
 * Creates all necessary directories and returns initialized store clients.
 *
 * Note: Tasks are bootstrapped via taskService.hydrate() which uses the
 * shared persistence layer with folder structure: tasks/{slug}/metadata.json
 */
export async function bootstrapMortDirectory(): Promise<MortStores> {
  const fs = new FilesystemClient();
  const repos = new RepoStoreClient(fs);
  const settings = new SettingsStoreClient(fs);

  await Promise.all([
    // Tasks directory is ensured via persistence (shared with CLI)
    persistence.ensureDir("tasks"),
    repos.bootstrap(),
    settings.bootstrap(),
  ]);

  return { fs, repos, settings };
}
