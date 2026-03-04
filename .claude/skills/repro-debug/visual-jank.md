# Visual Jank Debugging

Debug flickers, FOUC, and layout jank by intercepting React's internal render commits. This gives you a timeline of every mount, update, and unmount — with component names, timestamps, and state diffs.

## Render Tracker Template

Inject this via `page.addInitScript()` **before** navigating. React calls into `__REACT_DEVTOOLS_GLOBAL_HOOK__` on every commit — we record what happened.

```typescript
await page.addInitScript(() => {
  const events: Array<{
    type: 'mount' | 'update' | 'unmount';
    component: string;
    timestamp: number;
    flags: number;
  }> = [];

  // Chain onto existing hook if react-refresh already installed one.
  // IMPORTANT: `renderers: new Map()` is required — Vite's react-refresh
  // preamble calls `hook.renderers.forEach(...)` and crashes if missing.
  const existing = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const hook = existing ?? {
    renderers: new Map(),
    supportsFiber: true,
    inject() { return 1; },
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onScheduleFiberRoot() {},
    onPostCommitFiberRoot() {},
  };

  const originalCommit = hook.onCommitFiberRoot.bind(hook);
  const originalUnmount = hook.onCommitFiberUnmount.bind(hook);

  function getName(fiber: any): string {
    if (!fiber || !fiber.type) return '';
    if (typeof fiber.type === 'string') return fiber.type; // DOM element
    // forwardRef / memo wrappers
    return fiber.type.displayName || fiber.type.name || fiber.type.render?.displayName || fiber.type.render?.name || '';
  }

  function walkFiber(fiber: any, cb: (f: any) => void) {
    if (!fiber) return;
    cb(fiber);
    walkFiber(fiber.child, cb);
    walkFiber(fiber.sibling, cb);
  }

  hook.onCommitFiberRoot = (rendererID: number, root: any, ...rest: any[]) => {
    const now = performance.now();
    const current = root.current;
    walkFiber(current, (fiber: any) => {
      const name = getName(fiber);
      if (!name) return;
      const isMount = !!(fiber.flags & 1) || (fiber.alternate === null);
      const isUpdate = !!(fiber.flags & 4);
      if (isMount) events.push({ type: 'mount', component: name, timestamp: now, flags: fiber.flags });
      else if (isUpdate) events.push({ type: 'update', component: name, timestamp: now, flags: fiber.flags });
    });
    originalCommit(rendererID, root, ...rest);
  };

  hook.onCommitFiberUnmount = (rendererID: number, fiber: any, ...rest: any[]) => {
    const name = getName(fiber);
    if (name) events.push({ type: 'unmount', component: name, timestamp: performance.now(), flags: fiber.flags });
    originalUnmount(rendererID, fiber, ...rest);
  };

  (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  (window as any).__REACT_RENDER_TRACKER__ = events;

  // Find rapid mount↔unmount patterns (flickers)
  (window as any).__findFlickerPatterns__ = (windowMs = 50) => {
    const byComponent = new Map<string, typeof events>();
    for (const e of events) {
      if (!byComponent.has(e.component)) byComponent.set(e.component, []);
      byComponent.get(e.component)!.push(e);
    }
    const flickers: Array<{ component: string; events: typeof events }> = [];
    for (const [component, componentEvents] of byComponent) {
      for (let i = 0; i < componentEvents.length - 1; i++) {
        const a = componentEvents[i], b = componentEvents[i + 1];
        const isFlicker =
          (a.type === 'mount' && b.type === 'unmount') ||
          (a.type === 'unmount' && b.type === 'mount');
        if (isFlicker && Math.abs(b.timestamp - a.timestamp) < windowMs) {
          flickers.push({ component, events: [a, b] });
        }
      }
    }
    return flickers;
  };
});
```

### Collecting Results

```typescript
// Get full timeline
const events = await page.evaluate(() => (window as any).__REACT_RENDER_TRACKER__);
console.log('Render events:', JSON.stringify(events, null, 2));

// Find flicker patterns (mount↔unmount within 50ms)
const flickers = await page.evaluate(() => (window as any).__findFlickerPatterns__(50));
console.log('Flickers:', JSON.stringify(flickers, null, 2));
```

## Fiber API Reference

Every event comes from a React fiber. When you need deeper inspection, you can read these properties inside the `walkFiber` callback or `onCommitFiberUnmount`:

| Property | What it tells you |
|---|---|
| `fiber.type.name` | Component name (mangled in prod — **use dev builds**) |
| `fiber.memoizedState` | Current hook state — linked list, walk via `.next` for each hook |
| `fiber.alternate.memoizedState` | Previous hook state (compare to find what changed) |
| `fiber.flags & 1` | Placement flag — this is a mount |
| `fiber.flags & 4` | Update flag — this is a re-render |
| `fiber.return` | Parent fiber — trace upward to find what triggered the re-render |
| `fiber.child` / `fiber.sibling` | Traverse the subtree |
| `fiber.memoizedProps` / `fiber.alternate.memoizedProps` | Current vs previous props |

### Walking Hook State

Each hook is a node in a linked list off `fiber.memoizedState`:

```typescript
function getHookStates(fiber: any) {
  const hooks = [];
  let hook = fiber.memoizedState;
  while (hook) {
    hooks.push(hook.memoizedState); // the hook's value
    hook = hook.next;
  }
  return hooks;
}
```

### Unwrapping Wrappers

`memo`, `forwardRef`, and `lazy` wrap the real component:

- `memo` → `fiber.type.type` is the inner component
- `forwardRef` → `fiber.type.render` is the inner component
- Fragments and providers have no `name` — skip them

## Filtering

The tracker captures everything. Filter to what matters:

**By component name** — modify `walkFiber` callback or post-filter the events array:
```typescript
const filtered = events.filter(e => e.component === 'MyComponent');
```

**By timing window** — isolate events around a specific interaction:
```typescript
const start = events.find(e => e.component === 'ClickTarget')?.timestamp ?? 0;
const window = events.filter(e => e.timestamp >= start && e.timestamp <= start + 200);
```

**By subtree** — in the `walkFiber` callback, track depth or only record events below a specific parent fiber.

**State diffs** — compare `fiber.memoizedState` vs `fiber.alternate?.memoizedState` inside the walker to log exactly which hook value changed on each update.

## Caveats

- **Dev builds only** — production builds mangle component names, making the output useless
- **`toHaveScreenshot()` hides flickers** — it auto-stabilizes before capturing; never use it to detect transient visual states
- **Hook chaining** — if `react-refresh` or another tool already installed the hook, chain onto it (the template handles this). Don't overwrite
- **Performance** — the walker touches every fiber on every commit. For long-running tests, clear `__REACT_RENDER_TRACKER__` between interactions to keep the array manageable
