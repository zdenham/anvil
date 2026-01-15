# Queued Messages - Implementation Overview

## Summary

Implement mid-execution message queuing for Simple Tasks, allowing users to send follow-up messages while the agent is running.

## Execution Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                        PHASE 1 (Parallel)                       │
├─────────────────┬─────────────────────┬─────────────────────────┤
│                 │                     │                         │
│  01-prereq      │  02-agent-stdin     │  03-frontend-queuing    │
│  (API key fix)  │  (stdin stream)     │  (UI + IPC)             │
│                 │                     │                         │
│  ~15 min        │  ~45 min            │  ~45 min                │
│                 │                     │                         │
└────────┬────────┴──────────┬──────────┴────────────┬────────────┘
         │                   │                       │
         └───────────────────┼───────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PHASE 2 (Sequential)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  04-integration-testing                                         │
│  (Unit tests, harness, e2e)                                     │
│                                                                 │
│  ~60 min                                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Sub-Plans

| # | Plan | Scope | Can Parallel With |
|---|------|-------|-------------------|
| 01 | [prereq-api-key](./01-prereq-api-key.md) | Fix missing API key in spawnSimpleAgent | 02, 03 |
| 02 | [agent-stdin-stream](./02-agent-stdin-stream.md) | Agent-side stdin message handling | 01, 03 |
| 03 | [frontend-queuing](./03-frontend-queuing.md) | Frontend UI and IPC | 01, 02 |
| 04 | [integration-testing](./04-integration-testing.md) | All testing | None (needs 01-03) |

## Interface Contract

Plans 02 and 03 communicate via this JSON protocol over stdin:

```typescript
// Frontend → Agent (via child.write to stdin)
{
  type: 'queued_message',
  id: string,        // UUID for tracking
  content: string,   // User's message
  timestamp: number  // Unix timestamp
}
```

Both plans can be developed in parallel as long as they adhere to this contract.

## Completion Criteria

- [ ] 01: API key passed to simple agent processes
- [ ] 02: Agent reads stdin, injects messages into SDK conversation
- [ ] 03: Frontend sends queued messages, shows banner UI
- [ ] 04: All tests pass (unit, integration, e2e)
