# Agent Harness Testing Framework

This directory contains sub-plans for implementing a test harness that enables automated testing of Mort agents. The framework provides isolated test environments, subprocess management, and structured output capture for verifying agent behavior.

## Overview

The Agent Harness Testing Framework addresses a core challenge: testing agents that run as subprocesses with complex orchestration logic. The framework provides:

- **Isolated test environments** - Temporary mort directories and git repositories
- **Subprocess management** - Spawn agents, capture structured output, handle timeouts
- **Assertion helpers** - Verify agent output, file changes, and git state
- **Unified runner** - Single entry point for all agent types (research, execution, merge, simple)

## Dependency Graph

```
                                    ┌──────────────────┐
                                    │  00f-vitest      │ ◄── Can run anytime
                                    │     config       │
                                    └──────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 0: RUNNER UNIFICATION                         │
│                              (Prerequisite Block)                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   ┌──────────────┐                                                           │
│   │ 00a-runner   │                                                           │
│   │    types     │                                                           │
│   └──────┬───────┘                                                           │
│          │                                                                    │
│          ▼                                                                    │
│   ┌──────────────┐                                                           │
│   │ 00b-shared   │                                                           │
│   │  extraction  │                                                           │
│   └──────┬───────┘                                                           │
│          │                                                                    │
│     ┌────┴────┐         ◄── PARALLEL                                         │
│     ▼         ▼                                                               │
│ ┌────────┐ ┌────────┐                                                        │
│ │  00c   │ │  00d   │                                                        │
│ │  task  │ │ simple │                                                        │
│ │strategy│ │strategy│                                                        │
│ └────┬───┘ └───┬────┘                                                        │
│      │         │                                                              │
│      └────┬────┘                                                              │
│           ▼                                                                   │
│    ┌──────────────┐                                                          │
│    │ 00e-unified  │                                                          │
│    │ entry point  │                                                          │
│    └──────┬───────┘                                                          │
│           │                                                                   │
│           ▼                                                                   │
│    ┌──────────────┐                                                          │
│    │ 00g-cleanup  │                                                          │
│    │ old runners  │                                                          │
│    └──────────────┘                                                          │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          PHASE 1: TEST SERVICES                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│              ┌──────────────┐                                                │
│              │ 01a-test     │                                                │
│              │    types     │                                                │
│              └──────┬───────┘                                                │
│                     │                                                         │
│                ┌────┴────┐      ◄── PARALLEL                                 │
│                ▼         ▼                                                    │
│          ┌────────┐ ┌────────┐                                               │
│          │  01b   │ │  01c   │                                               │
│          │  mort  │ │  repo  │                                               │
│          │  dir   │ │service │                                               │
│          └────┬───┘ └───┬────┘                                               │
│               │         │                                                     │
│               └────┬────┘                                                     │
│                    ▼                                                          │
│             ┌──────────────┐                                                 │
│             │ 01d-services │                                                 │
│             │    index     │                                                 │
│             └──────────────┘                                                 │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          PHASE 2: CORE HARNESS                                │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│        ┌──────────────┐      ┌──────────────┐                                │
│        │ 02a-runner   │      │    02c       │    ◄── PARALLEL               │
│        │   config     │      │ assertions   │        (02c depends on 01a)   │
│        └──────┬───────┘      └──────┬───────┘                                │
│               │                     │                                         │
│               └─────────┬───────────┘                                        │
│                         ▼                                                     │
│                  ┌──────────────┐                                            │
│                  │ 02b-agent    │                                            │
│                  │   harness    │                                            │
│                  └──────┬───────┘                                            │
│                         │                                                     │
│                         ▼                                                     │
│                  ┌──────────────┐                                            │
│                  │ 02d-testing  │                                            │
│                  │    index     │                                            │
│                  └──────────────┘                                            │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            PHASE 3: TESTS                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│             ┌──────────────┐                                                 │
│             │ 03a-harness  │                                                 │
│             │  self-test   │                                                 │
│             └──────┬───────┘                                                 │
│                    │                                                          │
│                    ▼                                                          │
│             ┌──────────────┐                                                 │
│             │ 03b-agent    │                                                 │
│             │   tests      │                                                 │
│             └──────────────┘                                                 │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         OPTIONAL / FUTURE                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│     ┌──────────────┐        ┌──────────────┐                                 │
│     │ 04-mock-llm  │        │05-benchmarks │    ◄── PARALLEL (optional)     │
│     │  (optional)  │        │   (future)   │                                 │
│     └──────────────┘        └──────────────┘                                 │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Execution Order

### Phase Dependencies

Each phase must complete before the next can begin:

1. **Phase 0** (Runner Unification) - Creates the unified runner infrastructure
2. **Phase 1** (Test Services) - Builds isolated test environment services
3. **Phase 2** (Core Harness) - Implements the main test harness class
4. **Phase 3** (Tests) - Validates the framework and tests agents

Within Phase 3, `03a` (harness self-test) must pass before `03b` (agent tests) begins.

### Parallel Execution Opportunities

| Phase | Parallel Tasks | Notes |
|-------|----------------|-------|
| 0 | `00f` can run anytime; `00c` + `00d` together after `00b` | Vitest config is independent |
| 1 | `01b` + `01c` together after `01a` | Both depend only on test types |
| 2 | `02a` + `02c` together | `02c` depends on `01a`, not `02a` |
| Optional | `04` + `05` together after Phase 3 | Both are independent extensions |

## Sub-Plan Reference

### Phase 0: Runner Unification (Prerequisite)

| File | Description | Dependencies |
|------|-------------|--------------|
| `00a-runner-types.md` | `RunnerStrategy` interface and core types | None |
| `00b-runner-shared-extraction.md` | Extract shared code from existing runners | 00a |
| `00c-task-runner-strategy.md` | `TaskRunnerStrategy` implementation | 00b |
| `00d-simple-runner-strategy.md` | `SimpleRunnerStrategy` implementation | 00b |
| `00e-unified-entry-point.md` | Unified `runner.ts` entry point | 00c, 00d |
| `00f-vitest-config.md` | Add vitest configuration to agents package | None |
| `00g-cleanup-old-runners.md` | Remove deprecated runner files | 00e |

### Phase 1: Test Services

| File | Description | Dependencies |
|------|-------------|--------------|
| `01a-test-types.md` | Testing type definitions (`AgentRunOutput`, etc.) | Phase 0 |
| `01b-test-mort-directory.md` | `TestMortDirectory` service for isolated mort dirs | 01a |
| `01c-test-repository.md` | `TestRepository` service for git test fixtures | 01a |
| `01d-services-index.md` | Barrel exports for test services | 01b, 01c |

### Phase 2: Core Harness

| File | Description | Dependencies |
|------|-------------|--------------|
| `02a-runner-config.md` | Runner configuration for test harness | Phase 1 |
| `02b-agent-harness.md` | `AgentTestHarness` class | 02a, 02c |
| `02c-assertions.md` | Assertion helper functions | 01a |
| `02d-testing-index.md` | Barrel exports for testing module | 02b, 02c |

### Phase 3: Tests

| File | Description | Dependencies |
|------|-------------|--------------|
| `03a-harness-self-test.md` | Framework verification tests | Phase 2 |
| `03b-agent-acceptance-tests.md` | Agent behavior acceptance tests | 03a |

### Optional / Future

| File | Description | Dependencies |
|------|-------------|--------------|
| `04-mock-llm.md` | Mock LLM support for deterministic tests | Phase 3 |
| `05-benchmarks.md` | Performance benchmark infrastructure | Phase 3 |

## Estimated Effort

| Phase | Effort | On Critical Path |
|-------|--------|------------------|
| Phase 0 | 8-10 hours | Yes |
| Phase 1 | 3-4 hours | Yes |
| Phase 2 | 4-5 hours | Yes |
| Phase 3 | 4-6 hours | Yes |
| Optional | 4-6 hours | No |
| **Total** | **23-31 hours** | |

## Getting Started

1. **Start with `00f-vitest-config.md`** - This has no dependencies and can run immediately in parallel with other work.

2. **Begin Phase 0 sequentially** - Start with `00a-runner-types.md`, then `00b-runner-shared-extraction.md`.

3. **Parallelize strategy implementations** - After completing `00b`, work on `00c` and `00d` simultaneously.

4. **Complete each phase before advancing** - The phases are designed as prerequisite blocks. Do not start Phase 1 until all Phase 0 tasks are complete.

5. **Exploit parallel opportunities** - Within each phase, refer to the parallel execution table above to maximize throughput.
