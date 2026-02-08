# Claude Code Skills Integration

## Overview

Integrate Claude Code skills and legacy commands into Mort, enabling users to define custom capabilities that extend agent functionality via `/skill-name` invocation.

## Phases

- [x] Foundation types and interfaces (01, 02)
- [x] Skills entity implementation (03)
- [x] Parallel UI and agent work (04, 05, 06, 07)
- [x] Integration and testing (08)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Sub-Plans

### Track A: Foundation (Sequential)

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [01-types-foundation](./01-types-foundation.md) | Core types for skills entity AND adapter interfaces | None |
| [02-skills-store](./02-skills-store.md) | Zustand store for skill state | 01 |
| [03-skills-service](./03-skills-service.md) | Discovery service using FS adapter | 01, 02 |

### Track B: UI (Parallel after Track A)

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [04-slash-command-trigger](./04-slash-command-trigger.md) | `/` trigger handler and dropdown | 03 |
| [05-ui-display](./05-ui-display.md) | Skill chip rendering in messages | 03 |
| [06-settings-ui](./06-settings-ui.md) | Skills list in settings panel | 03 |

### Track C: Agent (After 03)

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [07-agent-injection](./07-agent-injection.md) | System prompt injection using shared SkillsService | 01, 03 |

### Track D: Integration

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [08-integration-testing](./08-integration-testing.md) | End-to-end testing and polish | 04, 05, 06, 07 |

---

## Execution Strategy

```
                    ┌─────────────────────────────────────┐
                    │  01-types-foundation                │
                    │  (Core types + FilesystemAdapter)   │
                    └─────────────────┬───────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │  02-skills-store                    │
                    │  (Zustand store for frontend)       │
                    └─────────────────┬───────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │  03-skills-service                  │
                    │  (ONE SkillsService class,          │
                    │   uses existing FSAdapter)          │
                    └─────────────────┬───────────────────┘
                                      │
    ┌─────────────────────────────────┼─────────────────────────────────┐
    │                                 │                                 │
    ▼                                 ▼                                 ▼
┌─────────┐                     ┌─────────┐                       ┌─────────┐
│   04    │                     │   05    │                       │   06    │
│ Trigger │                     │ Display │                       │Settings │
└────┬────┘                     └────┬────┘                       └────┬────┘
     │                               │                                 │
     │         ┌─────────────────────┼─────────────────────────────────┘
     │         │                     │
     │         │                     ▼
     │         │         ┌───────────────────────────┐
     │         │         │  07-agent-injection       │
     │         │         │  (uses same SkillsService)│
     │         │         └─────────────┬─────────────┘
     │         │                       │
     └─────────┼───────────────────────┘
               │
               ▼
    ┌───────────────────────────┐
    │  08-integration-testing   │
    └───────────────────────────┘
```

**Key Architecture Point:**
- **ONE `SkillsService` class** with all business logic (discovery, parsing, priority ordering)
- **`FilesystemAdapter` interface** with two implementations (Node and Tauri)
- The service is instantiated with different adapters in different environments
- **NO duplicate discovery/parsing logic** between frontend and agent

**Parallelization Summary:**
- **01 → 02 → 03** must run sequentially (foundation)
- **04, 05, 06, 07** can all run in parallel after 03
- **08** waits for everything

**Estimated parallel tracks:** 4 concurrent tracks possible after 03
