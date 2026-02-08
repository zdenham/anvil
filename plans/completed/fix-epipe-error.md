# Fix EPIPE Error in AgentHub Connection

Diagnosis and fix for the "Error: write EPIPE" causing agent process to exit with code 1.

## Phases

- [x] Add error handling to socket write operations
- [x] Add graceful disconnect with write buffer flush
- [x] Add backpressure handling for socket writes
- [x] Update disconnect handler to avoid immediate exit during writes

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Diagnosis

### Error Observed

```
[runner] AgentHub error: Error: write EPIPE
[runner] Disconnected from AgentHub
Process closed for threadId=... Exit code: 1
Total time from spawn start: 1057ms
```

### Root Cause

**EPIPE occurs when writing to a socket that has been closed by the remote end.** The issue is a race condition in `connection.ts`:

```typescript
// connection.ts:61-65
write(msg: SocketMessage): void {
  if (this.socket && !this.socket.destroyed) {
    this.socket.write(JSON.stringify(msg) + "\n");  // ← Can throw EPIPE
  }
}
```

The check `!this.socket.destroyed` is not atomic with the write. The socket can close between the check and the actual write.

### Contributing Factors

1. **No try-catch around socket.write()** - EPIPE errors propagate uncaught

2. **Immediate process.exit() on disconnect** (`runner.ts:181-184`):
   ```typescript
   hub.on("disconnect", () => {
     logger.error("[runner] Disconnected from AgentHub");
     process.exit(1);  // ← Exits immediately, no cleanup
   });
   ```

3. **No backpressure handling** - `socket.write()` returns `false` when buffer is full, but we ignore it

4. **Logger uses the same broken socket** - When logging the disconnect error, we try to write to the same closing socket, causing more EPIPE errors

### Sequence of Events

```
T+0ms      Process starts
T+50ms     HubClient connects successfully
T+100ms    Agent begins emitting state/events via socket
T+1000ms   Hub server closes connection (timeout, restart, etc.)
T+1001ms   socket 'close' event fires
T+1002ms   hub.emit("disconnect") → logger.error() → tries to write to socket
T+1003ms   socket.write() throws EPIPE (socket already closing)
T+1004ms   process.exit(1)
```

---

## Fix Strategy

### Phase 1: Add Error Handling to Socket Writes

**File: `agents/src/lib/hub/connection.ts`**

Wrap `socket.write()` in try-catch to handle EPIPE gracefully:

```typescript
write(msg: SocketMessage): boolean {
  if (!this.socket || this.socket.destroyed) {
    return false;
  }

  try {
    const data = JSON.stringify(msg) + "\n";
    return this.socket.write(data);
  } catch (err) {
    // EPIPE or other write errors - socket is closing/closed
    this.emit("error", err);
    return false;
  }
}
```

### Phase 2: Add Graceful Disconnect with Buffer Flush

**File: `agents/src/lib/hub/connection.ts`**

Add a method to gracefully close the connection after flushing pending writes:

```typescript
private isClosing = false;

async gracefulClose(): Promise<void> {
  if (!this.socket || this.isClosing) return;

  this.isClosing = true;

  return new Promise<void>((resolve) => {
    if (!this.socket) {
      resolve();
      return;
    }

    // Wait for write buffer to drain, with timeout
    const timeout = setTimeout(() => {
      this.socket?.destroy();
      resolve();
    }, 1000);

    this.socket.once("drain", () => {
      clearTimeout(timeout);
      this.socket?.end();
      resolve();
    });

    // If already drained, end immediately
    if (this.socket.writableLength === 0) {
      clearTimeout(timeout);
      this.socket.end();
      resolve();
    }
  });
}
```

**File: `agents/src/lib/hub/client.ts`**

Expose graceful disconnect:

```typescript
async gracefulDisconnect(): Promise<void> {
  await this.connection.gracefulClose();
}
```

### Phase 3: Add Backpressure Handling

**File: `agents/src/lib/hub/connection.ts`**

Handle the `false` return from `socket.write()` to implement backpressure:

```typescript
private writeQueue: SocketMessage[] = [];
private draining = false;

write(msg: SocketMessage): boolean {
  if (!this.socket || this.socket.destroyed || this.isClosing) {
    return false;
  }

  // If already draining, queue the message
  if (this.draining) {
    this.writeQueue.push(msg);
    return true;
  }

  try {
    const data = JSON.stringify(msg) + "\n";
    const flushed = this.socket.write(data);

    if (!flushed) {
      // Buffer is full, wait for drain
      this.draining = true;
      this.socket.once("drain", () => this.flushQueue());
    }

    return true;
  } catch (err) {
    this.emit("error", err);
    return false;
  }
}

private flushQueue(): void {
  this.draining = false;

  while (this.writeQueue.length > 0 && !this.draining) {
    const msg = this.writeQueue.shift()!;
    this.write(msg);
  }
}
```

### Phase 4: Update Disconnect Handler

**File: `agents/src/runner.ts`**

Don't immediately exit on disconnect - allow graceful shutdown:

```typescript
let isShuttingDown = false;

hub.on("disconnect", () => {
  if (isShuttingDown) return;  // Avoid duplicate exits
  isShuttingDown = true;

  logger.info("[runner] Disconnected from AgentHub");

  // Give a brief window for any pending operations
  setTimeout(() => {
    process.exit(1);
  }, 100);
});

hub.on("error", (err) => {
  // Only log if not already shutting down (avoids recursive EPIPE)
  if (!isShuttingDown) {
    logger.error(`[runner] AgentHub error: ${err}`);
  }
});
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `agents/src/lib/hub/connection.ts` | Add try-catch to write(), add gracefulClose(), add backpressure handling |
| `agents/src/lib/hub/client.ts` | Add gracefulDisconnect() method |
| `agents/src/runner.ts` | Update disconnect handler to avoid immediate exit |

## Testing

After changes:
1. Run `pnpm test` in agents directory
2. Test agent with hub disconnection scenarios
3. Verify no EPIPE errors when hub closes connection
4. Verify graceful shutdown completes pending writes
