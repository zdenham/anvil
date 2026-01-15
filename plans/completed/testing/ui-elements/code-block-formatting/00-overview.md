# Code Block Formatting - Parallel Execution Overview

## Summary

This folder contains sub-plans for implementing markdown rendering with syntax-highlighted code blocks, copy buttons, and collapsible long blocks.

## Parallel Execution Groups

```
Group 1 (No Dependencies - Start Immediately)
  +-- 01-use-code-highlight-hook.md
  +-- 02-inline-code-component.md
        |
        v
Group 2 (Depends on Group 1)
  +-- 03-code-block-component.md (depends on 01)
        |
        v
Group 3 (Depends on Group 2)
  +-- 04-markdown-renderer-component.md (depends on 02, 03)
        |
        v
Group 4 (Depends on Group 3)
  +-- 05-text-block-integration.md (depends on 04)
        |
        v
Group 5 (Optional - Defer)
  +-- 06-keyboard-navigation-optional.md (depends on 03, 05)
```

## Dependency Graph

```
01-use-code-highlight-hook ─────────┐
                                    ├──> 03-code-block ──┐
02-inline-code-component ───────────┼────────────────────┼──> 04-markdown-renderer ──> 05-text-block-integration
                                    │                    │
                                    └────────────────────┘
                                                                        │
                                                                        v
                                                            06-keyboard-navigation (optional)
```

## Execution Strategy

### Phase 1: Foundation (Parallel)
Execute simultaneously:
- `01-use-code-highlight-hook.md` - Create the highlighting hook
- `02-inline-code-component.md` - Create the inline code component

### Phase 2: Main Component
After Phase 1 completes:
- `03-code-block-component.md` - Create the code block component

### Phase 3: Renderer
After Phase 2 completes:
- `04-markdown-renderer-component.md` - Create the markdown renderer

### Phase 4: Integration
After Phase 3 completes:
- `05-text-block-integration.md` - Integrate into existing TextBlock

### Phase 5: Enhancement (Optional)
After Phase 4 completes:
- `06-keyboard-navigation-optional.md` - Add keyboard navigation

## Files Created/Modified

| Sub-Plan | Files | Type |
|----------|-------|------|
| 01 | `src/hooks/use-code-highlight.ts` | New |
| 01 | `src/hooks/use-code-highlight.test.ts` | New |
| 02 | `src/components/thread/inline-code.tsx` | New |
| 02 | `src/components/thread/inline-code.ui.test.tsx` | New |
| 03 | `src/components/thread/code-block.tsx` | New |
| 03 | `src/components/thread/code-block.ui.test.tsx` | New |
| 03 | `src/components/thread/code-block-edge-cases.ui.test.tsx` | New |
| 04 | `src/components/thread/markdown-renderer.tsx` | New |
| 04 | `src/components/thread/markdown-renderer.ui.test.tsx` | New |
| 05 | `src/components/thread/text-block.tsx` | Modified |
| 05 | `src/components/thread/text-block.ui.test.tsx` | New |
| 06 | `src/hooks/use-code-block-keyboard.ts` | New (Optional) |
| 06 | `src/hooks/use-code-block-keyboard.test.ts` | New (Optional) |

## Estimated Timeline

| Phase | Sub-Plans | Parallelizable | Estimated Time |
|-------|-----------|----------------|----------------|
| 1 | 01, 02 | Yes | 30 min |
| 2 | 03 | No | 45 min |
| 3 | 04 | No | 30 min |
| 4 | 05 | No | 20 min |
| 5 | 06 | No (Optional) | 30 min |

**Total (excluding optional):** ~2 hours
**Total (with optional):** ~2.5 hours

## Pre-Implementation Verification

Before starting implementation, verify that the required icons are available:

```bash
# Check lucide-react is installed
pnpm list lucide-react

# Verify required icons exist (in code or by checking imports elsewhere)
# Required icons: Copy, Check, ChevronUp, ChevronDown
```

If lucide-react is not installed:
```bash
pnpm add lucide-react
```

## Verification Commands

After each sub-plan:
```bash
pnpm test:ui  # Run UI tests
pnpm tsc --noEmit  # Type check
```

After all sub-plans:
```bash
pnpm test  # Run all tests
pnpm build  # Verify build
# Manual testing in running app
```

## Critical Reference Files

| File | Purpose |
|------|---------|
| `src/lib/syntax-highlighter.ts` | Shiki setup, `highlightCode()` |
| `src/components/diff-viewer/highlighted-line.tsx` | Token rendering pattern |
| `src/components/thread/thinking-block.tsx` | Collapsible pattern |
| `src/components/thread/tool-use-block.tsx` | Complex collapsible pattern |
| `src/hooks/use-reduced-motion.ts` | Hook structure pattern |
| `src/components/spotlight/spotlight.tsx` | Clipboard pattern |
