# Fix Global File Search Bricking the App

## Problem

Global file search makes the entire app unresponsive — no results come back and nothing works until the search eventually completes or times out.

## Root Cause

**The WebSocket request loop is serial, and search commands block the tokio runtime.**

Three issues compound into a total app freeze:

### 1. Serial WebSocket dispatch blocks all commands (PRIMARY)

`ws_server/mod.rs:136-199` — `process_requests()` processes messages in a sequential `while let` loop. Each request must complete before the next one starts:

```rust
while let Some(msg) = receiver.next().await {
    // ...
    let response = dispatch::dispatch(...).await;  // ← blocks entire loop
    // ...send response...
}
```

When `git_grep` takes 10+ seconds, **every other WebSocket command queues behind it** — navigation, UI state, other searches, everything. This is why the app appears completely bricked, not just the search.

### 2. Blocking `std::process::Command::output()` on async runtime

`git_commands.rs:89-93` and `search.rs:136-139` — Both `git_grep` and `search_threads` call `shell::command("...").output()` which is `std::process::Command::output()` — a **synchronous, blocking** call. These run directly on the tokio async runtime instead of being offloaded to a blocking thread pool via `spawn_blocking`.

On large repos, `git grep` can take 10-60+ seconds. This blocks a tokio worker thread, reducing throughput for all async tasks.

### 3. 30-second frontend timeout with no cancellation

`invoke.ts:16` — `REQUEST_TIMEOUT_MS = 30_000`. The frontend rejects after 30s, but:

- The backend git process keeps running (no cancellation)
- The serial WS loop is still blocked waiting for it to finish
- The timed-out response arrives later and gets silently dropped
- Subsequent searches stack up because the prior one is still blocking

## Phases

- [ ] Phase 1: Concurrent WS dispatch — spawn each request as a tokio task

- [ ] Phase 2: Offload blocking I/O via `spawn_blocking`

- [ ] Phase 3: Add search cancellation (abort in-flight search when new one starts)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Concurrent WS dispatch

**File:** `src-tauri/src/ws_server/mod.rs`

Change `process_requests` to spawn each dispatch as an independent tokio task instead of awaiting it inline. This way a slow `git_grep` doesn't block all other commands.

```rust
async fn process_requests(
    receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    sender: &Arc<tokio::sync::Mutex<SplitSink<WebSocket, Message>>>,
    state: &Arc<WsState>,
) {
    while let Some(msg) = receiver.next().await {
        // ... parse message, extract request ...

        let sender = sender.clone();
        let state = state.clone();
        tokio::spawn(async move {
            let response = dispatch::dispatch(id, &cmd, args, &state).await;
            // ... serialize and send response ...
            let mut guard = sender.lock().await;
            let _ = guard.send(Message::Text(json.into())).await;
        });
    }
}
```

Key changes:

- Clone `sender` and `state` into each spawned task
- Parse the request (including `cmd` as owned `String`) before spawning
- Responses may arrive out of order — this is fine, the frontend matches by `id`
- Relay messages and parse errors can still be handled inline (they're cheap)

## Phase 2: Offload blocking I/O via `spawn_blocking`

**Files:** `src-tauri/src/git_commands.rs`, `src-tauri/src/search.rs`

Wrap every `shell::command(...).output()` call in `tokio::task::spawn_blocking` so they don't block tokio worker threads.

For `git_grep` (and similar pattern for all other commands):

```rust
pub async fn git_grep(...) -> Result<GrepResponse, String> {
    // ... build args (this part stays synchronous, it's cheap) ...

    let output = tokio::task::spawn_blocking(move || {
        shell::command("git")
            .args(&args)
            .current_dir(&repo_path)
            .output()
    })
    .await
    .map_err(|e| format!("task join error: {}", e))?
    .map_err(|e| e.to_string())?;

    // ... parse output (also cheap, keep inline) ...
}
```

Apply the same pattern to:

- `git_grep` (git_commands.rs:89)
- `find_matching_files` ([search.rs:136](http://search.rs:136))
- `get_line_matches` ([search.rs:179](http://search.rs:179))
- All other `shell::command(...).output()` calls in git_commands.rs

This is tedious but mechanical — every `.output()` call gets the same `spawn_blocking` wrapper.

**Consider a helper** to reduce boilerplate:

```rust
/// Run a blocking shell command on the tokio blocking thread pool.
async fn run_blocking(mut cmd: std::process::Command) -> Result<std::process::Output, String> {
    tokio::task::spawn_blocking(move || cmd.output())
        .await
        .map_err(|e| format!("task join error: {}", e))?
        .map_err(|e| e.to_string())
}
```

Then every call site becomes: `let output = run_blocking(shell::command("git").args(&args).current_dir(&repo_path)).await?;`

## Phase 3: Search cancellation

**Files:** `src/components/search-panel/use-search.ts`, `src-tauri/src/ws_server/mod.rs` (optional)

The frontend already has `requestCounter` to discard stale results, but the backend search process runs to completion. Two improvements:

### 3a. Frontend: AbortController pattern

Add an `AbortController` ref to `useSearch` that aborts the prior in-flight search when a new one starts. This prevents stale promise resolutions from racing:

```typescript
const abortRef = useRef<AbortController>();

const executeSearch = useCallback(async (q: string, counter: number) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    // ... pass signal to search commands if possible ...
}, [...]);
```

Since WebSocket requests can't be truly "aborted" on the wire, this at minimum prevents the `.then()` handlers from running on stale searches. The `requestCounter` pattern already handles this, so this is a minor improvement.

### 3b. Backend: Process kill on new search (stretch goal)

Store the child PID of the in-flight git grep process. When a new search arrives, kill the old one. This requires:

- Changing `shell::command("git").output()` to `.spawn()` + `.wait()` so we get a `Child` handle
- Storing the handle in a `Mutex<Option<Child>>` on `WsState`
- On new search dispatch, `child.kill()` the old one

This is more involved and could be a follow-up. Phases 1 and 2 alone should resolve the "bricking" since other commands will no longer queue behind search.

## Impact

- **Phase 1** alone fixes the "bricking" — other commands process concurrently even while search is slow
- **Phase 2** prevents search from starving the tokio runtime on multi-core machines
- **Phase 3** prevents wasted CPU on searches the user has already abandoned

## Testing

- Open search panel, type a common string (e.g. "const"), verify app remains responsive
- Navigate to other views while a search is running
- Type rapidly and confirm only the final search result appears
- Test on a large repo to verify no timeouts on reasonable queries