import Fastify from 'fastify';
import { createClient } from '@clickhouse/client';
import {
  LogBatchSchema,
  type LogBatch,
  type LogInsertResponse,
  type LogErrorResponse,
} from './types/logs.js';
import { IdentitySchema } from './types/identity.js';

const fastify = Fastify({ logger: true });

// ClickHouse connection (credentials stay server-side)
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'default',
});

const TABLE = process.env.CLICKHOUSE_TABLE ?? 'logs';

fastify.post<{ Body: unknown }>('/logs', async (request, reply) => {
  const parseResult = LogBatchSchema.safeParse(request.body);

  if (!parseResult.success) {
    reply.status(400);
    return {
      status: 'error',
      message: `Invalid log batch: ${parseResult.error.message}`,
    } satisfies LogErrorResponse;
  }

  const { logs } = parseResult.data;

  if (logs.length === 0) {
    return { status: 'ok', inserted: 0 } satisfies LogInsertResponse;
  }

  try {
    // Assign log_id to any rows missing one
    const logsWithIds = logs.map((log) => ({
      ...log,
      log_id: log.log_id ?? crypto.randomUUID(),
    }));

    // Insert log rows (without properties)
    const logRows = logsWithIds.map(({ properties, ...row }) => row);

    const result = await clickhouse.insert({
      table: TABLE,
      values: logRows,
      format: 'JSONEachRow',
    });

    // Decompose properties into EAV rows
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
    return { status: 'ok', inserted: writtenRows } satisfies LogInsertResponse;
  } catch (error) {
    request.log.error(error);
    reply.status(500);
    return { status: 'error', message: String(error) } satisfies LogErrorResponse;
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

fastify.get('/health', async (request, reply) => {
  try {
    // Use a SELECT query instead of ping to verify authentication works
    const result = await clickhouse.query({
      query: `SELECT 1 as ok, count(*) as table_rows FROM ${TABLE}`,
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ ok: number; table_rows: string }>();
    const data = (rows as unknown as { ok: number; table_rows: string }[])[0];
    if (!data || data.ok !== 1) {
      reply.status(503);
      return { status: 'unhealthy', clickhouse: 'query_failed' };
    }
    return {
      status: 'healthy',
      clickhouse: 'connected',
      table_rows: Number(data.table_rows),
    };
  } catch (error) {
    reply.status(503);
    return { status: 'unhealthy', clickhouse: 'error', message: String(error) };
  }
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Verify ClickHouse connection after server is listening (non-fatal)
  try {
    fastify.log.info('Verifying ClickHouse connection...');
    const result = await clickhouse.query({
      query: `SELECT 1 as ok FROM ${TABLE} LIMIT 1`,
      format: 'JSONEachRow',
    });
    await result.json();
    fastify.log.info('ClickHouse connection verified');
  } catch (err) {
    fastify.log.warn('ClickHouse connection check failed — server is running but ClickHouse may be unreachable');
    fastify.log.warn(err);
  }
};

start();
