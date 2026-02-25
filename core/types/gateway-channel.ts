import { z } from "zod";

export const GatewayChannelMetadataSchema = z.object({
  /** Stable ID: matches the server-side channelId (UUID) */
  id: z.string().uuid(),
  /** Channel type -- determines event routing */
  type: z.literal("github"),
  /** Human label (e.g. "owner/repo") */
  label: z.string().min(1),
  /** Whether this channel is currently active (receiving events) */
  active: z.boolean(),
  /** The webhook URL that external sources post to (contains unguessable channelId) */
  webhookUrl: z.string().url(),
  /** Associated repo entity ID */
  repoId: z.string().uuid().nullable().default(null),
  /** GitHub webhook ID for cleanup on delete */
  webhookId: z.number().nullable().default(null),
  /** Unix epoch milliseconds */
  createdAt: z.number(),
  /** Unix epoch milliseconds */
  updatedAt: z.number(),
});

export type GatewayChannelMetadata = z.infer<typeof GatewayChannelMetadataSchema>;
