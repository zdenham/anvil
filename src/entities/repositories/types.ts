/**
 * Repository types - re-exported from core for backwards compatibility.
 * The canonical source of truth is @core/types/repositories.js
 */
export {
  // Worktree types
  WorktreeClaimSchema,
  type WorktreeClaim,
  TaskBranchInfoSchema,
  type TaskBranchInfo,
  WorktreeStateSchema,
  type WorktreeState,
  // Settings types
  RepositorySettingsSchema,
  type RepositorySettings,
  // Repository metadata types
  RepositoryMetadataSchema,
  type RepositoryMetadata,
  RepositoryVersionSchema,
  type RepositoryVersion,
  RepositorySchema,
  type Repository,
  // Input interfaces
  type CreateRepositoryInput,
  type UpdateRepositoryInput,
} from "@core/types/repositories.js";
