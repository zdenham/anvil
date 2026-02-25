import { z } from "zod";
/**
 * A gateway event received from a webhook source and buffered in Redis.
 * Validated at trust boundaries (network responses, SSE frame parsing).
 */
export const GatewayEventSchema = z.object({
    /** Unique event ID (UUID) — stable, transport-independent identifier */
    id: z.string().uuid(),
    /** Channel type prefix + source event name (e.g. "github.issue_comment") */
    type: z.string(),
    /** The channelId that produced this event */
    channelId: z.string(),
    /** Original webhook payload — opaque to the gateway */
    payload: z.record(z.string(), z.unknown()),
    /** Server timestamp (ms since epoch) */
    receivedAt: z.number(),
});
/**
 * A registered event source channel bound to a specific device.
 * Channels route webhooks to the correct device's event stream.
 */
export const ChannelSchema = z.object({
    /** Unique channel ID (UUID) — used in webhook URLs */
    channelId: z.string().uuid(),
    /** The device that owns this channel */
    deviceId: z.string().uuid(),
    /** Channel type — determines future verification logic */
    type: z.literal("github"),
    /** Human label (e.g. "zac's github webhooks") */
    label: z.string().min(1),
    /** ISO timestamp */
    createdAt: z.string().datetime(),
});
