# Nested Plan Directories

## Overview

Support arbitrary folder nesting in the sidebar with collapsible plan folders. This allows organizing related plans in a hierarchical structure that mirrors the file system.

## Design Decisions

- **Casing**: Use lowercase `readme.md` consistently. Detection is case-insensitive.
- **Conflict resolution**: When both `plans/auth/readme.md` and `plans/auth.md` exist, prefer `readme.md` silently.
- **Click behavior**: Single-click opens plan content. Separate chevron toggles expand/collapse.
- **Expand state scope**: Per-worktree, following existing patterns.
- **Archive behavior**: Cascading - archiving a parent archives all children.
- **Orphaned plans**: No special styling - bubble up to root level or nearest ancestor.
- **Nesting depth**: No maximum limit.
- **Refresh strategy**: Event-driven only (no polling).

## Sub-Plans

This feature is decomposed into four parallel workstreams:

| Sub-Plan | Description | Dependencies |
|----------|-------------|--------------|
| [01-data-layer.md](./01-data-layer.md) | Schema, parent detection, refresh hooks | None |
| [02-tree-state.md](./02-tree-state.md) | Tree building, expand state persistence | None |
| [03-ui-components.md](./03-ui-components.md) | PlanFolderItem, indentation, animations, keyboard nav | 01, 02 |
| [04-agent-prompts.md](./04-agent-prompts.md) | System prompt conventions for plan organization | None |

## Execution Strategy

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  01-data-layer  │  │  02-tree-state  │  │ 04-agent-prompts│
│                 │  │                 │  │                 │
│  Schema changes │  │  Tree building  │  │  System prompt  │
│  Parent detect  │  │  Expand state   │  │  conventions    │
│  Refresh hooks  │  │  persistence    │  │                 │
└────────┬────────┘  └────────┬────────┘  └─────────────────┘
         │                    │
         └─────────┬──────────┘
                   │
                   ▼
         ┌─────────────────┐
         │ 03-ui-components│
         │                 │
         │  PlanFolderItem │
         │  Indentation    │
         │  Animations     │
         │  Keyboard nav   │
         └─────────────────┘
```

**Parallel Phase 1** (can run simultaneously):
- `01-data-layer.md` - Data model and service layer
- `02-tree-state.md` - State management and tree structure
- `04-agent-prompts.md` - Agent guidance (independent)

**Sequential Phase 2** (requires Phase 1 completion):
- `03-ui-components.md` - UI implementation (depends on data + state)

## Testing Considerations

### Unit Tests
- Parent detection with deep nesting
- Tree building with complex hierarchies

### Integration Tests
- Create nested plan structure, verify tree renders correctly
- Archive folder plan, verify children are cascaded archived

### Manual Testing
- Create plans: `plans/auth.md`, `plans/auth/login.md`, `plans/auth/oauth/google.md`
- Verify proper nesting in sidebar
- Test keyboard navigation with nested items
