# Dead Code Cleanup After Sidecar Port

Audit of dead code remaining after the Rust → Node.js sidecar port.

## Findings

### 1. Unused TypeScript command wrapper objects (`src/lib/tauri-commands.ts`)

Four exported objects are defined but **never imported or called** anywhere:

| Object | Lines | Status |
| --- | --- | --- |
| `threadCommands` | 341-357 | Fully dead — wrappers + underlying commands (`get_thread_status`, `get_thread`) are never invoked from frontend code |
| `lockCommands` | 363-376 | Fully dead — `lock_acquire_repo`, `lock_release_repo` never invoked from frontend code |
| `agentCommands` | 382-410 | Wrapper dead — but `send_to_agent` and `list_connected_agents` ARE used via direct `invoke()` in `src/lib/agent-service.ts` |
| `panelCommands` | 416-435 | Wrapper dead — but underlying commands ARE used via direct `invoke()` in `src/lib/hotkey-service.ts` |

**Also dead:** corresponding mock cases in `src/test/mocks/tauri-api.ts` (lines 176-190) for `get_thread_status`, `get_thread`, `lock_acquire_repo`, `lock_release_repo`.

### 2. Dead sidecar dispatch handlers (`sidecar/src/dispatch/dispatch-misc.ts`)

Since `get_thread_status` and `get_thread` are never called from the frontend, these sidecar handlers (lines 41-45) are dead code. Same for `lock_acquire_repo` / `lock_release_repo` (lines 82-91) — they exist in the sidecar but nothing calls them.

**Caveat:** These could be useful if re-enabled later. Flag for removal or mark as intentionally retained.

### 3. Unused sidecar code (`sidecar/src/managers/agent-hub.ts`)

- `isConnected(threadId)` **method** (lines 158-161) — never called
- `size` **getter** (lines 164-166) — never accessed

### 4. Unused import (`sidecar/src/dispatch/dispatch-fs.ts`)

- **Line 19:** `basename` imported from `node:path` but never used

### 5. Stale comments referencing old architecture

| File | Line | Issue |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | 4 | References "WS server" which no longer exists |
| `agents/src/testing/__tests__/queued-messages.integration.test.ts` | 14 | References "unique Unix socket" — transport is now WebSocket |

### 6. Unnecessary Rust re-exports (`src-tauri/src/accessibility/mod.rs`)

Lines 13-37 re-export types/constants (`AXUIElement`, `AXUIElementRef`, `AccessibilityError`, `AXError`, 16 `K_AX_ERROR_*` constants) that are only used internally within the accessibility module. The re-exports were likely for the deleted WS server.

**Low priority** — these don't add runtime cost, just API surface noise.

---

## Phases

- [x] Remove dead wrapper objects (`threadCommands`, `lockCommands`) and their test mocks from `tauri-commands.ts` and `tauri-api.ts`

- [x] Remove dead wrapper objects (`agentCommands`, `panelCommands`) — keep the underlying `invoke()` calls that are used directly

- [x] Remove unused `basename` import from `sidecar/src/dispatch/dispatch-fs.ts`

- [x] Remove unused `isConnected()` method and `size` getter from `sidecar/src/managers/agent-hub.ts`

- [x] Fix stale comments in `src-tauri/src/lib.rs` and `agents/src/testing/__tests__/queued-messages.integration.test.ts`

- [x] Remove unnecessary re-exports from `src-tauri/src/accessibility/mod.rs`

- [x] Remove dead sidecar dispatch handlers + helper functions for `get_thread_status`, `get_thread`, `lock_acquire_repo`, `lock_release_repo`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Notes

- The port is **very clean overall** — no orphaned module imports, no broken references, no dead Rust command registrations.
- The `agentCommands` and `panelCommands` wrappers are dead but the underlying commands work fine via direct `invoke()`. Removing the wrappers is safe.
- The sidecar dispatch handlers for thread/lock commands are a judgment call — they work but have no callers today.