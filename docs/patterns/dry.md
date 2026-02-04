# DRY: Don't Repeat Yourself (But Don't Pre-Optimize)

Consolidate existing duplication. Don't create abstractions for code that doesn't exist yet.

## The Nuance

DRY is often misunderstood as "never write similar code." That interpretation leads to premature abstraction—creating helpers, utilities, and shared modules before you know what you're actually abstracting.

**DRY means identifying duplication that already exists, then consolidating it.**

It does not mean:
- Creating abstractions before you have concrete implementations
- Building "flexible" utilities to handle hypothetical future cases
- Extracting a function because you *might* need it elsewhere

## The Rule

**Write the code first. Abstract after you see the pattern.**

When you find yourself copy-pasting, that's the signal. Not before.

## When to Apply DRY

1. **You've written the same logic twice** - Actual duplication exists in the codebase right now
2. **The duplicated code has the same reason to change** - If Feature A changes, would Feature B need the same change?
3. **The abstraction is obvious** - You're not forcing dissimilar things into the same shape

## When NOT to Apply DRY

1. **Code is similar but serves different purposes** - Two functions that happen to look alike but evolve independently
2. **You're on your first implementation** - Wait until you have two or three concrete cases
3. **The "abstraction" requires parameters to handle variations** - If you need flags to handle different behaviors, you might be forcing unification

## Do

```typescript
// You've written this twice in different components:
const formatDate = (date: Date) => {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

// Good: Extract after seeing the duplication
// utils/format-date.ts
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
```

```typescript
// You notice three components all fetch user data the same way:
// Good: Create a shared hook after seeing the pattern
export function useUser(userId: string) {
  return useQuery(['user', userId], () => fetchUser(userId));
}
```

## Don't

```typescript
// Bad: Creating a "flexible" utility before you have use cases
export function formatDate(
  date: Date,
  options?: {
    format?: 'short' | 'long' | 'iso' | 'relative';
    locale?: string;
    includeTime?: boolean;
    timezone?: string;
  }
): string {
  // 50 lines handling every possible format
}
// ^ You don't know what formats you need yet
```

```typescript
// Bad: Forcing similar-looking code into one abstraction
function handleEntity(type: 'user' | 'task' | 'thread', id: string) {
  if (type === 'user') { /* user-specific logic */ }
  if (type === 'task') { /* task-specific logic */ }
  if (type === 'thread') { /* thread-specific logic */ }
}
// ^ These will diverge. Keep them separate.
```

```typescript
// Bad: Abstracting on first use
// "I might need this elsewhere"
const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
// ^ Just inline it until you actually use it twice
```

## The Three Strike Rule

A useful heuristic: write it inline the first time, copy it the second time, extract it the third time.

By the third occurrence, you have enough examples to know:
- What the actual shared behavior is
- What parameters it needs (and doesn't need)
- Whether the duplication is coincidental or meaningful

## Duplication vs. Coupling

Sometimes duplication is better than coupling. Two services that happen to format dates the same way might not want to share that implementation—because when one needs to change its format, you don't want to break the other.

Ask: **"If I change this shared code, do all callers want that change?"**

If no, the duplication is accidental. Keep them separate.

## Related

- [yagni.md](/docs/patterns/yagni.md) - Delete speculative code, including premature abstractions
