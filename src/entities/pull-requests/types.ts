/**
 * Pull request types - re-exported from core for backwards compatibility.
 * The canonical source of truth is @core/types/pull-request.js
 */
export {
  // Schemas
  PullRequestMetadataSchema,
  CreatePullRequestInputSchema,
  // Types derived from schemas
  type PullRequestMetadata,
  type CreatePullRequestInput,
  // Plain interfaces
  type PullRequestDetails,
} from "@core/types/pull-request.js";
