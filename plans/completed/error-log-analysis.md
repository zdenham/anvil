# Error Log Analysis

## Overview

Analysis of error logs from 2025-12-31, distinguishing between actual bugs and misclassified log levels.

---

## Logging Issues (NOT actual bugs - should be debug/info)

### Issue 1: System Prompt Logged as ERROR

**Location:** `agents/src/runner.ts:439-441`

**What's happening:**
```typescript
console.error(`[runner] === ADDITIONAL INSTRUCTIONS START ===`);
console.error(appendedPrompt);  // <-- The entire system prompt is written to stderr
console.error(`[runner] === ADDITIONAL INSTRUCTIONS END ===`);
```

The system prompt (e.g., "## Role", "You are the planning agent for Anvil...") is written to stderr via `console.error()`.

**Why it shows as ERROR:**

In `src/lib/agent-service.ts:363-376`:
```typescript
command.stderr.on("data", (line: string) => {
  const isDebugMessage = line.startsWith("[runner]") ||
                         line.startsWith("[PostToolUse]") ||
                         line.startsWith("[anvil-cli]") ||
                         line.startsWith("[output]");
  if (isDebugMessage) {
    logger.debug(...);
  } else {
    logger.error(...);  // <-- Everything else logged as ERROR
  }
});
```

The filter only checks for specific prefixes. The system prompt lines (like "## Role", "You are the planning agent...") don't match any prefix, so they're logged as ERROR.

**Fix options:**
1. Don't write the system prompt to stderr at all (just to the file in dev mode)
2. Wrap the system prompt output in a recognizable prefix
3. Add more prefixes to the filter list (fragile)
4. Change the default behavior to log stderr as DEBUG unless it looks like an actual error

**Recommended fix:**
In `agents/src/runner.ts`, remove or guard the prompt logging:
```typescript
// Only log appended instructions with prefix that will be filtered
if (isDevMode) {
  console.error(`[runner] Additional instructions written to ${additionalInstructionsPath}`);
  // Don't dump the entire prompt to stderr
}
```

---

## Actual Bugs

### Bug 1: ENOENT when writing metadata.json in error handler

**Error message:**
```
Error: ENOENT: no such file or directory, open '/Users/zac/.anvil-dev/tasks/task-mjubgb33-3zn4en/threads/planning-1a79fd6a-ad89-4b79-9fb4-49543118f766/metadata.json'
    at Object.openSync (node:fs:581:18)
    at writeFileSync (node:fs:2345:35)
    at main (file:///Users/zac/Documents/juice/anvil/anvil/agents/dist/runner.js:1466:5)
```

**Location:** `agents/src/runner.ts:627`

**Root cause:**

The error handler at line 616-631 tries to write to `metadataPath` when ANY error occurs:
```typescript
} catch (err) {
  const endTime = Date.now();
  const currentMetadata = existsSync(metadataPath)
    ? (JSON.parse(readFileSync(metadataPath, "utf-8")) as ThreadMetadata)
    : metadata;
  currentMetadata.status = "error";
  // ...
  writeFileSync(metadataPath, JSON.stringify(currentMetadata, null, 2)); // <-- FAILS
}
```

**Why it fails:**

If an error occurs **before** line 354 (`mkdirSync(threadPath, { recursive: true })`), the thread directory doesn't exist. The error handler then tries to write to a path inside that non-existent directory.

The errors that can occur before directory creation:
1. Task metadata lookup fails (lines 267-294)
2. Task directory validation fails (lines 298-311)
3. Any other early initialization error

**Impact:**
- Original error is masked by the ENOENT error
- No metadata.json is written, leaving the thread in an inconsistent state
- The actual error message gets lost

**Fix:**
Wrap the metadata write in the error handler with a safety check:
```typescript
} catch (err) {
  const endTime = Date.now();

  // Only try to write metadata if the directory exists
  if (existsSync(threadPath)) {
    const currentMetadata = existsSync(metadataPath)
      ? (JSON.parse(readFileSync(metadataPath, "utf-8")) as ThreadMetadata)
      : metadata;
    currentMetadata.status = "error";
    currentMetadata.updatedAt = endTime;
    if (currentMetadata.turns[turnIndex]) {
      currentMetadata.turns[turnIndex].completedAt = endTime;
    }
    writeFileSync(metadataPath, JSON.stringify(currentMetadata, null, 2));
  } else {
    console.error(`[runner] Cannot write error metadata - thread directory does not exist: ${threadPath}`);
  }

  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
```

### Bug 2: Task lookup fails before thread directory creation

**Related to Bug 1**

**What's happening:**

The runner initialization has an ordering issue. The task metadata lookup (lines 263-294) can fail before the thread directory is created (line 354).

**Runner initialization flow:**
```
1. lines 263-294: Task metadata lookup (can throw at 299-303)
2. lines 306-311: Task directory validation (can throw)
3. line 315:      threadPath is computed
4. line 354:      mkdirSync(threadPath) - directory created HERE
5. lines 403+:    metadata.json written, agent runs
```

**Error flow:**
```
1. Task lookup fails at line 267-290 (task not found in metadata)
2. Error thrown at line 299-303
3. Catch block at line 616 executes
4. writeFileSync at line 627 fails with ENOENT because:
   - mkdirSync (line 354) was never reached
   - Thread directory doesn't exist
```

**Why task lookup might fail:**
Looking at the logs, the tasks have auto-generated IDs like `task-mjubgb33-3zn4en`. These are draft tasks created by the frontend. The runner then tries to look them up:

1. First tries `persistence.getTask(args.taskId)` - may fail if task not indexed yet
2. Falls back to checking if `tasks/{taskId}/` directory exists
3. Falls back to scanning all tasks

If none of these find the task, the error is thrown before directory creation.

**Possible root causes:**
1. Race condition: Runner starts before frontend finishes creating task on disk
2. Task indexing issue: Task created but not yet indexed by persistence layer
3. Path mismatch: Frontend and runner using different task IDs/slugs

**Note:** The frontend DOES create the thread directory via `threadService.create()`:
```typescript
await persistence.ensureDir(threadPath);
await persistence.writeJson(`${threadPath}/metadata.json`, thread);
```

But this happens AFTER `prepareAgent` returns. The runner is spawned asynchronously via `command.spawn()`, and there might be a race between the frontend's disk writes and the runner's reads.

**Fix:**
1. Fix Bug 1 (error handler should check if directory exists before writing)
2. Ensure task is fully persisted before spawning runner
3. Add retry/polling in runner for task lookup with graceful fallback

---

## Summary

| Issue | Type | Severity | Location |
|-------|------|----------|----------|
| System prompt logged as ERROR | Logging | Low | `agents/src/runner.ts:439-441`, `src/lib/agent-service.ts:363-376` |
| ENOENT in error handler | Bug | High | `agents/src/runner.ts:627` |
| Task lookup fails before directory creation | Bug | High | `agents/src/runner.ts:267-311` |

---

## Recommended Fixes

### Fix 1: Guard error handler metadata write (Quick fix)

In `agents/src/runner.ts`, wrap the error handler's write in a safety check:

```typescript
} catch (err) {
  const endTime = Date.now();

  // Only try to write metadata if the directory exists
  try {
    if (existsSync(dirname(metadataPath))) {
      const currentMetadata = existsSync(metadataPath)
        ? (JSON.parse(readFileSync(metadataPath, "utf-8")) as ThreadMetadata)
        : metadata;
      currentMetadata.status = "error";
      currentMetadata.updatedAt = endTime;
      if (currentMetadata.turns?.[turnIndex]) {
        currentMetadata.turns[turnIndex].completedAt = endTime;
      }
      writeFileSync(metadataPath, JSON.stringify(currentMetadata, null, 2));
    }
  } catch (writeErr) {
    console.error(`[runner] Failed to write error metadata: ${writeErr}`);
  }

  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
```

### Fix 2: Remove system prompt from stderr (Quick fix)

In `agents/src/runner.ts:439-441`, remove or comment out the prompt dump:

```typescript
// Don't dump entire prompt to stderr - it floods logs
// console.error(`[runner] === ADDITIONAL INSTRUCTIONS START ===`);
// console.error(appendedPrompt);
// console.error(`[runner] === ADDITIONAL INSTRUCTIONS END ===`);
console.error(`[runner] Appended system prompt (${appendedPrompt.length} chars), cwd=${args.cwd}, taskId=${args.taskId}`);
```

### Fix 3: Better stderr filtering (Alternative)

In `src/lib/agent-service.ts:363-376`, use a whitelist approach for actual errors:

```typescript
command.stderr.on("data", (line: string) => {
  // Only treat lines that look like actual errors as errors
  const looksLikeError = line.toLowerCase().includes("error") ||
                         line.toLowerCase().includes("exception") ||
                         line.toLowerCase().includes("failed") ||
                         line.startsWith("at ") || // Stack trace
                         line.includes("ENOENT") ||
                         line.includes("EACCES");

  if (looksLikeError) {
    logger.error(`[agent:${thread.id}] error: ${line}`);
    callbacks.onError(line);
  } else {
    logger.debug(`[agent:${thread.id}] ${line}`);
  }
});
```

---

## Occurrences in Provided Logs

| Agent ID | Task ID | Error Type |
|----------|---------|------------|
| `1a79fd6a-ad89-4b79-9fb4-49543118f766` | `task-mjubgb33-3zn4en` | ENOENT in error handler |
| `e905ac6e-0a45-498d-9858-92131202621d` | `task-mjublczg-qjyuqy` | ENOENT in error handler |
| `e35848f3-6dfd-4718-9835-7e1d8034010c` | `task-mjubnlt7-c9ri5v` | ENOENT in error handler |
| `49d4b372-b504-4fdf-a668-d36261a5542c` | `task-mjubt75a-p8684h` | ENOENT in error handler |
