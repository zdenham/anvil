import { buildApp } from "./app.js";

const app = await buildApp({
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
});

const port = Number(process.env.PORT) || 3000;

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
