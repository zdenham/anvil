# Inline Diff Comments

Add the ability to leave inline comments on any line in a diff view, persist them per-worktree (with optional thread association), and spawn an agent to address all unresolved comments.

## Phases

- [x] Foundation: types and event definitions (`foundation.md`)
- [ ] Frontend: entity layer, context, UI components, wiring (`frontend.md`)
- [ ] Agent: comment resolution protocol (`agent.md`)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Execution Strategy

```
foundation.md  (sequential — must complete first)
    │
    ├── frontend.md  ← PARALLEL (touches src/ only)
    │
    └── agent.md     ← PARALLEL (touches agents/ only)
```

**Foundation** creates shared types in `core/` that both tracks depend on. After it completes, **frontend** and **agent** run in parallel with zero merge conflicts — they touch completely disjoint file sets.

## Architecture Overview

Comments are a new entity scoped to a **worktree** with an optional **thread association**. Since threads always live inside a worktree, `worktreeId` is the primary key — this means comments work in both thread diff views (where a threadId is available) and the standalone worktree changes view (where there's no thread).

Comments are persisted on disk at `~/.mort/comments/{worktreeId}.json` following the disk-as-truth pattern used by all other entities.

### Data Flow

```
User clicks line → CommentForm → commentService.create() → disk + store + event
User clicks "Address Comments" → spawn agent with comment context in prompt
Agent runs `mort-resolve-comment "id1,id2"` → PreToolUse hook intercepts → emits events
Frontend listener → commentService.resolve() → disk + store + UI update
```

### Scoping Model

```
Worktree (primary key)
├── Comment A (threadId: "abc-123")    ← left in thread changes tab
├── Comment B (threadId: "abc-123")    ← left in thread changes tab
├── Comment C (threadId: null)         ← left in standalone worktree changes view
└── Comment D (threadId: "def-456")    ← left in a different thread's changes tab
```

### Key Design Decisions

- **Worktree-primary with optional thread**: Users can comment on standalone worktree diff (no threadId) and thread diffs
- **One file per worktree**: Standalone view wants all comments regardless of thread — one file = single read
- **Hook-intercepted fake CLI (`mort-resolve-comment`)**: Agent calls it via Bash, PreToolUse hook intercepts, parses IDs, emits events, rewrites command to echo. No SDK changes, no real CLI binary, explicit intent signal from agent
- **Lazy-load**: Comments load when diff view opens, not at startup
- **Comments keyed by ID in store**: O(1) lookup for resolve/delete, entity stores pattern
- **Zustand-in-context**: Consistent with codebase Zustand patterns, selector subscriptions, no prop drilling
- **Archive resolved comments**: Stale resolved (>7 days) moved to `.archive.json` on load, cleaned up on worktree release
- **Soft cap (200)**: Warning only, no auto-delete of unresolved comments
- **Read-modify-write**: Handles concurrent user + agent mutations safely
- **Comments outside role="table"**: Preserves ARIA table semantics in diff viewer
