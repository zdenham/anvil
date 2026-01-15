/**
 * Thread types - re-exported from core for backwards compatibility.
 * The canonical source of truth is @core/types/threads.js
 */
export {
  // Type aliases
  type ThreadStatus,
  type AgentType,
  // Schemas
  ThreadTurnSchema,
  ThreadMetadataSchema,
  // Types derived from schemas
  type ThreadTurn,
  type ThreadMetadata,
  // Input interfaces
  type CreateThreadInput,
  type UpdateThreadInput,
  // Helper functions
  getThreadFolderName,
  parseThreadFolderName,
} from "@core/types/threads.js";
