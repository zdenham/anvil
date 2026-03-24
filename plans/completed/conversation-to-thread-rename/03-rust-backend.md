# Phase 2: Rust Backend

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: High - must complete before frontend services can work correctly.

## Files to Update

### 1. src-tauri/src/conversation_commands.rs

```rust
// Rename functions
get_conversations_dir → get_threads_dir
get_conversation_status → get_thread_status
get_conversation → get_thread

// Update paths
.join("conversations") → .join("threads")

// Rename parameters
conversation_id → thread_id
```

### 2. src-tauri/src/panels.rs

```rust
// Rename constants
CONVERSATION_LABEL → THREAD_LABEL  // value: "conversation" → "thread"

// Rename functions
create_conversation_panel → create_thread_panel
show_conversation → show_thread
hide_conversation → hide_thread

// Update comments and log messages
// "conversation" → "thread" in all strings
```

### 3. src-tauri/src/lib.rs

```rust
// Line 6: Rename module import
mod conversation_commands → mod thread_commands

// Line 123: Update doc comment
/// Opens the conversation panel... → /// Opens the thread panel...

// Lines 123-138: Rename exported commands AND their function names
#[tauri::command]
fn open_conversation → fn open_thread
fn hide_conversation → fn hide_thread

// Lines 245-254: Update command registrations
conversation_get_status → thread_get_status
conversation_commands::get_conversation_status → thread_commands::get_thread_status
conversation_commands::get_conversation → thread_commands::get_thread

// Line 283: Update panel creation call
panels::create_conversation_panel → panels::create_thread_panel

// Update all comments referencing "conversation"
```

### 4. src-tauri/src/process_commands.rs

```rust
// Rename parameters in function signatures
conversation_id: String → thread_id: String

// Update any internal variable names
```

### 5. src-tauri/src/anvil_commands.rs

```rust
// Rename function
conversation_get_status → thread_get_status

// Update path references
.join("conversations") → .join("threads")
```

## File Rename

After updating content:
```bash
mv src-tauri/src/conversation_commands.rs src-tauri/src/thread_commands.rs
```

## Verification

```bash
# Build Rust backend
cargo check
cargo build
```

## Checklist

- [ ] conversation_commands.rs - update all function names and paths
- [ ] panels.rs - update constants, functions, strings
- [ ] lib.rs - update module import, commands, registrations
- [ ] process_commands.rs - update parameter names
- [ ] anvil_commands.rs - update function and paths
- [ ] Rename conversation_commands.rs → thread_commands.rs
- [ ] cargo check passes
- [ ] cargo build passes
