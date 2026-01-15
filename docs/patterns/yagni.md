# YAGNI: You Aren't Gonna Need It

Delete dead code aggressively. No exceptions.

## Why This Matters

Dead code has real costs:

1. **Agents get confused** - AI agents read and reason about all code in the codebase. Dead code pollutes their context, leading to incorrect assumptions and wasted effort.
2. **Humans get confused** - Developers waste time understanding code paths that never execute.
3. **False dependencies** - Dead code may reference other modules, making refactoring seem harder than it is.
4. **Stale patterns** - Old code teaches outdated patterns that get copied into new code.

In an agentic codebase, the cost multiplies. Every unnecessary line increases the chance an agent will misunderstand the system.

## The Rule

**If code is not called, delete it.**

Not "comment it out." Not "mark it deprecated." Delete it. Git remembers everything.

## What Counts as Dead Code

- Unused functions, classes, or components
- Commented-out code blocks
- Exports that nothing imports
- Feature flags that are always on/off
- Deprecated code marked "remove later"
- Unused variables, parameters, or imports
- Speculative features ("we might need this someday")

## Enforcement

TypeScript catches some of this automatically:

```json
// tsconfig.json
{
  "compilerOptions": {
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

But tooling only catches local issues. You must actively hunt for unused exports, dead components, and orphaned modules.

## Do

```typescript
// Function is used - keep it
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

```typescript
// Need to refactor? Delete the old code, write the new code
// Don't keep both around "just in case"
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
```

## Don't

```typescript
// BAD: Commented code "for reference"
// function oldCalculateTotal(items) {
//   let total = 0;
//   for (const item of items) {
//     total += item.price;
//   }
//   return total;
// }

export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

```typescript
// BAD: Deprecated but not deleted
/** @deprecated Use calculateTotal instead. Kept for backwards compatibility. */
export function getTotal(items: Item[]): number {
  return calculateTotal(items);
}
```

```typescript
// BAD: Speculative features
export function calculateTotalWithDiscount(items: Item[], discount: number): number {
  // We might need discounts later!
  return calculateTotal(items) * (1 - discount);
}
// ^ If nothing calls this, delete it. Add it back when you actually need it.
```

```typescript
// BAD: Unused exports sitting in a barrel file
export { useReducedMotion } from './use-reduced-motion';  // Nothing imports this
export { useRelativeTime } from './use-relative-time';    // Nothing imports this
```

## When to Delete

- **During refactoring** - If you change a function signature and nothing breaks, check if anything actually calls it
- **After feature removal** - When removing a feature, trace all related code and delete it
- **During code review** - Call out unused code in PRs
- **Regularly** - Periodically grep for `@deprecated`, `TODO.*remove`, and unused exports

## But What If We Need It Later?

You won't. And if you do, `git log` has it.

The cost of re-implementing code when needed is almost always lower than the ongoing cost of maintaining dead code. Dead code:
- Must be read and understood by agents and humans
- Must be kept compiling through refactors
- Creates false confidence that functionality exists

## Exceptions

There are almost none. The only acceptable cases:

1. **Public API stability** - If external consumers depend on an export, deprecation periods are reasonable. But set a deadline and delete it.
2. **Tests for edge cases** - Tests that exercise error paths are not dead code, even if the error path rarely executes.

Everything else? Delete it.

## Related

- [agents.md](/docs/agents.md) - General coding practices
- [tech-debt-assessment.md](/plans/tech-debt-assessment.md) - Current dead code inventory
