# Zustand Selector Safety

Prevent maximum update depth errors caused by selectors that return new references on every render.

## Problem

Zustand selectors use `Object.is` equality by default. If a selector returns a new reference each render (new array, new object), the component re-renders, which calls the selector again, which returns another new reference → infinite loop.

Common offenders:
- `.filter()`, `.map()`, `.sort()` inside selectors (always return new arrays)
- `?? []` or `?? {}` fallbacks (new reference when value is undefined)
- Store methods like `getAllThreads()` that return new arrays
- Object spread `{ ...state.something }` in selectors

## Phases

- [x] Add `no-restricted-syntax` ESLint rules to `eslint.config.js`
- [x] Add `docs/patterns/zustand-selectors.md` pattern doc
- [x] Fix existing violations (e.g., `command-palette.tsx:32` calls `s.getAllThreads()` in a selector)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: ESLint Rules

Add `no-restricted-syntax` rules to the `src/` file config block in `eslint.config.js`.

### Rules to add

**1. Array methods in selectors**

```js
{
  selector: 'CallExpression[callee.name=/^use\\w+Store$/] ArrowFunctionExpression > CallExpression[callee.property.name=/^(filter|map|reduce|sort|slice|concat|flat|flatMap)$/]',
  message: 'Array methods in zustand selectors create new references every render → max update depth. Extract to useMemo() or use useShallow().'
}
```

Catches: `useThreadStore((s) => s.items.filter(...))`
Skips: block-bodied arrows where `.filter()` is intermediate (the `>` requires the call to be the arrow's direct body).

**2. Fallback `?? []` in selectors**

```js
{
  selector: 'CallExpression[callee.name=/^use\\w+Store$/] ArrowFunctionExpression > LogicalExpression[operator="??"] > ArrayExpression',
  message: 'Fallback ?? [] in a zustand selector creates a new array every render. Use useShallow() or select a primitive instead.'
}
```

Catches: `useStore((s) => s.messages ?? [])`
Skips: block-bodied arrows, arrows wrapped in `useShallow(...)` (arrow isn't the direct body).

**3. Fallback `?? {}` in selectors**

```js
{
  selector: 'CallExpression[callee.name=/^use\\w+Store$/] ArrowFunctionExpression > LogicalExpression[operator="??"] > ObjectExpression',
  message: 'Fallback ?? {} in a zustand selector creates a new object every render. Use useShallow() or select a primitive instead.'
}
```

**4. Store method calls in selectors**

```js
{
  selector: 'CallExpression[callee.name=/^use\\w+Store$/] ArrowFunctionExpression > CallExpression[callee.property.name=/^(getAll|getBy|getRunning|getThreadsBy)/]',
  message: 'Store methods returning collections in selectors create new references every render. Select from state directly or use useShallow().'
}
```

Catches: `useThreadStore((s) => s.getAllThreads())`

### What these rules DON'T catch

- `useCallback`-wrapped selectors (arrow is inside `useCallback`, not directly in the store call) — these are less risky because `useCallback` already stabilizes the selector function
- `useShallow`-wrapped selectors (correctly excluded by `>` between store call and arrow)
- Block-bodied arrows that reduce to primitives (correctly excluded by `>`)

### False positives

Minimal. The `>` (direct child) between `ArrowFunctionExpression` and the pattern means only concise single-expression arrows match — which are exactly the cases where the new reference IS the return value. Rare false positives can be `// eslint-disable-next-line`'d.

## Phase 2: Pattern Doc

Create `docs/patterns/zustand-selectors.md` covering:

### Safe patterns (DO)

```typescript
// Primitive return — stable by default
useStore((s) => s.count)
useStore((s) => s.threads[id]?.name)
useStore((s) => s.messages?.length ?? 0)

// useCallback for parameterized selectors
useStore(useCallback((s) => s.threads[id], [id]))

// useShallow for objects with primitive values
useStore(useShallow((s) => s.toolStates[id] ?? { status: "running" }))

// useShallow + useMemo for derived arrays
const ids = useStore(useShallow((s) => Object.keys(s.items)))
const sorted = useMemo(() => ids.sort(), [ids])
```

### Unsafe patterns (DON'T)

```typescript
// New array every render
useStore((s) => s.items.filter(predicate))
useStore((s) => s.getAllThreads())
useStore((s) => s.messages ?? [])

// New object every render
useStore((s) => ({ name: s.name, count: s.count }))
useStore((s) => s.config ?? {})
```

### Decision tree

```
What does your selector return?
├── Primitive (string, number, boolean)? → Direct selector, no wrapper needed
├── Existing reference (state.threads[id])? → useCallback if parameterized
├── Object with primitive values? → useShallow
├── Derived array (.filter, .map)? → useShallow on IDs + useMemo
└── Fallback value (?? [])? → useShallow, or select a primitive instead
```

### HYDRATE note

During HYDRATE events (cold start, reconnect), all store references are replaced even if content is identical. This means even "existing reference" selectors can cause re-renders after HYDRATE. Use `useShallow` for any object/array return that should survive HYDRATE without re-rendering.

## Phase 3: Fix Existing Violations

Known violations to fix:

1. **`src/components/command-palette/command-palette.tsx:32`** — `useThreadStore((s) => s.getAllThreads())` returns a new array. Should select `s._threadsArray` directly.

2. **`src/hooks/use-thread-selectors.ts:32`** — `useMessageContent` returns `[]` fallback without `useShallow`. Should wrap in `useShallow` or return `undefined` and let caller handle.

After adding ESLint rules, run `pnpm lint` to find any additional violations.
