import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import {
  ChannelSchema,
  CreateChannelBodySchema,
  type Channel,
} from "../types/channel.js";

function channelKey(channelId: string): string {
  return `gateway:channel:${channelId}`;
}

function deviceChannelsKey(deviceId: string): string {
  return `gateway:device-channels:${deviceId}`;
}

function idempotencyKey(
  deviceId: string,
  type: string,
  label: string
): string {
  return `gateway:channel-by:${deviceId}:${type}:${label}`;
}

function buildWebhookUrl(
  protocol: string,
  host: string,
  channelId: string
): string {
  return `${protocol}://${host}/gateway/channels/${channelId}/events`;
}

async function findExistingChannel(
  redis: Redis,
  deviceId: string,
  type: string,
  label: string
): Promise<Channel | null> {
  const existingId = await redis.get(idempotencyKey(deviceId, type, label));
  if (!existingId) {
    return null;
  }

  const raw = await redis.get(channelKey(existingId));
  if (!raw) {
    return null;
  }

  return ChannelSchema.parse(JSON.parse(raw));
}

async function createChannel(
  redis: Redis,
  deviceId: string,
  type: "github",
  label: string
): Promise<Channel> {
  const channelId = randomUUID();
  const channel: Channel = {
    channelId,
    deviceId,
    type,
    label,
    createdAt: new Date().toISOString(),
  };

  const pipeline = redis.pipeline();
  pipeline.set(channelKey(channelId), JSON.stringify(channel));
  pipeline.sadd(deviceChannelsKey(deviceId), channelId);
  pipeline.set(idempotencyKey(deviceId, type, label), channelId);
  await pipeline.exec();

  return channel;
}

export function registerChannelsRoute(
  fastify: FastifyInstance,
  redis: Redis
): void {
  fastify.post("/channels", async (request, reply) => {
    const parseResult = CreateChannelBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const { deviceId, type, label } = parseResult.data;

    const existing = await findExistingChannel(redis, deviceId, type, label);
    if (existing) {
      const protocol = request.protocol;
      const host = request.hostname;
      const webhookUrl = buildWebhookUrl(protocol, host, existing.channelId);
      return reply.status(200).send({
        channelId: existing.channelId,
        webhookUrl,
      });
    }

    const channel = await createChannel(redis, deviceId, type, label);
    const protocol = request.protocol;
    const host = request.hostname;
    const webhookUrl = buildWebhookUrl(protocol, host, channel.channelId);

    return reply.status(201).send({
      channelId: channel.channelId,
      webhookUrl,
    });
  });
}
