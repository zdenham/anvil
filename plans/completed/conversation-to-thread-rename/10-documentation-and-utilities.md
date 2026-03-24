# Phase 9: Documentation & Utilities

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: Low - can be done in parallel with other phases.

## Documentation Files

### DATA-MODELS.md

Update the Conversation section:
```markdown
## Thread (was: Conversation)

A user's interaction with an agent. Threads are ephemeral but persisted for context.

**Storage**: `~/.anvil/threads/` (standard Anthropic message format)

**Properties**:
- Associated with a Task (typically, but not required)
- Associated with a Worktree (required for file operations)
- Uses standard Anthropic API message shape for persistence

**Key characteristics**:
- More ephemeral than tasks - can be discarded or archived
- Multiple threads can exist per task
- Requires a worktree association for read/write operations
```

Also update the Relationships diagram:
```
Task (1) ─── temporarily uses ───> (0..1) Worktree
  │
  ├── has (*) ───> Thread           // was: Conversation
  │                    │
  │                    └── requires (1) ───> Worktree
```

### AGENTS.md

Update references to Conversation in the Data Models section.

## Utility Files

### src/lib/utils/turn-grouping.ts

Check for `conversation` variable names or comments.

### src/lib/utils/tool-state.ts

Check for `conversation` references.

### src/lib/utils/index.ts

Check exports for conversation-related utilities.

## Completed Plans (Do NOT Update)

The `plans/completed/` directory contains historical documentation. These should **NOT** be updated to preserve the historical record of decisions made.

Files with conversation references (leave as-is):
- plans/completed/conversation-chat-ui/
- plans/completed/workspace-and-branching/
- plans/completed/agent-execution/
- Various other completed plans

## Active Plans (Optional Update)

These active plan files have conversation references. Update if they're actively being used:
- plans/ideas-12-22.md
- plans/intelligent-task-creation.md
- plans/accept-changeset.md
- plans/follow-up-messages.md
- plans/optimistic-store-updates.md
- etc.

Recommendation: Only update if actively being implemented. Old plans can be left as-is.

## Verification

```bash
# Check documentation is consistent
rg "Conversation" DATA-MODELS.md AGENTS.md

# Should return 0 results after update
```

## Checklist

- [ ] DATA-MODELS.md - update Conversation → Thread section
- [ ] AGENTS.md - update references
- [ ] src/lib/utils/turn-grouping.ts - check and update
- [ ] src/lib/utils/tool-state.ts - check and update
- [ ] src/lib/utils/index.ts - check exports
- [ ] Skip plans/completed/ (historical)
- [ ] Optionally update active plans
