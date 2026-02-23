import Fastify from "fastify";
import { gatewayPlugin } from "./gateway/index.js";
import { clickhousePlugin } from "./routes/clickhouse.js";

export interface AppOptions {
  redisUrl: string;
  /** Skip ClickHouse routes — for gateway-only testing */
  gatewayOnly?: boolean;
}

export async function buildApp(options: AppOptions) {
  const fastify = Fastify({ logger: !options.gatewayOnly });

  if (!options.gatewayOnly) {
    await fastify.register(clickhousePlugin, {
      url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DATABASE ?? "default",
      table: process.env.CLICKHOUSE_TABLE ?? "logs",
    });
  }

  await fastify.register(gatewayPlugin, {
    prefix: "/gateway",
    redisUrl: options.redisUrl,
  });

  return fastify;
}
