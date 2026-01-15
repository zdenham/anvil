# Subplan 1: Logger Infrastructure (agents package)

**Parallel Group: A** - Can run concurrently with Subplan 2
**Dependencies: None**

## Scope

Create/update the core logging and event infrastructure in the agents package.

## Files to Modify

| File | Action |
|------|--------|
| `agents/src/lib/logger.ts` | Update - structured JSON output to stdout |
| `agents/src/lib/events.ts` | Create - event emitter for stdout protocol |
| `agents/src/output.ts` | Update - add `type: "state"` to emitted state |
| `agents/src/lib/index.ts` | Update - export events |

## Implementation

### 1. Update `agents/src/lib/logger.ts`

Change from stderr to stdout with structured JSON:

```typescript
type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function log(level: LogLevel, ...args: unknown[]): void {
  const message = args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
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

### 2. Create `agents/src/lib/events.ts`

```typescript
export function emitEvent(event: string, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ type: "event", event, payload }));
}

export const events = {
  emit: emitEvent,
  taskUpdated: (slug: string) => emitEvent("task:updated", { slug }),
  taskDeleted: (slug: string) => emitEvent("task:deleted", { slug }),
  refresh: (resource: string, id?: string) => emitEvent("refresh", { resource, id }),
};
```

### 3. Update `agents/src/output.ts`

Add `type: "state"` to `emitState`:

```typescript
export function emitState(state: ThreadState): void {
  console.log(JSON.stringify({ type: "state", ...state }));
}
```

### 4. Update `agents/src/lib/index.ts`

Export the new events module.

## Completion Criteria

- [ ] logger.ts outputs structured JSON to stdout
- [ ] events.ts created with emitEvent and convenience methods
- [ ] output.ts includes `type: "state"` in state emissions
- [ ] lib/index.ts exports events
