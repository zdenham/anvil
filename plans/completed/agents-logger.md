# Agents Package Logger & Event Protocol Refactoring

## Problem

The agents package has two communication constraints:

### 1. Logging Constraint
- **stderr is overloaded** - used for both debug logs AND actual errors
- **agent-service guesses log levels** by pattern matching ("error", "failed", etc.)
- Results in false ERROR logs for normal messages like `[validator] human-review FAILED`

### 2. Event Constraint
- Currently only hardcoded events are supported: `worktree:allocated`, `thread:created`, `worktree:released`
- Adding new events requires modifying agent-service.ts
- No generic way for agents to emit events to the main event bridge

## Solution: Unified stdout Protocol

All structured communication goes through stdout as JSON with explicit `type` fields:

| Type | Purpose | Format |
|------|---------|--------|
| `log` | Agent logs | `{"type": "log", "level": "INFO", "message": "..."}` |
| `event` | Events for eventBus | `{"type": "event", "event": "task:updated", "payload": {...}}` |
| `state` | Thread state snapshots | `{"type": "state", "status": "running", ...}` |
| (legacy) | Orchestration events | `{"type": "worktree:allocated", ...}` |

**stderr** is reserved for actual process errors (crashes, node errors, uncaught exceptions).

**Non-JSON stdout** (accidental `console.log("oops")`) is piped through to the logger as debug output rather than crashing.

## Design

### Logger Implementation (`agents/src/lib/logger.ts`)

```typescript
type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function log(level: LogLevel, ...args: unknown[]): void {
  const message = args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
  // Structured log on stdout
  console.log(JSON.stringify({ type: "log", level, message }));
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG) {
      log("DEBUG", ...args);
    }
  },
  info: (...args: unknown[]) => log("INFO", ...args),
  warn: (...args: unknown[]) => log("WARN", ...args),
  error: (...args: unknown[]) => log("ERROR", ...args),
};
```

### Event Emitter (`agents/src/lib/events.ts`)

```typescript
/**
 * Emit an event to the frontend via stdout protocol.
 * Events are forwarded to the main eventBus.
 */
export function emitEvent(event: string, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ type: "event", event, payload }));
}

// Convenience methods for common events
export const events = {
  emit: emitEvent,

  // Task events
  taskUpdated: (slug: string) => emitEvent("task:updated", { slug }),
  taskDeleted: (slug: string) => emitEvent("task:deleted", { slug }),

  // Generic refresh trigger
  refresh: (resource: string, id?: string) => emitEvent("refresh", { resource, id }),
};
```

### State Output (`agents/src/output.ts`)

Update `emitState` to include `type: "state"`:

```typescript
export function emitState(state: ThreadState): void {
  console.log(JSON.stringify({ type: "state", ...state }));
}
```

### Agent-Service stdout Handler (`src/lib/agent-service.ts`)

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
          case "error":
            logger.error(message);
            break;
          case "warn":
            logger.warn(message);
            break;
          case "debug":
            logger.debug(message);
            break;
          default:
            logger.info(message);
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

      // Legacy: Specific orchestration events (backward compat)
      if (parsed.type === "worktree:allocated") { /* ... */ }
      if (parsed.type === "thread:created") { /* ... */ }
      if (parsed.type === "worktree:released") { /* ... */ }

      // Unknown JSON - log it for visibility
      logger.debug(`[agent:${threadId}] unknown message: ${line}`);
    } catch {
      // Non-JSON stdout - pipe through as debug log
      // This catches accidental console.log() from dependencies
      logger.debug(`[agent:${threadId}] ${line}`);
    }
  }
});
```

### Agent-Service stderr Handler (`src/lib/agent-service.ts`)

```typescript
command.stderr.on("data", (line: string) => {
  // stderr is reserved for actual process errors
  // (crashes, node errors, uncaught exceptions)
  logger.error(`[agent:${threadId}] stderr: ${line}`);
  eventBus.emit("agent:error", { threadId, error: line });
});
```

## Implementation Steps

### Phase 1: Logger & State Refactoring

1. **Update agent logger** (`agents/src/lib/logger.ts`)
   - Output structured JSON: `{"type": "log", "level": "...", "message": "..."}`
   - Use `console.log` (stdout) instead of `console.error`
   - Preserve DEBUG env var gating for debug level

2. **Update state emitter** (`agents/src/output.ts`)
   - Add `type: "state"` to emitted state objects

3. **Migrate ALL console usage in agents and core packages to logger**
   - Search for ALL `console.log`, `console.error`, `console.warn`, `console.debug` calls
   - Replace with appropriate `logger.*` calls
   - Packages to audit:
     - `agents/src/**/*.ts` - agent runner, validators, tools, agent-types
     - `core/**/*.ts` - shared utilities used by agents
   - **Zero direct console usage should remain** (except in logger.ts itself)

### Phase 2: Event Protocol

4. **Create event emitter** (`agents/src/lib/events.ts`)
   - `emitEvent(event, payload)` function
   - Convenience methods for common events

5. **Export from lib index** (`agents/src/lib/index.ts`)
   - Export `events` from new events.ts

### Phase 3: Agent-Service Updates

6. **Update agent-service stdout handler** (`src/lib/agent-service.ts`)
   - Handle `type: "log"` - route to appropriate logger level
   - Handle `type: "event"` - forward to eventBus
   - Handle `type: "state"` - existing state handling
   - Handle non-JSON - pipe through as debug log

7. **Delete existing stderr parsing logic** (`src/lib/agent-service.ts`)
   - Remove all pattern matching / level guessing from stderr handler
   - Remove any `error`, `failed`, `warn` keyword detection
   - Simplify to: all stderr = actual process error
   - Delete the heuristic-based log level inference entirely

8. **Remove legacy stdout parsing** (`src/lib/agent-service.ts`)
   - Delete any code that infers state from messages without `type` field (after migration)
   - Keep legacy orchestration event handling (`worktree:allocated`, etc.) for backward compat during transition

## Files to Modify

### Agents & Core Packages (Node)

| File | Changes |
|------|---------|
| `agents/src/lib/logger.ts` | Output structured JSON to stdout |
| `agents/src/lib/events.ts` | **New** - Event emitter for stdout protocol |
| `agents/src/lib/index.ts` | Export events |
| `agents/src/output.ts` | Add `type: "state"` to emitted state |
| `agents/src/**/*.ts` | **Audit all** - Replace ALL `console.*` with `logger.*` |
| `core/**/*.ts` | **Audit all** - Replace ALL `console.*` with `logger.*` |

### Frontend (Tauri)

| File | Changes |
|------|---------|
| `src/lib/agent-service.ts` | Handle unified stdout protocol, **delete all stderr heuristics** |

## Protocol Summary

| Stream | Content | Format |
|--------|---------|--------|
| stdout | Logs | `{"type":"log", "level":"INFO", "message":"..."}` |
| stdout | Events | `{"type":"event", "event":"task:updated", "payload":{...}}` |
| stdout | State | `{"type":"state", "status":"running", "messages":[...]}` |
| stdout | Orchestration (legacy) | `{"type":"worktree:allocated", ...}` |
| stdout | Accidental non-JSON | Piped through as debug log |
| stderr | Process errors only | Crashes, node errors, uncaught exceptions |

## Benefits

1. **Clean separation** - stderr truly reserved for errors
2. **Explicit typing** - all stdout messages have clear `type` field
3. **Graceful handling** - non-JSON stdout doesn't crash, just logs
4. **Extensible** - new message types can be added without protocol changes
5. **Correct conventions** - stderr for errors, stdout for structured output
