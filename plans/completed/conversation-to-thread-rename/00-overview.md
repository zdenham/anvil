# Code Mod: Rename "Conversation" to "Thread"

> **IMPORTANT: This is a NAMING-ONLY change.**
>
> No functionality should be added, removed, or modified. This is purely a terminology/naming refactor:
> - Rename types, variables, functions, files, and directories
> - Update string literals and comments
> - **DO NOT** change any logic, behavior, or add new features
> - **DO NOT** "improve" or refactor code while renaming
> - If you see something that could be improved, note it for a separate PR

## Task Breakdown

This task has been broken down into the following subtasks:

| # | File | Description | Priority |
|---|------|-------------|----------|
| 01 | [01-gap-analysis.md](./01-gap-analysis.md) | Gaps found in original plan | Reference |
| 02 | [02-typescript-types.md](./02-typescript-types.md) | TypeScript types & interfaces | **High** |
| 03 | [03-rust-backend.md](./03-rust-backend.md) | Rust backend changes | **High** |
| 04 | [04-stores-and-services.md](./04-stores-and-services.md) | Zustand stores & services | Medium |
| 05 | [05-hooks.md](./05-hooks.md) | React hooks | Medium |
| 06 | [06-components.md](./06-components.md) | React components | Medium |
| 07 | [07-events.md](./07-events.md) | Event system | Medium |
| 08 | [08-agent-runner.md](./08-agent-runner.md) | Node.js agent runner | Medium |
| 09 | [09-entry-points-and-config.md](./09-entry-points-and-config.md) | HTML, Vite, Tauri config | Low |
| 10 | [10-documentation-and-utilities.md](./10-documentation-and-utilities.md) | Docs & utilities | Low |
| 11 | [11-verification.md](./11-verification.md) | Testing & validation | Final |

## Corrected Execution Order

**Important**: Update content BEFORE renaming files/directories.

1. **Phase 1**: TypeScript types (02-typescript-types.md)
2. **Phase 2**: Rust backend (03-rust-backend.md)
3. **Phase 3**: Stores & services (04-stores-and-services.md)
4. **Phase 4**: Hooks (05-hooks.md)
5. **Phase 5**: Components (06-components.md)
6. **Phase 6**: Events (07-events.md)
7. **Phase 7**: Agent runner (08-agent-runner.md)
8. **Phase 8**: Entry points & config (09-entry-points-and-config.md)
9. **Phase 9**: Documentation (10-documentation-and-utilities.md)
10. **Phase 10**: Verification (11-verification.md)

## Key Gaps Found (see 01-gap-analysis.md)

- **17 component files** in `src/components/conversation/` (plan only mentioned 2)
- **Local type declarations** in `tauri-commands.ts` duplicating entity types
- **Documentation files** (DATA-MODELS.md, AGENTS.md) not in original plan
- **processCommands** parameter names (`conversationId`) not mentioned
- **Import path updates** needed after directory renames (~30+ files)

## Import Path Updates After Directory Renames

After renaming `src/entities/conversations/` → `src/entities/threads/` and `src/components/conversation/` → `src/components/thread/`, the following files will need import path updates:

### Files importing from `@/entities/conversations/`
- src/entities/index.ts
- src/entities/events.ts
- src/entities/tasks/service.ts
- src/lib/agent-service.ts
- src/lib/workspace-service.ts
- src/lib/tauri-commands.ts
- src/hooks/use-conversation-messages.ts
- src/hooks/use-streaming-conversation.ts
- src/hooks/use-agent-execution.ts
- src/components/conversation/*.tsx (all component files)
- src/components/spotlight/spotlight.tsx
- src/conversation-main.tsx (→ thread-main.tsx)

### Files importing from `@/components/conversation/`
- src/components/index.ts (if exists)
- src/conversation-main.tsx (→ thread-main.tsx)
- Any other files that import conversation components

**Note**: TypeScript's `--noUnusedLocals` and type checking will catch missing imports. Run `pnpm typecheck` after directory renames to identify all files needing updates.

---

## Rationale

"Thread" is a more appropriate name for what we're calling "conversations". The current name implies multi-turn back-and-forth dialogue, but in practice most interactions consist of a single action/instruction followed by agent responses.

## Scope Summary

This is a global rename affecting:
- **85+ files** with conversation references
- **8 files** with "conversation" in their filename
- **1 directory** to rename (`src/entities/conversations/`)
- **TypeScript types, Rust structs, and constants**
- **Event names, store names, hook names**

## Phase 1: TypeScript Types & Interfaces

### File: `src/entities/conversations/types.ts` → `src/entities/threads/types.ts`

```typescript
// Rename types
ConversationStatus → ThreadStatus
ConversationTurn → ThreadTurn
ConversationMetadata → ThreadMetadata
CreateConversationInput → CreateThreadInput
UpdateConversationInput → UpdateThreadInput
```

### File: `src/entities/conversations/store.ts` → `src/entities/threads/store.ts`

```typescript
// Rename interfaces
ConversationState → ThreadState
ConversationActions → ThreadActions
ConversationUIState → ThreadUIState
ConversationUIActions → ThreadUIActions

// Rename store hooks
useConversationStore → useThreadStore
useConversationUIStore → useThreadUIStore

// Rename methods
getConversation → getThread
getConversationsByTask → getThreadsByTask
getConversationsByStatus → getThreadsByStatus
getRunningConversations → getRunningThreads
setConversation → setThread

// Rename selectors (if exported)
selectConversation → selectThread
```

### File: `src/entities/conversations/service.ts` → `src/entities/threads/service.ts`

```typescript
// Rename class/service
conversationService → threadService

// Rename methods
getConversation → getThread
createConversation → createThread
updateConversation → updateThread
// etc.
```

### File: `src/lib/types/agent-messages.ts`

```typescript
ConversationState → ThreadState (if exists)
```

## Phase 2: Directory & File Renames

### Directories
```
src/entities/conversations/ → src/entities/threads/
src/components/conversation/ → src/components/thread/
```

### Files
```
conversation.html → thread.html
src/conversation-main.tsx → src/thread-main.tsx
src/components/conversation/conversation-window.tsx → src/components/thread/thread-window.tsx
src/components/conversation/conversation-view.tsx → src/components/thread/thread-view.tsx
src/hooks/use-conversation-messages.ts → src/hooks/use-thread-messages.ts
src/hooks/use-streaming-conversation.ts → src/hooks/use-streaming-thread.ts
src-tauri/src/conversation_commands.rs → src-tauri/src/thread_commands.rs
```

## Phase 3: Event Names

### File: `src/entities/events.ts`

```typescript
// Rename event keys
"conversation:created" → "thread:created"
"conversation:updated" → "thread:updated"
"conversation:status-changed" → "thread:status-changed"

// Update payload types
{ conversationId: string } → { threadId: string }
{ metadata: ConversationMetadata } → { metadata: ThreadMetadata }
```

### Tauri Events (Rust → JS)
```
"open-conversation" → "open-thread"
```

## Phase 4: Rust Backend

### File: `src-tauri/src/conversation_commands.rs` → `src-tauri/src/thread_commands.rs`

```rust
// Rename functions
get_conversations_dir → get_threads_dir
get_conversation_status → get_thread_status
get_conversation → get_thread

// Update paths
.join("conversations") → .join("threads")
```

### File: `src-tauri/src/panels.rs`

```rust
// Rename constants
CONVERSATION_LABEL → THREAD_LABEL  // "conversation" → "thread"

// Rename functions
create_conversation_panel → create_thread_panel
show_conversation → show_thread
hide_conversation → hide_thread

// Update comments and log messages
```

### File: `src-tauri/src/lib.rs`

```rust
// Rename module import
mod conversation_commands → mod thread_commands

// Rename exported functions
open_conversation → open_thread
hide_conversation → hide_thread
conversation_get_status → thread_get_status
```

### File: `src-tauri/src/process_commands.rs`

```rust
// Rename parameters
conversation_id → thread_id
```

### File: `src-tauri/src/anvil_commands.rs`

```rust
// Rename function
conversation_get_status → thread_get_status

// Update path references
.join("conversations") → .join("threads")
```

## Phase 5: Agent Runner (Node.js)

### File: `agents/src/runner.ts`

```typescript
// Rename CLI arg
--conversation-id → --thread-id

// Rename variables
conversationId → threadId
conversationPath → threadPath

// Update path
.join("conversations") → .join("threads")
```

### File: `agents/src/output.ts`

```typescript
// Update comments referencing "conversation"
// Rename parameters if any
conversationPath → threadPath
```

## Phase 6: Core Types

### File: `core/types/index.ts`

```typescript
CONVERSATIONS_DIR → THREADS_DIR  // "conversations" → "threads"
```

## Phase 7: Configuration & Build Files

### File: `vite.config.ts`

Update any references to `conversation.html` entry point.

### File: `src-tauri/capabilities/default.json`

Update any window labels or permissions referencing "conversation".

## Phase 8: Hooks & Components

### React Hooks
```
useConversationMessages → useThreadMessages
useStreamingConversation → useStreamingThread
useAgentExecution (update internal conversation refs)
```

### Components
```
ConversationWindow → ThreadWindow
ConversationView → ThreadView
ConversationPanel → ThreadPanel
```

## Phase 9: Services & Utilities

### File: `src/lib/agent-service.ts`

Update all references to conversation → thread.

### File: `src/lib/workspace-service.ts`

Update conversation references.

### File: `src/lib/event-bridge.ts`

Update event names and types.

### File: `src/lib/tauri-commands.ts`

```typescript
// Rename command wrappers
openConversation → openThread
hideConversation → hideThread
getConversationStatus → getThreadStatus
```

### File: `src/lib/hotkey-service.ts`

Update any conversation-related hotkey handlers.

## Phase 10: Task Entity Updates

### File: `src/entities/tasks/service.ts`

```typescript
linkConversation → linkThread
unlinkConversation → unlinkThread
```

### File: `src/entities/tasks/types.ts`

Update any conversation-related fields:
```typescript
conversationIds → threadIds
```

## Phase 11: Index Exports

### File: `src/entities/index.ts`

Update re-exports from conversations → threads.

### File: `src/entities/conversations/index.ts` → `src/entities/threads/index.ts`

Update all exports.

### File: `src/hooks/index.ts`

Update hook exports.

## Execution Order

1. **Types first** - Update all TypeScript types and interfaces
2. **Rust backend** - Update Rust code and rebuild
3. **Core constants** - Update shared constants
4. **Services** - Update service layer
5. **Stores** - Update Zustand stores
6. **Hooks** - Update React hooks
7. **Components** - Update React components
8. **Events** - Update event system
9. **Entry points** - Rename HTML and main files
10. **Config** - Update build configuration
11. **Test & verify** - Full build and manual testing

## Data Migration

The `~/.anvil/conversations/` directory will need to be renamed to `~/.anvil/threads/`. This can be handled:

1. **Option A**: Add a one-time migration on app startup that renames the directory
2. **Option B**: Document as a breaking change (acceptable since app hasn't launched)

Recommended: **Option B** - Just document the change. Users can manually rename or start fresh.

## Search Patterns for Validation

After completion, these searches should return 0 results:
```bash
rg -i "conversation" --type ts --type tsx --type rs
rg "Conversation" --type ts --type tsx --type rs
rg "conversation" --glob "*.html"
```

## Files to Update (Complete List)

### Must Rename (8 files + 2 directories)
- [ ] `conversation.html` → `thread.html`
- [ ] `src/conversation-main.tsx` → `src/thread-main.tsx`
- [ ] `src/entities/conversations/` → `src/entities/threads/`
- [ ] `src/components/conversation/` → `src/components/thread/`
- [ ] `src/hooks/use-conversation-messages.ts` → `src/hooks/use-thread-messages.ts`
- [ ] `src/hooks/use-streaming-conversation.ts` → `src/hooks/use-streaming-thread.ts`
- [ ] `src-tauri/src/conversation_commands.rs` → `src-tauri/src/thread_commands.rs`

### Must Update Content (60+ files)
See grep results - all files containing "conversation" or "Conversation".

## Notes

- No backwards compatibility needed (pre-launch)
- All IDE imports should auto-update if using TypeScript project references
- Rust module renames require updating `mod` declarations in `lib.rs`
- The Tauri window label change may require capability updates
