import Fastify from 'fastify';
import { createClient } from '@clickhouse/client';
import {
  LogBatchSchema,
  type LogBatch,
  type LogInsertResponse,
  type LogErrorResponse,
} from './types/logs.js';

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
  // Validate request body with Zod
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
    const result = await clickhouse.insert({
      table: TABLE,
      values: logs,
      format: 'JSONEachRow',
    });

    // Verify the insert actually succeeded by checking the summary
    const writtenRows = Number(result.summary?.written_rows ?? 0);
    if (writtenRows !== logs.length) {
      request.log.error(
        { expected: logs.length, actual: writtenRows, summary: result.summary },
        'Insert verification failed: row count mismatch'
      );
      reply.status(500);
      return {
        status: 'error',
        message: `Insert verification failed: expected ${logs.length} rows, got ${writtenRows}`,
      } satisfies LogErrorResponse;
    }

    return { status: 'ok', inserted: writtenRows } satisfies LogInsertResponse;
  } catch (error) {
    request.log.error(error);
    reply.status(500);
    return { status: 'error', message: String(error) } satisfies LogErrorResponse;
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
    // Verify ClickHouse connection and auth before starting server
    fastify.log.info('Verifying ClickHouse connection...');
    const result = await clickhouse.query({
      query: `SELECT 1 as ok FROM ${TABLE} LIMIT 1`,
      format: 'JSONEachRow',
    });
    await result.json(); // Consume the result to ensure query completed
    fastify.log.info('ClickHouse connection verified');

    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
