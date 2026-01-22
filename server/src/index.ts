import Fastify from 'fastify';
import { createClient } from '@clickhouse/client';

const fastify = Fastify({ logger: true });

// ClickHouse connection (credentials stay server-side)
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'default',
});

const TABLE = process.env.CLICKHOUSE_TABLE ?? 'logs';

interface LogRow {
  timestamp: number; // milliseconds since epoch
  level: string;
  message: string;
  target: string;
  version: string;
  session_id: string;
  app_suffix: string;
  source?: string;
  task_id?: string;
  thread_id?: string;
  repo_name?: string;
  worktree_path?: string;
  duration_ms?: number;
  data?: string; // JSON blob
}

interface LogBatch {
  logs: LogRow[];
}

fastify.post<{ Body: LogBatch }>('/logs', async (request, reply) => {
  const { logs } = request.body;

  if (!logs || logs.length === 0) {
    return { status: 'ok', inserted: 0 };
  }

  try {
    await clickhouse.insert({
      table: TABLE,
      values: logs,
      format: 'JSONEachRow',
    });

    return { status: 'ok', inserted: logs.length };
  } catch (error) {
    request.log.error(error);
    reply.status(500);
    return { status: 'error', message: String(error) };
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
