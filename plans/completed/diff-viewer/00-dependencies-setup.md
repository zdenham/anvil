# Phase 0: Dependencies & Setup

## Overview

Install and configure the npm dependencies needed for the diff viewer component.

## Tasks

### 0.1 Install npm dependencies

```bash
pnpm add shiki
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `shiki` | Syntax highlighting with VS Code grammar accuracy |
| `react-virtuoso` | Virtualized rendering for large files (>1000 lines) - **already installed** |

## Why These Dependencies

### Shiki

- Uses VS Code's TextMate grammars (accurate highlighting)
- Supports 100+ languages out of the box
- Dark themes that match our UI
- Well-maintained and widely used

### react-virtuoso (existing)

- Already used in the codebase - no additional bundle size
- Efficient windowed rendering for large lists
- Only renders visible items plus overscan
- Smooth scrolling with dynamic item heights
- Simple API with `<Virtuoso />` component

## Completion Criteria

- [ ] shiki installed and in `package.json`
- [ ] No version conflicts with existing dependencies
- [ ] Build succeeds with new dependency
