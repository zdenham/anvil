# Sub-Plan: Keyboard Navigation (Optional Enhancement)

## Overview

Create a hook for keyboard navigation between code blocks. This is marked as optional and can be deferred.

## Dependencies

- **Requires:** `03-code-block-component.md` (code blocks must exist)
- **Requires:** `05-text-block-integration.md` (integration must be complete)

## Parallel Execution Group

**Group 5 (Optional)** - Only implement if keyboard navigation is a priority

## Scope

### File to Create

`src/hooks/use-code-block-keyboard.ts` (~40 lines)

### Interface

```typescript
export function useCodeBlockKeyboard(
  containerRef: React.RefObject<HTMLElement>
): void
```

### Functionality

1. Handle Tab to focus next code block
2. Handle Cmd+C to copy focused block
3. Handle Enter/Space to toggle collapse

### Implementation Details

- Attach keyboard listeners to container ref
- Track currently focused code block
- Implement focus cycling through code blocks
- Integrate with copy and collapse functionality

## Tests

### File to Create

`src/hooks/use-code-block-keyboard.test.ts`

### Test Cases

1. Tab moves focus to next code block
2. Shift+Tab moves focus to previous code block
3. Cmd+C copies focused code block
4. Enter/Space toggles collapse on focused block
5. Focus cycling wraps around

## Focus Ring Styling Specification

When a code block receives keyboard focus, apply a visible focus ring:

```css
/* Tailwind classes for focus state */
focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:ring-offset-2 focus:ring-offset-zinc-900
```

**Requirements:**
- Use a semi-transparent amber color to match the code theme (`ring-amber-500/50`)
- Add ring offset to prevent the ring from touching the border (`ring-offset-2`)
- Set offset color to match the background (`ring-offset-zinc-900`)
- Ensure focus ring is visible on both light and dark backgrounds
- Focus ring should appear on the entire CodeBlock container, not individual elements

**Implementation in CodeBlock:**
Add `tabIndex={0}` to the root container and apply focus styles:

```tsx
<div
  className="relative group rounded-lg border border-zinc-800 bg-zinc-900
             focus:outline-none focus:ring-2 focus:ring-amber-500/50
             focus:ring-offset-2 focus:ring-offset-zinc-900"
  tabIndex={0}
>
```

## Acceptance Criteria

- [ ] Hook handles Tab navigation between blocks
- [ ] Hook handles Cmd+C for copy
- [ ] Hook handles Enter/Space for collapse toggle
- [ ] Focus is visually indicated with amber focus ring
- [ ] Focus ring has proper offset from code block border
- [ ] All tests pass
- [ ] TypeScript compiles without errors

## Decision Point

Before implementing this sub-plan, evaluate:
- Is keyboard navigation a user priority?
- Are there other higher-priority features?
- Does the current mouse-based interaction suffice?

**Recommendation:** Defer until core functionality (sub-plans 01-05) is complete and validated.

## Estimated Lines

~40 lines for implementation + ~50 lines for tests
