import { createClient } from '@clickhouse/client';

async function main() {
  const client = createClient({
    url: process.env.CLICKHOUSE_URL,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE,
  });
  
  // Count total and check distinct device_ids
  const count = await client.query({
    query: "SELECT count(*) as total, countIf(device_id != '') as with_device_id, uniqExact(device_id) as unique_device_ids FROM logs",
    format: 'JSONEachRow',
  });
  console.log("Counts:");
  console.log(JSON.stringify(await count.json(), null, 2));
  
  // Most recent 5 by timestamp desc
  const recent = await client.query({
    query: "SELECT timestamp, device_id, level, substring(message, 1, 60) as msg FROM logs ORDER BY timestamp DESC LIMIT 5",
    format: 'JSONEachRow',
  });
  console.log("\nMost recent logs:");
  console.log(JSON.stringify(await recent.json(), null, 2));
  
  await client.close();
}

main();
