# cc-teams (indigo-toucan)

**Philosophy:** Production-quality with proper separation. Most files, most tests.

## Unique Decisions

- **4-file dispatch split** — separate dispatch-\*.ts files for routing + implementation files for logic (cleanest separation)
- **630+ lines of agent hub integration tests** — only implementation with hub tests
- **Largest Rust cleanup** — removed axum, portable-pty, tokio/rt-multi-thread, and 6+ crates
- **Express dependency** but also `@types/express`, `@types/ws` dev deps
- **LockManager uses crypto.randomUUID()** for lock IDs (vs auto-increment)
- **dist-sidecar/ output directory** (not `sidecar/dist/`) — different build output path

## Strengths

- Best dispatch architecture (modular, testable, clear boundaries)
- Only implementation with substantial test coverage
- Largest Rust simplification (fewer native dependencies)
- Proper manager classes with full lifecycle methods

## Weaknesses

- No sidecar readiness probe (Tauri connects before sidecar listening)
- `dist-sidecar/` not gitignored
- Largest codebase (\~4,161 lines) — could be over-engineered
- CORS set to `*` (overly permissive)