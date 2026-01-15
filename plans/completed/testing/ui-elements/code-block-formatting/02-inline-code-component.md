# Sub-Plan: InlineCode Component

## Overview

Create a simple styled component for inline `code` elements in markdown.

## Dependencies

- **None** - This is a standalone presentational component.

## Parallel Execution Group

**Group 1** - Can execute in parallel with `01-use-code-highlight-hook.md`

## Scope

### File to Create

`src/components/thread/inline-code.tsx` (~20 lines)

### Interface

```typescript
interface InlineCodeProps {
  children: React.ReactNode;
  className?: string;
}
```

### Styling Requirements

- Use existing prose styles: `prose-code:text-amber-400`
- Add subtle background: `bg-zinc-800/50 px-1 py-0.5 rounded`
- Remove default backticks: `before:content-none after:content-none`

### Reference Files

- Existing prose styles in the codebase
- Other simple presentational components in `src/components/thread/`

## Tests

### File to Create

`src/components/thread/inline-code.ui.test.tsx`

### Test Cases

1. Renders children as code element
2. Applies custom className when provided
3. Has correct base styling classes

## Acceptance Criteria

- [ ] Component exports `InlineCode` function
- [ ] Renders a `<code>` element with children
- [ ] Applies consistent styling for inline code
- [ ] Accepts optional className prop
- [ ] All UI tests pass via `pnpm test:ui`
- [ ] TypeScript compiles without errors

## Export Updates

After creating this component, update `src/components/thread/index.ts` to export it:

```typescript
export { InlineCode } from "./inline-code";
```

## Estimated Lines

~20 lines for implementation + ~20 lines for tests
