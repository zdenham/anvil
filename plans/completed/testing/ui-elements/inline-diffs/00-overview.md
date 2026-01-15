# Inline Diffs Implementation - Sub-Plans Overview

## Summary

This directory contains the breakdown of the inline diffs feature into parallelizable sub-plans. The original plan at `../inline-diffs.md` has been decomposed to enable efficient parallel execution.

## Sub-Plans

| File | Description | Dependencies |
|------|-------------|--------------|
| `01-diff-extraction-utilities.md` | Utility functions for extracting/generating diffs | None |
| `02-inline-diff-components.md` | React components: InlineDiffBlock, Header, Actions | 01 |
| `03-keyboard-navigation.md` | useInlineDiffKeyboard hook | None |
| `04-tooluse-block-integration.md` | Modify ToolUseBlock to render diffs | 01, 02 |
| `05-test-ids-and-queries.md` | Test IDs and query helpers | None |
| `06-ui-tests.md` | Comprehensive UI tests | 01, 02, 03, 04, 05 |
| `07-permission-system-integration.md` | Event types and state extensions | External (permission-prompts.md) |

## Dependency Graph

```
                    ┌─────────────────────┐
                    │       NONE          │
                    └─────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌───────────┐       ┌───────────┐       ┌───────────┐
    │    01     │       │    03     │       │    05     │
    │  Diff     │       │ Keyboard  │       │ Test IDs  │
    │ Utilities │       │   Hook    │       │           │
    └───────────┘       └───────────┘       └───────────┘
          │                   │                   │
          ▼                   │                   │
    ┌───────────┐             │                   │
    │    02     │◄────────────┘                   │
    │Components │                                 │
    └───────────┘                                 │
          │                                       │
          ▼                                       │
    ┌───────────┐                                 │
    │    04     │                                 │
    │Integration│                                 │
    └───────────┘                                 │
          │                                       │
          ▼                                       ▼
    ┌─────────────────────────────────────────────────┐
    │                      06                         │
    │                   UI Tests                      │
    └─────────────────────────────────────────────────┘

    ┌───────────┐
    │    07     │ ← Depends on external permission-prompts.md
    │ Permission│   Can be executed in parallel
    │ System    │
    └───────────┘
```

## Parallel Execution Strategy

### Wave 1 (Start Immediately - No Dependencies)
- `01-diff-extraction-utilities.md`
- `03-keyboard-navigation.md`
- `05-test-ids-and-queries.md`
- `07-permission-system-integration.md` (if permission-prompts.md is complete)

### Wave 2 (After Wave 1 Completes)
- `02-inline-diff-components.md` (needs 01)

### Wave 3 (After Wave 2 Completes)
- `04-tooluse-block-integration.md` (needs 01, 02)

### Wave 4 (After All Implementation Complete)
- `06-ui-tests.md` (needs all implementation sub-plans)

## Estimated Effort

| Sub-Plan | Lines of Code | Estimated Time |
|----------|---------------|----------------|
| 01 | ~200 (utility + tests) | 1-2 hours |
| 02 | ~260 (3 components) | 2-3 hours |
| 03 | ~230 (hook + tests) | 1-2 hours |
| 04 | ~100 (modifications) | 1-2 hours |
| 05 | ~50 (additions) | 30 min |
| 06 | ~450 (3 test files) | 2-3 hours |
| 07 | ~50 (type additions) | 30 min |

**Total:** ~1340 lines, 8-13 hours

## File Structure After Completion

```
src/components/thread/
  inline-diff-block.tsx           # 02
  inline-diff-header.tsx          # 02
  inline-diff-actions.tsx         # 02
  use-inline-diff-keyboard.ts     # 03
  use-inline-diff-keyboard.test.ts # 03
  inline-diff-block.ui.test.tsx   # 06
  tool-use-block.tsx              # 04 (modified)
  tool-use-block.ui.test.tsx      # 06
  thread-with-diffs.ui.test.tsx   # 06

src/lib/utils/
  diff-extractor.ts               # 01
  diff-extractor.test.ts          # 01
  index.ts                        # 01 (modified)

src/test/helpers/
  queries.ts                      # 05 (modified)

core/types/
  events.ts                       # 07 (modified)
```

## Verification Checklist

After all sub-plans are complete:

```bash
# Run all tests
pnpm test

# Run UI isolation tests
pnpm test:ui

# Type check
pnpm tsc --noEmit

# Manual verification
# 1. Start dev server
# 2. Trigger Edit tool in a thread
# 3. Verify inline diff appears
# 4. Test keyboard navigation
# 5. Test accept/reject (if permission-prompts enabled)
```
