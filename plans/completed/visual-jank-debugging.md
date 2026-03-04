# Visual Jank Debugging — Supplement for Repro-Debug Skill

Add `.claude/skills/repro-debug/visual-jank.md` and link it from `SKILL.md`. Teaches the agent how to use React render tracking via `__REACT_DEVTOOLS_GLOBAL_HOOK__` to debug flickers and FOUC.

## Approach

Inject `__REACT_DEVTOOLS_GLOBAL_HOOK__` via `page.addInitScript()`. React calls this hook on every commit — we intercept it to record which components mounted, updated, or unmounted and when. The doc should focus on **how to use this tool**, not prescribe a rigid workflow.

## Deliverables

### 1. `.claude/skills/repro-debug/visual-jank.md`

Sections:

- **Render Tracker Template** — copy-paste `addInitScript` block that installs the hook, records mount/update/unmount events with timestamps into `window.__REACT_RENDER_TRACKER__`, and provides `findFlickerPatterns(windowMs)` to surface components with rapid mount↔unmount cycles
- **Fiber API Reference** — what the agent can read off a fiber and how:
  - `fiber.type.name` — component name (mangled in prod, use dev builds)
  - `fiber.memoizedState` / `fiber.alternate.memoizedState` — current vs previous hook state; walk the linked list via `.next` for individual hooks
  - `fiber.flags & 1` — placement (mount); `fiber.flags & 4` — update
  - `fiber.return` — parent fiber (trace up to find the component that actually changed state)
  - `fiber.child` / `fiber.sibling` — traverse subtree
  - Handling `memo`, `forwardRef`, fragments (unwrap `.type.render` or skip nameless fibers)
- **Filtering** — how to filter the tracker output: by component name, by timing window, by subtree (walk `fiber.child`/`sibling`). Agent can combine these however it sees fit
- **Caveats** — `toHaveScreenshot()` auto-stabilizes and hides transient states (never use it to detect flickers); chain onto existing hook if `react-refresh` is active; prod builds mangle names

### 2. Update `SKILL.md`

- Add row to Reference Files table: `| Visual jank debugging | .claude/skills/repro-debug/visual-jank.md |`

## Phases

- [x] Research: read existing skill files and React fiber APIs
- [x] Write `.claude/skills/repro-debug/visual-jank.md`
- [x] Update `SKILL.md` to reference the new doc

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Notes

- `__REACT_DEVTOOLS_GLOBAL_HOOK__` works in prod but names are mangled — use dev builds
- If `react-refresh` is active, chain onto the existing hook rather than overwriting
- Reference impl: [bippy](https://github.com/aidenybai/bippy) handles Suspense/memo edge cases
