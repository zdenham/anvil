import { createClient } from "@clickhouse/client";
import type { FastifyPluginAsync } from "fastify";
import {
  LogBatchSchema,
  type LogInsertResponse,
  type LogErrorResponse,
} from "../types/logs.js";
import { IdentitySchema } from "../types/identity.js";

export interface ClickHousePluginOptions {
  url: string;
  username: string;
  password: string;
  database: string;
  table: string;
}

const clickhousePlugin: FastifyPluginAsync<ClickHousePluginOptions> = async (
  fastify,
  opts
) => {
  const clickhouse = createClient({
    url: opts.url,
    username: opts.username,
    password: opts.password,
    database: opts.database,
  });

  const TABLE = opts.table;

  fastify.post<{ Body: unknown }>("/logs", async (request, reply) => {
    const parseResult = LogBatchSchema.safeParse(request.body);

    if (!parseResult.success) {
      reply.status(400);
      return {
        status: "error",
        message: `Invalid log batch: ${parseResult.error.message}`,
      } satisfies LogErrorResponse;
    }

    const { logs } = parseResult.data;

    if (logs.length === 0) {
      return { status: "ok", inserted: 0 } satisfies LogInsertResponse;
    }

    try {
      const logsWithIds = logs.map((log) => ({
        ...log,
        log_id: log.log_id ?? crypto.randomUUID(),
      }));

      const logRows = logsWithIds.map(({ properties, ...row }) => row);

      const result = await clickhouse.insert({
        table: TABLE,
        values: logRows,
        format: "JSONEachRow",
      });

      const propRows = logsWithIds.flatMap((log) =>
        Object.entries(log.properties ?? {}).map(([key, value]) => ({
          log_id: log.log_id,
          device_id: log.device_id,
          timestamp: log.timestamp,
          key,
          value_string: typeof value === "string" ? value : "",
          value_number: typeof value === "number" ? value : 0,
          value_bool: typeof value === "boolean" ? (value ? 1 : 0) : 0,
        }))
      );

      if (propRows.length > 0) {
        await clickhouse.insert({
          table: "log_properties",
          values: propRows,
          format: "JSONEachRow",
        });
      }

      const writtenRows = Number(result.summary?.written_rows ?? 0);
      return { status: "ok", inserted: writtenRows } satisfies LogInsertResponse;
    } catch (error) {
      request.log.error(error);
      reply.status(500);
      return { status: "error", message: String(error) } satisfies LogErrorResponse;
    }
  });

  fastify.post<{ Body: unknown }>("/identity", async (request, reply) => {
    const parseResult = IdentitySchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400);
      return { status: "error", message: parseResult.error.message };
    }

    const { device_id, github_handle } = parseResult.data;

    try {
      await clickhouse.insert({
        table: "identities",
        values: [{ device_id, github_handle }],
        format: "JSONEachRow",
      });

      return { status: "ok" };
    } catch (error) {
      request.log.error(error);
      reply.status(500);
      return { status: "error", message: String(error) };
    }
  });

  fastify.get("/health", async (request, reply) => {
    try {
      const result = await clickhouse.query({
        query: `SELECT 1 as ok, count(*) as table_rows FROM ${TABLE}`,
        format: "JSONEachRow",
      });
      const rows = await result.json<{ ok: number; table_rows: string }>();
      const data = (rows as unknown as { ok: number; table_rows: string }[])[0];
      if (!data || data.ok !== 1) {
        reply.status(503);
        return { status: "unhealthy", clickhouse: "query_failed" };
      }
      return {
        status: "healthy",
        clickhouse: "connected",
        table_rows: Number(data.table_rows),
      };
    } catch (error) {
      reply.status(503);
      return { status: "unhealthy", clickhouse: "error", message: String(error) };
    }
  });

  // Verify ClickHouse connection (non-fatal)
  try {
    fastify.log.info("Verifying ClickHouse connection...");
    const result = await clickhouse.query({
      query: `SELECT 1 as ok FROM ${TABLE} LIMIT 1`,
      format: "JSONEachRow",
    });
    await result.json();
    fastify.log.info("ClickHouse connection verified");
  } catch (err) {
    fastify.log.warn(
      "ClickHouse connection check failed — server is running but ClickHouse may be unreachable"
    );
    fastify.log.warn(err);
  }
};

export default clickhousePlugin;
export { clickhousePlugin };
