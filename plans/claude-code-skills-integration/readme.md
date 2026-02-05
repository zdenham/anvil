# Claude Code Skills Integration

## Overview

Integrate Claude Code skills and legacy commands into Mort, enabling users to define custom capabilities that extend agent functionality via `/skill-name` invocation.

## Phases

- [ ] Foundation types and interfaces (01, 02)
- [ ] Skills entity implementation (03)
- [ ] Parallel UI and agent work (04, 05, 06, 07)
- [ ] Integration and testing (08)

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

### Track C: Agent (Parallel after Track A)

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [07-agent-injection](./07-agent-injection.md) | System prompt injection at agent level | 01 |

### Track D: Integration

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [08-integration-testing](./08-integration-testing.md) | End-to-end testing and polish | 04, 05, 06, 07 |

---

## Execution Strategy

```
                    ┌─────────────────────────────────────┐
                    │  01-types-foundation                │
                    │  (Core types + Adapter interfaces)  │
                    └─────────────────┬───────────────────┘
                                      │
                    ┌─────────────────┴───────────────────┐
                    │                                     │
                    ▼                                     ▼
    ┌───────────────────────────┐         ┌───────────────────────────┐
    │  02-skills-store          │         │  07-agent-injection       │
    │  (Zustand store)          │         │  (Can start with types)   │
    └─────────────┬─────────────┘         └───────────────────────────┘
                  │                                     │
                  ▼                                     │
    ┌───────────────────────────┐                      │
    │  03-skills-service        │                      │
    │  (Discovery via FS)       │                      │
    └─────────────┬─────────────┘                      │
                  │                                     │
    ┌─────────────┼─────────────┬─────────────────────┘
    │             │             │
    ▼             ▼             ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│   04    │ │   05    │ │   06    │
│ Trigger │ │ Display │ │Settings │
└────┬────┘ └────┬────┘ └────┬────┘
     │           │           │
     └───────────┼───────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │  08-integration-testing   │
    └───────────────────────────┘
```

**Parallelization Summary:**
- **01** must complete first (all types)
- **02 + 07** can run in parallel after 01
- **03** needs 02
- **04, 05, 06** can all run in parallel after 03
- **08** waits for everything

**Estimated parallel tracks:** 3 concurrent tracks possible after foundation
