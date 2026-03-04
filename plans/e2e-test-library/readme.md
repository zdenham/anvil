# E2E Test Library — Parallel Execution Plan

Parent plan: [`plans/e2e-test-library.md`](../e2e-test-library.md)

## Dependency Graph

```
Wave 1 (parallel):  [A: Foundation]        [F: Config & Scripts]
                          │
                          ▼
Wave 2:             [B: Page Objects & Fixtures]
                     │         │          │
                     ▼         ▼          ▼
Wave 3 (parallel): [C: Critical] [D: Core] [E: Comprehensive]
```

## Subplans

| ID | Name | File | Depends On | Est. Effort |
|----|------|------|------------|-------------|
| A | Foundation Helpers | [a-foundation.md](a-foundation.md) | — | Small |
| B | Page Objects & Fixtures | [b-page-objects.md](b-page-objects.md) | A | Medium |
| C | Critical Tests | [c-critical.md](c-critical.md) | B | Small |
| D | Core Workflow Tests | [d-core.md](d-core.md) | B | Medium |
| E | Comprehensive Tests | [e-comprehensive.md](e-comprehensive.md) | B | Medium |
| F | Config & Runner Scripts | [f-config.md](f-config.md) | — | Small |

## Execution Strategy

**Wave 1** — Launch A and F in parallel. No dependencies between them.
- A builds `repo-harness.ts` and enhances `wait-helpers.ts`
- F updates `playwright.config.ts` and `package.json` scripts

**Wave 2** — Launch B after A completes. F can still be running.
- B creates all 4 page objects + `fixtures.ts`, consuming helpers from A

**Wave 3** — Launch C, D, E in parallel after B completes.
- Each writes test specs for its tier using the page objects from B
- These are fully independent and can run simultaneously

## Phases

- [x] Wave 1: Foundation helpers (A) + Config/scripts (F)
- [x] Wave 2: Page objects & fixtures (B)
- [x] Wave 3: Critical (C) + Core (D) + Comprehensive (E) tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## What Already Exists

- `e2e/lib/test-ids.ts` — barrel re-export ✅
- `e2e/lib/wait-helpers.ts` — `waitForTestId`, `waitForWsReady`, `waitForAppReady`, `invokeWsCommand` ✅
- `e2e/critical/hello-world.spec.ts` — 3 passing tests ✅
- `e2e/smoke.spec.ts` — 3 tests (to be migrated into critical/)
- `e2e/thread-navigation.spec.ts` — 4 tests (to be migrated into critical/)
- `src/test/test-ids.ts` — 180+ test IDs ✅
- `playwright.config.ts` — basic single-project config
