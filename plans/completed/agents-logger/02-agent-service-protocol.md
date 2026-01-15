# Subplan 2: Agent-Service Protocol Handler (frontend)

**Parallel Group: A** - Can run concurrently with Subplan 1
**Dependencies: None** (can be built to handle both old and new formats)

## Scope

Update agent-service.ts to handle the unified stdout protocol and clean up stderr handling.

## Files to Modify

| File | Action |
|------|--------|
| `src/lib/agent-service.ts` | Update stdout/stderr handlers |

## Implementation

### 1. Update stdout handler

Handle all message types with explicit `type` field:

```typescript
command.stdout.on("data", (chunk: string) => {
  // ... line buffering ...

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);

      // Structured log from agent
      if (parsed.type === "log") {
        const level = (parsed.level?.toLowerCase() || "info") as "debug" | "info" | "warn" | "error";
        const message = `[agent:${threadId}] ${parsed.message}`;
        switch (level) {
          case "error": logger.error(message); break;
          case "warn": logger.warn(message); break;
          case "debug": logger.debug(message); break;
          default: logger.info(message);
        }
        continue;
      }

      // Generic event protocol
      if (parsed.type === "event") {
        eventBus.emit(parsed.event, {
          ...parsed.payload,
          threadId: options.threadId,
          _source: "agent",
        });
        continue;
      }

      // State snapshot
      if (parsed.type === "state") {
        const { type, ...state } = parsed;
        // ... existing state handling with `state` ...
        continue;
      }

      // Legacy orchestration events (backward compat)
      if (parsed.type === "worktree:allocated") { /* ... */ }
      if (parsed.type === "thread:created") { /* ... */ }
      if (parsed.type === "worktree:released") { /* ... */ }

      // Unknown JSON - log for visibility
      logger.debug(`[agent:${threadId}] unknown message: ${line}`);
    } catch {
      // Non-JSON stdout - pipe through as debug log
      logger.debug(`[agent:${threadId}] ${line}`);
    }
  }
});
```

### 2. Simplify stderr handler

Delete all heuristic-based log level inference:

```typescript
command.stderr.on("data", (line: string) => {
  // stderr is reserved for actual process errors
  logger.error(`[agent:${threadId}] stderr: ${line}`);
  eventBus.emit("agent:error", { threadId, error: line });
});
```

### 3. Delete legacy parsing

- Remove any pattern matching for "error", "failed", "warn" keywords
- Remove any code that infers state without `type` field
- Keep legacy orchestration events during transition

## Completion Criteria

- [ ] stdout handler routes `type: "log"` to appropriate logger level
- [ ] stdout handler forwards `type: "event"` to eventBus
- [ ] stdout handler processes `type: "state"` correctly
- [ ] Non-JSON stdout gracefully logged as debug
- [ ] stderr handler simplified - all stderr = error
- [ ] All heuristic keyword detection removed
