# Agent Mode Implementation - Sub-Plans Overview

## Summary

This directory contains sub-plans broken down from the main `agent-mode.md` plan, optimized for parallel execution.

## Sub-Plan Index

| # | Sub-Plan | Description | Est. Time |
|---|----------|-------------|-----------|
| 01 | [Core Types](./01-core-types.md) | AgentMode type in core/types/ | 5 min |
| 02 | [Entity Types & Store](./02-entity-types-and-store.md) | Types, config, Zustand store | 30 min |
| 03 | [UI Components](./03-ui-components.md) | ModeIndicator, useModeKeyboard hook | 45 min |
| 04 | [Agent Integration](./04-agent-integration.md) | CLI argument parsing in agent runner | 30 min |
| 05 | [SimpleTask Integration](./05-simple-task-integration.md) | Header indicator integration | 30 min |
| 06 | [ThreadInput Integration](./06-thread-input-integration.md) | Input keyboard shortcut integration | 30 min |
| 07 | [Agent Service Wiring](./07-agent-service-wiring.md) | Connect UI state to agent process | 20 min |
| 08 | [Testing](./08-testing.md) | Comprehensive test plan | 2-3 hrs |

## Dependency Graph

```
                    ┌─────────────┐
                    │ 01 - Core   │
                    │   Types     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
    ┌─────────────┐  ┌─────────────┐
    │ 02 - Entity │  │ 04 - Agent  │
    │ Types/Store │  │ Integration │
    └──────┬──────┘  └──────┬──────┘
           │                │
           │                │
           ▼                │
    ┌─────────────┐         │
    │ 03 - UI     │         │
    │ Components  │         │
    └──────┬──────┘         │
           │                │
      ┌────┴────┐           │
      │         │           │
      ▼         ▼           │
┌─────────┐ ┌─────────┐     │
│ 05 -    │ │ 06 -    │     │
│ Header  │ │ Input   │     │
└────┬────┘ └────┬────┘     │
     │           │          │
     └─────┬─────┘          │
           │                │
           ▼                ▼
         ┌─────────────────────┐
         │   07 - Agent        │
         │   Service Wiring    │
         └──────────┬──────────┘
                    │
                    ▼
              ┌───────────┐
              │ 08 -      │
              │ Testing   │
              └───────────┘
```

## Parallel Execution Strategy

### Wave 1 (Start immediately)
- **01-core-types.md** - Foundation, no dependencies

### Wave 2 (After 01 completes)
- **02-entity-types-and-store.md** - Depends on 01
- **04-agent-integration.md** - Depends on 01 (can run in parallel with 02)

### Wave 3 (After 02 completes)
- **03-ui-components.md** - Depends on 02

### Wave 4 (After 03 completes)
- **05-simple-task-integration.md** - Depends on 02, 03
- **06-thread-input-integration.md** - Depends on 02, 03 (can run in parallel with 05)

### Wave 5 (After 04, 05, 06 complete) - CONVERGENCE POINT
- **07-agent-service-wiring.md** - Depends on 02, 04
- This is where the two parallel tracks (Track A: UI components, Track B: Agent integration) converge
- All UI state management and agent CLI infrastructure must be complete before this wave

### Wave 6 (After all complete)
- **08-testing.md** - Full test suite execution

## Maximum Parallelism

With sufficient resources, the following can be parallelized:

- **2 parallel tracks** after Wave 1:
  - Track A: 02 -> 03 -> 05 & 06
  - Track B: 04

- **2 parallel sub-plans** in Wave 4:
  - 05-simple-task-integration
  - 06-thread-input-integration

## Total Estimated Time

- **Sequential execution:** ~4-5 hours
- **With parallelism:** ~2.5-3 hours

## Files Created/Modified Summary

### New Files (7)
- `core/types/agent-mode.ts`
- `src/entities/agent-mode/types.ts`
- `src/entities/agent-mode/store.ts`
- `src/entities/agent-mode/index.ts`
- `src/components/simple-task/mode-indicator.tsx`
- `src/components/simple-task/use-mode-keyboard.ts`

### Modified Files (7)
- `core/types/index.ts`
- `src/components/simple-task/index.ts`
- `src/components/simple-task/simple-task-header.tsx`
- `src/components/simple-task/simple-task-window.tsx`
- `src/components/reusable/thread-input.tsx`
- `agents/src/runners/types.ts`
- `agents/src/runners/simple-runner-strategy.ts`
- `agents/src/runners/shared.ts`
- `src/lib/agent-service.ts`

### New Test Files (6)
- `src/entities/agent-mode/types.test.ts`
- `src/entities/agent-mode/store.test.ts`
- `src/components/simple-task/mode-indicator.ui.test.tsx`
- `src/components/simple-task/use-mode-keyboard.ui.test.tsx`
- `src/components/simple-task/simple-task-header.ui.test.tsx`
- `src/components/reusable/thread-input.ui.test.tsx`
