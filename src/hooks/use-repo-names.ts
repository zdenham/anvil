import { useState, useEffect, useMemo } from "react";
import { loadSettings } from "@/lib/app-data-store";
import { useRepoStore } from "@/entities/repositories";

/**
 * Slugifies a repository name for use in paths.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Mapping from repository UUID to display name.
 */
export type RepoNameMap = Record<string, string>;

/**
 * Hook to build a mapping from repository UUIDs to display names.
 *
 * This mapping is built asynchronously by loading settings for all repositories.
 * Returns an empty object until the mapping is built.
 *
 * @returns Object containing:
 *   - repoNames: Map from repoId (UUID) to display name
 *   - repoCount: Number of repositories
 *   - getRepoName: Helper function to get name for a repoId
 */
export function useRepoNames(): {
  repoNames: RepoNameMap;
  repoCount: number;
  getRepoName: (repoId: string) => string | undefined;
} {
  const [repoNames, setRepoNames] = useState<RepoNameMap>({});
  const repositories = useRepoStore((s) => s.repositories);
  const repoNamesFromStore = useMemo(
    () => Object.keys(repositories),
    [repositories]
  );
  const repoCount = repoNamesFromStore.length;

  useEffect(() => {
    const buildMapping = async () => {
      const mapping: RepoNameMap = {};

      for (const name of repoNamesFromStore) {
        const slug = slugify(name);
        try {
          const settings = await loadSettings(slug);
          mapping[settings.id] = settings.name;
        } catch (err) {
          // Skip repos that fail to load
          // Skip repos that fail to load
        }
      }

      setRepoNames(mapping);
    };

    buildMapping();
  }, [repoNamesFromStore.join(",")]);

  const getRepoName = useMemo(() => {
    return (repoId: string): string | undefined => repoNames[repoId];
  }, [repoNames]);

  return { repoNames, repoCount, getRepoName };
}
