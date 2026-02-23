import type { FastifyPluginAsync } from "fastify";
import { getRedis, closeRedis } from "./services/redis.js";
import { registerChannelsRoute } from "./routes/channels.js";
import { registerChannelEventsRoute } from "./routes/channel-events.js";
import { registerDeviceEventsRoute } from "./routes/device-events.js";

export interface GatewayPluginOptions {
  redisUrl: string;
}

const gatewayPlugin: FastifyPluginAsync<GatewayPluginOptions> = async (
  fastify,
  opts
) => {
  const redis = getRedis(opts.redisUrl);

  registerChannelsRoute(fastify, redis);
  registerChannelEventsRoute(fastify, redis);
  registerDeviceEventsRoute(fastify, redis);

  fastify.addHook("onClose", async () => {
    await closeRedis();
  });
};

export default gatewayPlugin;
export { gatewayPlugin };
