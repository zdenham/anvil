# Task Directory Resolution - Execution Overview

## Dependency Graph

```
                    ┌─────────────────────────────────────┐
                    │  01-types-and-interface (FIRST)     │
                    └─────────────────┬───────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│ 02-node-fs-adapter  │ │ 03-tauri-fs-adapter │ │ 04-resolution-svc   │
│     (PARALLEL)      │ │     (PARALLEL)      │ │     (PARALLEL)      │
└──────────┬──────────┘ └──────────┬──────────┘ └──────────┬──────────┘
           │                       │                       │
           └───────────────────────┼───────────────────────┘
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  05-migrate-slug-apis (GATE)        │
                    └─────────────────┬───────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
┌─────────────────────────────┐             ┌─────────────────────────────┐
│ 06-thread-writer-agents     │             │ 07-frontend-writes          │
│        (PARALLEL)           │             │        (PARALLEL)           │
└──────────────┬──────────────┘             └──────────────┬──────────────┘
               │                                           │
               └─────────────────┬─────────────────────────┘
                                 ▼
                    ┌─────────────────────────────────────┐
                    │  08-cleanup (FINAL)                 │
                    └─────────────────────────────────────┘
```

## Parallel Execution Groups

| Group | Plans | Can Start After |
|-------|-------|-----------------|
| **A** | `01-types-and-interface` | Immediately |
| **B** | `02-node-fs-adapter`, `03-tauri-fs-adapter`, `04-resolution-service` | Group A complete |
| **C** | `05-migrate-slug-apis` | Group B complete |
| **D** | `06-thread-writer-agents`, `07-frontend-writes` | Group C complete |
| **E** | `08-cleanup` | Group D complete |

## Quick Reference

| File | Purpose | Est. Complexity |
|------|---------|-----------------|
| `01-types-and-interface.md` | Shared types + FSAdapter interface | Low |
| `02-node-fs-adapter.md` | Node.js adapter for agents | Low |
| `03-tauri-fs-adapter.md` | Tauri adapter for frontend | Low |
| `04-resolution-service.md` | Core resolution logic | Medium |
| `05-migrate-slug-apis.md` | Change APIs from slug→ID | Medium |
| `06-thread-writer-agents.md` | Agent-side write abstraction | Medium |
| `07-frontend-writes.md` | Frontend write path updates | Medium |
| `08-cleanup.md` | Remove deprecated code, tests | Low |
