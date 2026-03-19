# baseline (ivory-earwig)

**Philosophy:** Minimal, close-to-metal. No abstractions beyond necessary.

## Unique Decisions

- **No Express** — uses raw `http.createServer()`, the only implementation to skip Express entirely
- **Global Maps instead of classes** — terminals, watchers, agents stored in module-scoped Maps rather than manager classes
- **Custom simpleHash** for port file path (not SHA-256, but matches between Rust and Node)
- **In-memory web log buffer** (max 1000 entries) accessible via commands — unique diagnostic feature
- **Lazy shell PATH init** — defers PATH resolution via `execSync` to first use

## Strengths

- Smallest footprint (\~2,029 lines)
- Clean handler separation (8 domain-specific files)
- Graceful degradation (missing node-pty/chokidar don't crash)
- Minimal dependencies (ws, chokidar, node-pty)

## Weaknesses

- No manager lifecycle classes — harder to test and extend
- `agent_cancel` has stale PID reference after thread reuse
- `wsInvoke` race: WS can close between readyState check and send()
- Sidecar path resolution uses `data_dir().parent()` — fails in packaged builds
- Shutdown calls `process.exit(0)` without killing child processes