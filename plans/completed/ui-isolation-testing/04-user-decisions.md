# Sub-Plan: User Decisions Required

**Dependencies:** None
**Blocks:** Some test patterns in `05-first-tests.md`
**Type:** Discussion/Decision document
**Status:** Awaiting user input

## Purpose

This document captures four architectural decisions that require user input before finalizing certain test patterns. None of these decisions block initial implementation of the testing infrastructure, but they affect how tests are written and what they verify.

## Quick Summary

| # | Decision | Recommendation | Urgency | Default if no response |
|---|----------|----------------|---------|------------------------|
| 1 | Coverage configuration | C (separate command) | Low | Proceed with C |
| 2 | Entity listeners in tests | B (direct seeding) | Medium | Proceed with B |
| 3 | CSS/style testing | B (class assertions) | Low | Proceed with B |
| 4 | Test data factories | C (add later) | Low | Proceed with C |

---

## Decision 1: Coverage Configuration

### Context

The testing plan references coverage measurement but no configuration currently exists. This decision determines whether and how to track code coverage for UI tests.

### Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A** | Add coverage to `vitest.config.ui.ts` with enforced thresholds (e.g., 80%) | Enforces minimum coverage; prevents regressions | May slow CI; threshold is arbitrary; can incentivize low-value tests |
| **B** | Keep UI tests coverage-free; rely on unit tests for coverage metrics | Simpler; faster test runs | No visibility into what UI tests actually cover |
| **C** | Separate optional command (`test:ui:coverage`) without enforced thresholds | On-demand visibility; no CI overhead | Extra command to remember; may be forgotten |

### Recommendation

**Option C** - Provides coverage visibility for developers who want it without blocking CI or enforcing arbitrary thresholds. Can upgrade to Option A later if coverage becomes a priority.

### Implementation (if C chosen)

```json
// package.json
{
  "scripts": {
    "test:ui:coverage": "vitest run --config vitest.config.ui.ts --coverage"
  }
}
```

---

## Decision 2: Entity Listeners in Tests

### Context

`setupEntityListeners()` binds Tauri events to store update handlers (e.g., `task:updated` event triggers a disk read and store refresh). This is central to the "Disk as Truth" pattern documented in `docs/patterns/disk-as-truth.md`.

The question: should UI tests include this event-to-store binding, or bypass it entirely?

### Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A** | Call `setupEntityListeners()` in `setup-ui.ts` | Tests verify full data flow (event -> handler -> disk read -> store update) | Requires listener cleanup; slower; more moving parts |
| **B** | Skip entity listeners; seed stores directly via `TestStores` | Fast; simple; focused on component behavior | Doesn't test the event-to-store refresh path |
| **C** | Provide both patterns; let test authors choose | Maximum flexibility | Two mental models; harder to maintain consistency |

### Recommendation

**Option B** for initial tests. The event-to-store flow is an integration concern better tested via integration tests or a small number of dedicated event-flow tests. UI component tests should focus on "given this store state, does the component render correctly?"

Consider revisiting Option A or C later if event handling bugs slip through.

### Trade-off Clarity

- **Option A tests:** "When a `task:updated` event fires, does the UI eventually show the new title?"
- **Option B tests:** "When the store contains a task with title X, does the TaskCard show X?"

Option B has a narrower scope but faster feedback loops.

---

## Decision 3: CSS/Style Testing Strategy

### Context

Happy-dom (the DOM environment used for UI tests) has limited CSS support. Computed styles may not reflect actual browser behavior. This affects how we verify visual states like "error styling" or "loading state."

### Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A** | Skip style assertions entirely; test behavior only | Simple; reliable; no false negatives | No verification of visual states |
| **B** | Use CSS class assertions (`toHaveClass()`) | Reasonable proxy for visual state; works well with Tailwind | Classes may not fully reflect computed styles |
| **C** | Accept limitations; add visual regression tests separately (e.g., Playwright screenshots) | Complete visual coverage | Significant additional infrastructure |

### Recommendation

**Option B** - Class-based assertions are a pragmatic middle ground. With Tailwind, classes directly encode visual intent (`bg-red-500` means error, `opacity-50` means disabled). This approach catches styling regressions without requiring full browser rendering.

### Example

```typescript
// Instead of checking computed styles (unreliable in happy-dom)
expect(button).toHaveClass("bg-red-500");    // error state
expect(button).toHaveClass("opacity-50");    // disabled state
expect(button).toHaveClass("animate-pulse"); // loading state
```

### Future Consideration

If visual bugs slip through, add a small Playwright visual regression suite for critical screens rather than trying to fix happy-dom limitations.

---

## Decision 4: Test Data Factories

### Context

As tests grow, manually constructing full entity objects (`ThreadMetadata`, `TaskMetadata`, etc.) becomes tedious and repetitive. Factory functions can reduce boilerplate but add abstraction.

### Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A** | Add factory helpers now (e.g., `createThread()`, `createTask()`) | Clean tests from day one; consistent defaults | Upfront work before tests exist |
| **B** | Keep manual object construction | No abstraction overhead; explicit data in each test | Verbose; copy-paste prone; defaults scattered |
| **C** | Add factories after ~20 tests when pain is felt | Just-in-time investment; factories match real usage | Some tech debt then cleanup pass |

### Recommendation

**Option C** - Start with manual construction. Once patterns emerge (repeated defaults, common scenarios), extract factories. This ensures factories solve real problems rather than imagined ones.

### Example Factory (for later reference)

```typescript
// src/test/factories/thread.ts
import type { ThreadMetadata } from "@/types";

export function createThread(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  return {
    id: `thread-${crypto.randomUUID()}`,
    taskId: "task-default",
    agentType: "execution",
    workingDirectory: "/Users/test/worktrees/default",
    status: "idle",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [],
    ...overrides,
  };
}

// Usage
const thread = createThread({ status: "running", taskId: "task-123" });
```

---

## How to Respond

**Option 1: Accept all recommendations**
Reply: "Proceed with recommendations" or simply approve this document.

**Option 2: Override specific decisions**
Reply with your choices, e.g.:
> - Decision 1: A (enforce thresholds)
> - Decision 2: C (provide both patterns)
> - Others: use recommendations

**Option 3: Request clarification**
Ask questions about any decision before choosing.

## Default Behavior

If no response is received within a reasonable timeframe, implementation will proceed with the recommended options (C, B, B, C). All decisions are reversible with minimal effort.
