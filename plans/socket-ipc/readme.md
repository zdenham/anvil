# Socket-Based IPC for Agent Communication

Decomposed plan for implementing Unix socket-based IPC between Tauri and agents.

## Problem Summary

Current agent communication uses stdin/stdout piped through the frontend renderer. This causes:
1. Frontend owns the pipes - fragile across HMR, window changes, crashes
2. Sub-agents spawned via bash tool cannot receive permissions, messages, or cancel signals

## Solution Summary

Move agent communication to a Unix socket owned by the Rust backend at `~/.mort/agent-hub.sock`. All agents (root and bash-based sub-agents) connect as clients.

## Sub-Plans

| Plan | Description | Dependencies | Parallelizable With |
|------|-------------|--------------|---------------------|
| [01-socket-path-helper](./01-socket-path-helper.md) | Socket path utility function | None | All |
| [02-rust-agent-hub](./02-rust-agent-hub.md) | Rust socket server implementation | None | 01, 03 |
| [03-node-hub-client](./03-node-hub-client.md) | Node.js socket client library | 01 | 02 |
| [04-runner-integration](./04-runner-integration.md) | Integrate client into agent runner | 03 | 05 |
| [05-frontend-integration](./05-frontend-integration.md) | Update frontend to use Tauri events | 02 | 04 |
| [06-cleanup-migration](./06-cleanup-migration.md) | Remove stdin/stdout communication | 04, 05 | None |

## Execution Graph

```
        ┌─────────────────────┐
        │ 01-socket-path      │
        │ (quick, do first)   │
        └─────────┬───────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             │             ▼
┌───────────┐     │     ┌───────────────┐
│ 02-rust   │     │     │ 03-node-hub   │
│ agent-hub │     │     │ client        │
└─────┬─────┘     │     └───────┬───────┘
      │           │             │
      │           │             ▼
      │           │     ┌───────────────┐
      │           │     │ 04-runner     │
      │           │     │ integration   │
      │           │     └───────┬───────┘
      │           │             │
      ▼           │             │
┌───────────┐     │             │
│ 05-frontend│    │             │
│ integration│    │             │
└─────┬─────┘     │             │
      │           │             │
      └───────────┴─────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │ 06-cleanup-migration│
        └─────────────────────┘
```

## Phases

- [x] Complete socket path helper (01)
- [x] Complete Rust AgentHub and Node.js client in parallel (02, 03)
- [x] Complete runner and frontend integration in parallel (04, 05)
- [x] Complete cleanup and migration (06)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Reference

See [original_plan.md](./original_plan.md) for the full design document with architecture diagrams and protocol details.
