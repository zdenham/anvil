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
 * Directory structure:
 * ~/.mort/
 * ├── threads/{threadId}/         - Active threads
 * ├── plans/{planId}/             - Active plans
 * ├── plan-thread-edges/          - Relation files
 * └── archive/
 *     ├── threads/{threadId}/     - Archived threads
 *     ├── plans/{planId}/         - Archived plans
 *     └── plan-thread-edges/      - Archived relations
 */
export async function bootstrapMortDirectory(): Promise<MortStores> {
  const fs = new FilesystemClient();
  const repos = new RepoStoreClient(fs);
  const settings = new SettingsStoreClient(fs);

  await Promise.all([
    // Active entity directories
    persistence.ensureDir("threads"),
    persistence.ensureDir("plans"),
    persistence.ensureDir("plan-thread-edges"),
    // Archive directories (mirror structure for all entities)
    persistence.ensureDir("archive/threads"),
    persistence.ensureDir("archive/plans"),
    persistence.ensureDir("archive/plan-thread-edges"),
    // Other stores
    repos.bootstrap(),
    settings.bootstrap(),
  ]);

  return { fs, repos, settings };
}
