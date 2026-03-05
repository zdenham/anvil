# Zustand Selector Safety

Zustand selectors use `Object.is` equality by default. If a selector returns a new reference each render (new array, new object), the component re-renders, which calls the selector again, which returns another new reference — infinite loop (`Maximum update depth exceeded`).

## Safe Patterns

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

## Unsafe Patterns

```typescript
// New array every render
useStore((s) => s.items.filter(predicate))
useStore((s) => s.getAllThreads())
useStore((s) => s.messages ?? [])

// New object every render
useStore((s) => ({ name: s.name, count: s.count }))
useStore((s) => s.config ?? {})
```

## Decision Tree

```
What does your selector return?
├── Primitive (string, number, boolean)? → Direct selector, no wrapper needed
├── Existing reference (state.threads[id])? → useCallback if parameterized
├── Object with primitive values? → useShallow
├── Derived array (.filter, .map)? → useShallow on IDs + useMemo
└── Fallback value (?? [])? → useShallow, or select a primitive instead
```

## HYDRATE Note

During HYDRATE events (cold start, reconnect), all store references are replaced even if content is identical. This means even "existing reference" selectors can cause re-renders after HYDRATE. Use `useShallow` for any object/array return that should survive HYDRATE without re-rendering.

## ESLint Enforcement

The `no-restricted-syntax` rules in `eslint.config.js` catch the most common unsafe patterns in concise arrow selectors. False positives (rare) can be suppressed with `// eslint-disable-next-line no-restricted-syntax`.
