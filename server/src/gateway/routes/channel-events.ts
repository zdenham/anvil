import { randomUUID } from "crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { ChannelSchema, type Channel } from "../types/channel.js";
import type { GatewayEvent } from "../types/events.js";
import { addEvent } from "../services/event-buffer.js";

const WebhookPayloadSchema = z.record(z.unknown());

interface ChannelEventsParams {
  channelId: string;
}

async function lookupChannel(
  redis: Redis,
  channelId: string
): Promise<Channel | null> {
  const raw = await redis.get(`gateway:channel:${channelId}`);
  if (!raw) {
    return null;
  }
  return ChannelSchema.parse(JSON.parse(raw));
}

function buildEventType(
  channelType: string,
  githubEvent: string
): string {
  return `${channelType}.${githubEvent}`;
}

export function registerChannelEventsRoute(
  fastify: FastifyInstance,
  redis: Redis
): void {
  fastify.post<{ Params: ChannelEventsParams }>(
    "/channels/:channelId/events",
    async (request, reply) => {
      const { channelId } = request.params;

      const channel = await lookupChannel(redis, channelId);
      if (!channel) {
        return reply.status(404).send({ error: "Channel not found" });
      }

      const rawHeader = request.headers["x-github-event"];
      const githubEvent = typeof rawHeader === "string" ? rawHeader : "unknown";

      const parsePayload = WebhookPayloadSchema.safeParse(request.body);
      const payload = parsePayload.success
        ? parsePayload.data
        : { raw: request.body };

      const event: GatewayEvent = {
        id: randomUUID(),
        type: buildEventType(channel.type, githubEvent),
        channelId,
        payload,
        receivedAt: Date.now(),
      };

      await addEvent(redis, channel.deviceId, event);

      return reply.status(201).send({ eventId: event.id });
    }
  );
}
