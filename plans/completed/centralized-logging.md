# Centralized Logging System

## Overview

Implement a centralized logging system with two output streams:
- **Detailed (JSON Lines)**: Structured logs with metadata for LLM querying
- **Pretty (Console)**: Colored, human-readable output

## Approach: Use `tracing` crate

The `tracing` crate over `log` because:
- First-class structured metadata (fields, spans)
- Built-in JSON output via `tracing-subscriber`
- Composable layers for dual output streams
- Works well with background threads (clipboard, icons, app search)

## Files to Modify

| File | Action |
|------|--------|
| `src-tauri/Cargo.toml` | Add tracing dependencies |
| `src-tauri/src/logging.rs` | **New**: Centralized logging module |
| `src-tauri/src/lib.rs` | Initialize logging, update web_log, replace 4 prints |
| `src-tauri/src/clipboard.rs` | Replace 6 println!/eprintln! |
| `src-tauri/src/clipboard_db.rs` | Replace 1 println! |
| `src-tauri/src/app-search.rs` | Replace 1 println! |
| `src-tauri/src/icons.rs` | Replace 2 println!/eprintln! |
| `src-tauri/src/filesystem.rs` | Replace 3 eprintln! |
| `AGENTS.md` | Add logging guidelines section |

## Implementation Steps

### 1. Add Dependencies (Cargo.toml)

```toml
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
```

### 2. Create logging.rs Module

Core module providing:
- `initialize()` - Sets up dual-output subscriber
- `log_from_web(level, message, metadata)` - Bridge for frontend logs

Two layers:
- **JSON layer**: Writes to `logs/structured.jsonl` with timestamps, thread IDs, module paths, custom fields
- **Console layer**: Colored compact output with uptime timer

### 3. JSON Log Format (for LLM querying)

```json
{"timestamp":"2025-12-19T08:30:45.123Z","level":"INFO","target":"desktop_lib::clipboard","message":"Database initialized","threadId":"ThreadId(2)","fields":{"entries":323}}
```

### 4. Pretty Console Format (for humans)

```
  0.001s  INFO clipboard: Database initialized with 323 entries
  0.145s  INFO app_search: App index built: 149 apps in 145ms
  0.200s  INFO [WEB] Settings loaded
```

### 5. Migration Pattern

Replace all println!/eprintln! with tracing macros:

```rust
// Before
println!("[clipboard] Database initialized with {} entries", count);

// After
tracing::info!(entries = count, "Database initialized");
```

```rust
// Before
eprintln!("Failed to create panel: {}", e);

// After
tracing::error!(error = %e, "Failed to create panel");
```

### 6. Update AGENTS.md

Add new section:

```markdown
## Logging

Use the centralized logging system. Never use `println!`, `eprintln!`, or `console.log`.

### Rust
```rust
use tracing::{info, warn, error, debug};

info!("Operation completed");
info!(count = 42, duration_ms = 150, "Index built");
error!(error = %e, "Operation failed");
```

### TypeScript
```typescript
import { logger } from "@/lib/logger-client";

logger.info("Operation completed");
logger.error("Failed to load");
```

### Log Locations
- Console: Colored output during development
- File: `logs/structured.jsonl` (JSON Lines for LLM querying)
```

## Migration Order

1. `Cargo.toml` - Add dependencies
2. `logging.rs` - Create new module
3. `lib.rs` - Initialize logging first, update web_log
4. `clipboard_db.rs` - Independent module
5. `clipboard.rs` - Depends on clipboard_db
6. `icons.rs` - Independent
7. `app-search.rs` - Independent
8. `filesystem.rs` - Independent
9. `AGENTS.md` - Update documentation
