# Testing

This document describes how to test the Mort codebase.

## Quick Reference

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all TypeScript unit/integration tests |
| `pnpm test:ui` | Run UI isolation tests |
| `pnpm tsc --noEmit` | Type check frontend |
| `pnpm --filter agents typecheck` | Type check agents |
| `cd src-tauri && cargo test` | Run Rust tests |
| `./src-tauri/target/debug/mort-test` | Run E2E accessibility tests |

## Test Types

Mort uses four distinct testing approaches, each serving a specific purpose in the verification pyramid.

**Unit & Integration Tests** (`pnpm test`)
- Test services and libraries in isolation using mock adapters.
- Run headlessly via Vitest. Fast feedback loop.
- Tests live in `core/services/**/*.test.ts` and `src/lib/*.test.ts`.

**UI Isolation Tests** (`pnpm test:ui`)
- Test React components with mocked Tauri APIs and virtual filesystem.
- Run headlessly via Vitest + happy-dom. No Tauri runtime required.
- Tests use `.ui.test.tsx` suffix. See `plans/ui-isolation-testing.md` for details.
- Key helpers: `TestEvents` (emit mock events), `TestLogs` (assert on log output), `VirtualFS` (seed filesystem).

**Agent Functional Tests** (`cd agents && pnpm test`)
- Test agent behavior end-to-end with real or mocked Anthropic APIs.
- Verify event emissions, tool usage, and agent lifecycle.
- Tests live in `agents/src/testing/__tests__/`.

**E2E Accessibility Tests** (`mort-test`)
- Test the real app using native macOS accessibility APIs.
- Trigger keyboard shortcuts, verify window state, run scenarios.
- CLI at `src-tauri/src/bin/mort-test/`.

## Verification Philosophy

All code must be verified. Static analysis is insufficient.

1. **Unit tests** - Test individual functions and classes in isolation
2. **Integration tests** - Test interfaces between services
3. **Reproduction** - Prove diagnoses by reproducing issues or analyzing logs

Logs are written to `logs/dev.log`. See [logs.md](./logs.md) for how to read them safely.

## When to Use Each Test Type

| Scenario | Test Type |
|----------|-----------|
| Testing a pure utility function | Unit |
| Testing a service with dependencies | Unit (with mock adapters) |
| Testing React component rendering | UI Isolation |
| Testing component user interactions | UI Isolation |
| Testing event-driven UI updates | UI Isolation |
| Testing agent completes a task | Agent Functional |
| Testing agent emits correct events | Agent Functional |
| Testing keyboard shortcuts work | E2E |
| Testing window opens/closes | E2E |
| Testing full user workflows | E2E |

## Type Checking

Type checking is separate from tests and should pass before committing.

```bash
# Check frontend types
pnpm tsc --noEmit

# Check agents types
pnpm --filter agents typecheck
```
