# Gap Analysis

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

Gaps identified in the original plan after codebase review:

## Missing Files

### 1. Component Files (src/components/conversation/)

The plan mentions only 2 component renames, but the directory contains 17 files:

```
src/components/conversation/
├── index.ts              # Exports - needs updating
├── conversation-view.tsx # Mentioned
├── conversation-window.tsx # Mentioned
├── assistant-message.tsx # NOT in plan - has conversation refs
├── empty-state.tsx
├── error-state.tsx
├── file-change-block.tsx
├── loading-state.tsx
├── message-list.tsx      # NOT in plan - has conversation refs
├── status-announcement.tsx
├── streaming-cursor.tsx
├── system-message.tsx
├── text-block.tsx
├── thinking-block.tsx
├── tool-use-block.tsx
├── turn-renderer.tsx     # NOT in plan - has conversation refs
├── user-message.tsx
```

### 2. tauri-commands.ts Type Declarations

The plan mentions command wrapper renames but misses the **local type declarations**:
```typescript
// Lines 29-35 - Local types that duplicate the entity types
export type ConversationStatus = "running" | "completed" | "error" | "paused";
export interface ConversationMetadata {
  id: string;
  taskId: string;
  status: ConversationStatus;
}
```

Also missed: `processCommands` methods have `conversationId` parameters (lines 174-187).

### 3. Documentation Files

These files reference "Conversation" and should be updated:
- `DATA-MODELS.md` - Documents Conversation as a core entity
- `AGENTS.md` - References Conversation in data models section

### 4. Utility Files

- `src/lib/utils/turn-grouping.ts` - Grep hit, not in plan
- `src/lib/utils/tool-state.ts` - Grep hit, not in plan

### 5. lib.rs Command Names

The Rust command registration needs updates (not just function renames):
```rust
// Line 245-253 - Command names exposed to frontend
conversation_get_status  // → thread_get_status
get_conversation_status  // → get_thread_status
get_conversation        // → get_thread
```

### 6. lib.rs Function Comments

```rust
// Line 123 - Comment references "conversation"
/// Opens the conversation panel and displays a specific conversation
```

## Execution Order Issues

The original plan's execution order has a dependency issue:

**Problem**: Phase 2 (file renames) before Phase 1 types are complete will break imports.

**Corrected order**:
1. Update content in place first (types, functions, variables)
2. Rename files/directories last
3. Update imports after renames

## Missing Considerations

### Import Path Updates

After renaming directories, ~30+ import statements will need updating:
```typescript
// Before
import { ... } from "@/entities/conversations/...";
import { ... } from "@/components/conversation/...";

// After
import { ... } from "@/entities/threads/...";
import { ... } from "@/components/thread/...";
```

### Completed Plans

The `plans/completed/` directory has many references to "conversation". These are historical documentation - recommend **not updating** to preserve history.

### dist/ Directory

Contains compiled `conversation.html` and JS bundles. Will be regenerated on build - recommend running `pnpm build` as final verification step.

---

## Gap Resolution Status

All gaps have been addressed in the implementation plans:

| Gap | Resolved In |
|-----|-------------|
| 17 component files | 06-components.md |
| tauri-commands.ts local types | 02-typescript-types.md §3 |
| processCommands parameters | 04-stores-and-services.md §7 |
| DATA-MODELS.md, AGENTS.md | 10-documentation-and-utilities.md |
| Utility files | 10-documentation-and-utilities.md |
| lib.rs command names | 03-rust-backend.md §3 |
| lib.rs function comments | 03-rust-backend.md §3 (line 123 explicit) |
| Execution order | 00-overview.md corrected order |
| Import path updates | 00-overview.md comprehensive list |
| Completed plans (skip) | 10-documentation-and-utilities.md |
| dist/ directory | 11-verification.md
