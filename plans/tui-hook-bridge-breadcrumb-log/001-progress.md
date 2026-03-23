# Progress 001

## Done
- Extracted shared hook helpers into `core/lib/hooks/` (git-safety, tool-deny, file-changes, comment-resolution)
- Built transcript `.jsonl` parser in `core/lib/transcript/` (types, schemas, parser with full + incremental read)
- Updated agent runner hooks to use shared helpers (safe-git-hook, comment-resolution-hook, shared.ts disallowedTools + file change extraction)
- 34 new tests all passing (core/lib/hooks/ and core/lib/transcript/)
- Plan phases marked complete: Phase 1 of hook-bridge plan, phases 5-7 of state-architecture plan

## Remaining
- Phase 2: HTTP hook endpoints in sidecar (hook-handler, thread-state-writer, transcript-reader)
- Phase 3: Dynamic hooks.json generation in sidecar on startup
- Phase 4: Extend buildSpawnConfig() with --plugin and env vars
- Phase 5: Frontend integration for TUI thread state display
- Phase 6: Lifecycle event emission and tracking

## Context
- Pre-existing test failures in agents/ (10 files, 26 tests) and core/ (thread-reducer.test.ts) are unrelated to this work
- `isPlanPath` and `parsePhases` remain in agents/ — not extracted since plan detection is agent-runner-specific logic tied to persistence/events
- `extractFileChange` takes workingDir param for future use (sidecar will normalize paths) but doesn't use it yet — agent runner normalizes via `updateFileChange` in output.ts
