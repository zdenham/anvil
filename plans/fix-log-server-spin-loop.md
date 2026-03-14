# Fix Log Server Spin Loop

## Problem

In `src-tauri/src/logging/log_server.rs:80-89`, when `elapsed >= flush_backoff`, the timeout saturates to `Duration::ZERO`. This causes `recv_timeout(Duration::ZERO)` to return immediately, creating a tight spin loop that:

1. Burns CPU on the log server thread
2. Generates 50+ ERROR-level log entries in rapid succession (all within 0.5ms)
3. Those ERROR logs feed back into the system via the BufferLayer → broadcast channel, **amplifying** the event flood

The code at line 84 *detects* the spin but doesn't *fix* it — it just logs an error and continues.

## Root Cause

```rust
let elapsed = last_flush.elapsed();
let timeout = flush_backoff.saturating_sub(elapsed);  // → Duration::ZERO

if timeout.is_zero() {
    tracing::error!("spin-loop avoided: ...");  // Logs but doesn't reset!
}

match receiver.recv_timeout(timeout) {  // recv_timeout(ZERO) → immediate return
```

The `last_flush` is only reset inside the `Err(Timeout)` branch (line 118) or the `Ok(row)` batch-flush path (line 107). When `timeout.is_zero()` AND there are queued messages, it enters the `Ok(row)` branch which may not flush (if `buffer.len() < BATCH_SIZE`), and `last_flush` remains stale → next iteration is also zero → spin.

## Fix

When `timeout.is_zero()`, reset `last_flush` and force a flush attempt if the buffer is non-empty. This breaks the spin loop and ensures forward progress.

## Key Files

| File | Change |
| --- | --- |
| `src-tauri/src/logging/log_server.rs:80-89` | Reset `last_flush` and flush on zero timeout |

## Phases

- [x] Fix the spin loop: reset `last_flush = Instant::now()` when `timeout.is_zero()`, attempt flush if buffer non-empty, downgrade log from `error!` to `debug!`

- [x] Add unit test verifying the batch_worker doesn't spin when elapsed exceeds backoff

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Implementation Detail

```rust
if timeout.is_zero() {
    tracing::debug!(
        "[log_server] flush interval elapsed: elapsed={:?} backoff={:?}",
        elapsed, flush_backoff
    );
    // Force flush if there's buffered data
    if !buffer.is_empty() {
        if try_flush(&config.url, &mut buffer) {
            flush_backoff = FLUSH_INTERVAL;
        } else {
            flush_backoff = (flush_backoff * 2).min(Duration::from_secs(60));
        }
    }
    last_flush = Instant::now();
    continue;  // Skip recv_timeout(ZERO), restart loop with fresh timer
}
```

This eliminates the spin by:

1. Resetting `last_flush` so the next iteration gets a real timeout
2. Flushing buffered data (the actual work that needs doing)
3. Using `continue` to skip the zero-timeout recv
4. Downgrading from `error!` to `debug!` to stop amplifying the event flood