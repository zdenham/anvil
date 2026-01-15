# PID-Based Agent Cancellation

## Problem

Agent cancellation fails because process references are lost:
1. Each Tauri window has its own JavaScript context with separate module state
2. HMR clears module-level Maps, losing process references
3. Cross-window event broadcasting is fragile and noisy (multiple windows receive the same event)

Current workaround stores Maps on `window` to survive HMR, but this still requires event ping-ponging between windows.

## Proposed Solution

Store PID in thread metadata and use OS-level signals for cancellation. Any window can cancel any agent by reading the PID from disk and invoking a Rust kill command.

### Architecture

```
Spawn:
  Frontend: spawnSimpleAgent()
    → Tauri shell plugin spawns process
    → Get child.pid
    → threadService.update(threadId, { pid })

Cancel (from any window):
  Frontend: cancelAgent(threadId)
    → thread = threadService.get(threadId)
    → invoke("kill_process", { pid: thread.pid })
    → Rust sends SIGTERM to PID
    → threadService.update(threadId, { pid: null })
```

### Benefits

- **No cross-window events needed** - Any window can cancel directly
- **HMR-resistant** - PID is in thread metadata on disk
- **Simpler code** - No new files, just one new field
- **More reliable** - OS-level signal delivery
- **Consistent** - Uses existing thread metadata pattern

## Implementation Plan

### Phase 1: Rust Kill Command

**File: `src-tauri/src/process_commands.rs`**

Add a single command to kill a process by PID:

```rust
#[tauri::command]
pub async fn kill_process(pid: u32) -> Result<bool, String> {
    tracing::info!(pid = %pid, "Killing process");

    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        match kill(Pid::from_raw(pid as i32), Signal::SIGTERM) {
            Ok(_) => {
                tracing::info!(pid = %pid, "Sent SIGTERM to process");
                Ok(true)
            }
            Err(nix::errno::Errno::ESRCH) => {
                // Process doesn't exist (already exited)
                tracing::warn!(pid = %pid, "Process not found");
                Ok(false)
            }
            Err(e) => {
                tracing::error!(pid = %pid, error = %e, "Failed to send SIGTERM");
                Err(format!("Failed to kill process: {}", e))
            }
        }
    }

    #[cfg(windows)]
    {
        // Windows: use taskkill or TerminateProcess
        use std::process::Command;
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output()
            .map_err(|e| format!("Failed to run taskkill: {}", e))?;
        Ok(output.status.success())
    }
}
```

### Phase 2: Register Command

**File: `src-tauri/src/main.rs`**

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    process_commands::kill_process,
])
```

### Phase 3: Add PID to Thread Type

**File: `core/types/threads.ts`**

```typescript
export interface ThreadMetadata {
  // ... existing fields
  /** Process ID when agent is running, null otherwise */
  pid: number | null;
}
```

### Phase 4: Update Frontend

**File: `src/lib/agent-service.ts`**

After spawning, save PID to thread metadata:

```typescript
// After spawning
const child = await command.spawn();
const pid = child.pid;

// Save PID to thread metadata
await threadService.update(options.threadId, { pid });

// Store locally for stdin writes (still needed for permission responses)
agentProcesses.set(options.threadId, child);
```

Simplified cancel function:

```typescript
export async function cancelAgent(threadId: string): Promise<boolean> {
  logger.info(`[agent-service] cancelAgent called for threadId=${threadId}`);

  try {
    const thread = threadService.get(threadId);
    if (!thread?.pid) {
      logger.warn(`[agent-service] No PID found for thread: ${threadId}`);
      return false;
    }

    const result = await invoke<boolean>("kill_process", { pid: thread.pid });

    if (result) {
      // Clear PID from metadata
      await threadService.update(threadId, { pid: null });
      // Clean up local references if we have them
      agentProcesses.delete(threadId);
      activeSimpleProcesses.delete(threadId);
    }

    return result;
  } catch (error) {
    logger.error(`[agent-service] Failed to cancel agent:`, error);
    return false;
  }
}
```

**File: `src/components/simple-task/simple-task-header.tsx`**

Revert to direct `cancelAgent()` call (no event emission needed):

```typescript
const handleCancel = async () => {
  console.log(`[simple-task-header] Cancel button clicked for threadId=${threadId}`);
  const result = await cancelAgent(threadId);
  console.log(`[simple-task-header] cancelAgent returned: ${result}`);
};
```

### Phase 5: Cleanup on Process Exit

In the `command.on("close")` handler, clear the PID:

```typescript
command.on("close", async (code) => {
  // Clear PID from metadata
  await threadService.update(options.threadId, { pid: null });

  // Clean up local maps
  agentProcesses.delete(options.threadId);
  activeSimpleProcesses.delete(options.threadId);

  // ... rest of close handler
});
```

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/process_commands.rs` | Add `kill_process` command |
| `src-tauri/src/main.rs` | Register new command |
| `src-tauri/Cargo.toml` | Add `nix` crate for Unix signals |
| `core/types/threads.ts` | Add `pid: number \| null` field |
| `src/lib/agent-service.ts` | Save PID on spawn, simplify cancelAgent to read from metadata |
| `src/components/simple-task/simple-task-header.tsx` | Revert to direct cancelAgent call |
| `src/lib/event-bridge.ts` | Remove `CANCEL_AGENT_REQUEST` from broadcasts |
| `core/types/events.ts` | Remove `CANCEL_AGENT_REQUEST` event |

## Cleanup (Remove)

After implementation, remove:
- `CANCEL_AGENT_REQUEST` event type
- Cross-window event broadcasting for cancellation
- `window.__agentServiceProcessMaps` HMR workaround (optional - may still be useful for stdin writes)

## Testing

1. Spawn agent from spotlight
2. Cancel from simple-task window
3. Verify process is killed (check `ps aux | grep node`)
4. Verify thread status updates to "cancelled"
5. Test with HMR reload mid-execution
6. Test cancelling already-exited process (should return false gracefully)
7. Verify PID is cleared from thread metadata after process exits

## Dependencies

- `nix` crate for Unix signal handling (add to Cargo.toml)

## Open Questions

1. Should we support SIGKILL fallback after timeout?
2. Should stdin write (`child.write()`) also go through Rust, or keep local Child reference for that?
3. Do we need to handle process groups for sub-agents spawned by the SDK?
