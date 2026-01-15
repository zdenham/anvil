# Phase 7: Agent Runner (Node.js)

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: Medium - independent of frontend, but affects agent execution.

## Files to Update

### 1. agents/src/runner.ts

```typescript
// Rename CLI argument
--conversation-id → --thread-id

// Rename variables
conversationId → threadId
conversationPath → threadPath

// Update path construction
.join("conversations") → .join("threads")

// Update any logging that references "conversation"
```

### 2. agents/src/output.ts

```typescript
// Update comments referencing "conversation"
// Rename parameters if any
conversationPath → threadPath
conversationId → threadId
```

## CLI Usage Update

After this change, the agent runner invocation changes:
```bash
# Before
node runner.js --conversation-id abc123 ...

# After
node runner.js --thread-id abc123 ...
```

**Note**: This requires coordinated update with `src/lib/agent-service.ts` which spawns the agent process.

## Verification

```bash
# Build agent runner
cd agents && pnpm build

# Test invocation (manual)
node dist/runner.js --help
```

## Checklist

- [ ] agents/src/runner.ts - update CLI args, variables, paths
- [ ] agents/src/output.ts - update comments, parameters
- [ ] Coordinate with agent-service.ts (spawns with old arg name)
- [ ] pnpm build in agents/
- [ ] Manual test of runner invocation
