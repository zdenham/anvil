# Design Decisions

## Architecture Decisions

### Sub-Agent Identity
Use the same thread ID convention as regular threads (UUID). The SDK's `agent_id` is not stored - we generate our own `threadId` on SubagentStart.

### Sub-Agent Storage
Sub-agents persist as standalone threads in `~/.mort/threads/`. Same lifecycle as any thread - no special cleanup logic needed.

### Sub-Agent Events
Reuse existing thread events (THREAD_CREATED, THREAD_STATE, THREAD_STATUS_CHANGED). No new event types. Frontend detects sub-agents by checking `parentThreadId !== undefined`.

### Sub-Agent Store
Use existing thread store. No separate SubAgentStore. Query helpers like `getChildThreads(parentId)` can be added to existing store.

### Message Routing Mapping
In-memory only in the agent runner (`toolUseId -> childThreadId`). Cleared on process exit. Child thread has `parentToolUseId` in metadata for reverse lookup if needed later.

---

## Tree & Navigation Decisions

### Tree Display
Sub-agents appear nested under their parent thread in the tree menu. Same indentation pattern as nested plans. Threads become folders when they have sub-agent children.

### Tree Click Behavior
Single click navigates to the sub-agent thread view. Also expands children in tree when applicable (if the sub-agent has nested sub-agents).

### Sub-Agent Location in Tree
Sub-agent threads ONLY appear nested under their parent in the tree. They do NOT appear independently in date sections. Sub-agents are always children of their parent thread.

### Parallel Sub-Agents
No special grouping. Multiple parallel sub-agents are listed sequentially as siblings using the normal tree structure.

### Nested Sub-Agents
Use same `parentId` pattern as plans. `parentThreadId` points to parent sub-agent's thread ID for nested cases.

---

## UI Decisions

### Sub-Agent View
Opening a sub-agent displays it in the normal thread content view. Same view as any thread, but read-only (no input field, no cancel button).

### Read-Only Detection
A thread is read-only if `parentThreadId !== undefined`. No separate `isReadOnly` flag needed.

### Parent Thread Display
When a sub-agent is created, the parent shows a sub-agent reference block (replaces the Task tool block). Shows name + status + tool call count + link button. Child tool calls are NOT displayed in parent - users click to see details.

### Reference Block Content
Shows name, flashing status indicator while running, tool call count, and "Open" button. Tool count is read from the child thread's state.

### Running Indicator
Use the same flashing status dot pattern as other running tool blocks. Consistent visual language.

### Tool Call Count Format
Display as "3 tool calls" (full text). Clear and unambiguous.

### Empty Sub-Agent (Zero Tools)
Show flashing indicator while running. When complete with 0 tools, show complete status (no tool count line).

---

## Navigation Decisions

### Back Navigation
Explicit "← Back to parent" link in the header plus breadcrumbs showing the hierarchy.

### Breadcrumb Format
Show parent thread name (truncated with ellipsis if needed) and current sub-agent name. Example: "← Implement auth > Exploring patterns"

### Navigate Away While Running
Allow freely. Sub-agents continue running (shell process is independent of UI). User can return anytime.

### Reference Block Click
Always navigate to child thread, even if still running. Shows streaming content in real-time.

---

## Naming Decisions

### Sub-Agent Naming
Use existing thread-naming-service with fire-and-forget flow. Initial name is `{agentType}: {description}`, then async LLM rename emits same rename event as regular threads.

---

## Lifecycle Decisions

### Thread Creation Timing
Sub-agent thread is created from the agent process when `SubagentStart` fires. Ensures thread exists before any messages stream in.

### Archival Behavior
Cascaded archive. When a parent thread is archived, all child sub-agent threads are also archived. Sub-agents are contextually tied to their parent.

---

## Background Agent Policy

### Background Agent Handling
Discouraged via system prompt instruction. Not blocked by hook - soft enforcement only. Background agents will still work but provide degraded UX (no streaming).

**Rationale**: Simpler implementation, allows user override when explicitly needed, avoids jarring hard rejections. Parallel foreground agents provide same concurrency benefit with full visibility.

---

## Summary Table

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sub-agent storage | Same as threads (`~/.mort/threads/`) | Maximum reuse |
| Sub-agent events | Reuse THREAD_* events | No new event types |
| Sub-agent store | Existing thread store | No new store |
| Sub-agent naming | Existing thread-naming-service | No new service |
| Tree display | Nested under parent | Same pattern as plans |
| Parent display | Reference block with flashing indicator | Consistent with running tools |
| Read-only detection | `parentThreadId !== undefined` | Simple, no flags |
| Background agents | Discouraged via system prompt | Soft enforcement |
