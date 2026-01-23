import { createClient } from "@clickhouse/client";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const client = createClient({
  url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

async function migrate() {
  const migrationsDir = join(import.meta.dirname, "../migrations");
  const files = await readdir(migrationsDir);
  const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

  console.log(`Found ${sqlFiles.length} migration(s)`);

  for (const file of sqlFiles) {
    console.log(`Running migration: ${file}`);
    const sql = await readFile(join(migrationsDir, file), "utf-8");

    // Remove comment lines and split by semicolons
    const cleanedSql = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = cleanedSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s);

    for (const statement of statements) {
      await client.command({ query: statement });
    }

    console.log(`✓ ${file} completed`);
  }

  console.log("All migrations completed");
  await client.close();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
