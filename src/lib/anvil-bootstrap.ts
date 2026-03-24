import { FilesystemClient } from "./filesystem-client";
import { RepoStoreClient } from "./repo-store-client";
import { SettingsStoreClient } from "./settings-store-client";
import { appData } from "./app-data-store";

/**
 * Anvil store clients for accessing the .anvil directory structure
 */
export interface AnvilStores {
  fs: FilesystemClient;
  repos: RepoStoreClient;
  settings: SettingsStoreClient;
}

/**
 * Bootstraps the .anvil directory structure in Documents.
 * Creates all necessary directories and returns initialized store clients.
 *
 * Note: Migrations (including quick-actions project initialization) are now
 * handled by Rust during app startup via the TypeScript migration runner.
 *
 * Directory structure:
 * ~/.anvil/
 * ├── threads/{threadId}/         - Active threads
 * ├── plans/{planId}/             - Active plans
 * ├── plan-thread-edges/          - Relation files
 * └── archive/
 *     ├── threads/{threadId}/     - Archived threads
 *     ├── plans/{planId}/         - Archived plans
 *     └── plan-thread-edges/      - Archived relations
 */
export async function bootstrapAnvilDirectory(): Promise<AnvilStores> {
  const fs = new FilesystemClient();
  const repos = new RepoStoreClient(fs);
  const settings = new SettingsStoreClient(fs);

  await Promise.all([
    // Active entity directories
    appData.ensureDir("threads"),
    appData.ensureDir("plans"),
    appData.ensureDir("plan-thread-edges"),
    // Archive directories (mirror structure for all entities)
    appData.ensureDir("archive/threads"),
    appData.ensureDir("archive/plans"),
    appData.ensureDir("archive/plan-thread-edges"),
    // Other stores
    repos.bootstrap(),
    settings.bootstrap(),
  ]);

  return { fs, repos, settings };
}
