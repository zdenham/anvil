import Fastify from 'fastify';
import { createClient } from '@clickhouse/client';
import {
  LogBatchSchema,
  type LogBatch,
  type LogInsertResponse,
  type LogErrorResponse,
} from '../../core/types/logs.js';

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
    await clickhouse.insert({
      table: TABLE,
      values: logs,
      format: 'JSONEachRow',
    });

    return { status: 'ok', inserted: logs.length } satisfies LogInsertResponse;
  } catch (error) {
    request.log.error(error);
    reply.status(500);
    return { status: 'error', message: String(error) } satisfies LogErrorResponse;
  }
});

fastify.get('/health', async () => {
  return { status: 'healthy' };
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
