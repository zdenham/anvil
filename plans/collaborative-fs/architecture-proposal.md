# Line-Based CRDT Architecture for Agentic Code Collaboration

## Overview

This document proposes a collaborative file system designed specifically for **agentic programming workflows**, where AI agents produce code as diff hunks rather than character-by-character edits. The architecture uses a **line-based CRDT** that sits between agent writes and the file system, with **deterministic conflict resolution** and a separate **conflict broadcast system** for semantic conflicts.

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent A                                  │
│                    (produces diff hunks)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                    Line-Based CRDT Layer                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  • Converts diff hunks to CRDT operations                  │ │
│  │  • Assigns unique IDs to lines (agent_id + sequence)       │ │
│  │  • Maintains causal ordering via left_origin references    │ │
│  │  • Deterministic merge for all operations                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  Conflict Detection                        │ │
│  │                                                             │ │
│  │  Same-line edits detected → stored as Multi-Value Register │ │
│  │  All replicas converge to identical conflict state         │ │
│  └──────────────────────────┬─────────────────────────────────┘ │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
┌──────────────────────────┐      ┌──────────────────────────────┐
│      File System         │      │   Conflict Broadcast System   │
│                          │      │                                │
│  project/                │      │  Notifies resolution agents    │
│    src/app.js            │      │  with context from both sides  │
│    src/utils.py          │      │                                │
│  .crdt/                  │      │  Resolution becomes new CRDT   │
│    state.db              │      │  operation (deterministic)     │
└──────────────────────────┘      └──────────────────────────────┘
```

---

## Why Line-Based (Not Character-Based)

### The Mismatch Problem

Traditional CRDTs (Yjs, Automerge) are designed for human typing:

```
Human: H → He → Hel → Hell → Hello
       (one character at a time, ~200ms between operations)
```

Agents produce complete hunks:

```
Agent: "Replace lines 15-27 with this new implementation"
       (atomic operation, entire block at once)
```

### Benefits of Line Granularity

| Aspect | Character CRDT | Line CRDT |
|--------|----------------|-----------|
| Metadata per file (1000 lines) | ~50,000 IDs | ~1,000 IDs |
| Operation size | 1 byte payload | Whole line payload |
| Merge complexity | Higher | Lower |
| Maps to diff hunks | Poorly | Directly |
| Tombstone overhead | High | Lower |

---

## Data Model

### Core Types

```rust
/// Unique identifier for a line
struct LineId {
    agent_id: AgentId,      // Which agent created this line
    seq: u64,               // Monotonically increasing per agent
}

/// A single line in the CRDT
struct Line {
    id: LineId,
    content: String,
    left_origin: LineId,    // What was to my left when created
    group_id: HunkId,       // Lines from same hunk stay together
    deleted: bool,          // Tombstone flag
    hlc: HybridLogicalClock, // For ordering concurrent operations
}

/// The complete file state
struct LineCRDT {
    file_path: PathBuf,
    lines: BTreeMap<LineId, Line>,

    // Conflicts stored as multi-value register
    conflicts: BTreeMap<LineId, ConflictSet>,
}

/// When multiple agents edit the same line
struct ConflictSet {
    base_line_id: LineId,
    base_content: String,
    versions: BTreeMap<(HLC, AgentId), String>,  // Deterministic ordering
}
```

### Operations

```rust
enum Operation {
    /// Insert new lines after a reference point
    Insert {
        after: LineId,
        lines: Vec<(LineId, String)>,
        group_id: HunkId,
    },

    /// Mark lines as deleted (tombstone)
    Delete {
        line_ids: Vec<LineId>,
    },

    /// Replace lines (sugar for Delete + Insert)
    Replace {
        delete_ids: Vec<LineId>,
        after: LineId,
        new_lines: Vec<(LineId, String)>,
        group_id: HunkId,
    },

    /// Resolve a conflict (broadcast by resolution agent)
    ResolveConflict {
        conflict_id: LineId,
        resolution: String,
        resolver_id: AgentId,
        resolution_hlc: HLC,
    },
}
```

---

## How Agent Diffs Become CRDT Operations

### Input: Standard Unified Diff

```diff
@@ -10,4 +10,6 @@
 function calculateTotal(items) {
-  return items.reduce((sum, item) => sum + item.price, 0);
+  return items.reduce((sum, item) => {
+    const price = item.price ?? 0;
+    return sum + price;
+  }, 0);
 }
```

### Conversion Process

```rust
fn diff_to_operations(diff: &UnifiedDiff, file_state: &LineCRDT) -> Vec<Operation> {
    let mut ops = vec![];
    let group_id = HunkId::new();  // All lines in this hunk share group

    for hunk in diff.hunks() {
        // Find the anchor line (line before the change)
        let anchor_id = file_state.line_id_at(hunk.start_line - 1);

        // Collect lines to delete
        let delete_ids: Vec<_> = hunk.removed_lines()
            .map(|line_num| file_state.line_id_at(line_num))
            .collect();

        // Create new lines with unique IDs
        let new_lines: Vec<_> = hunk.added_lines()
            .map(|content| (LineId::new(), content))
            .collect();

        ops.push(Operation::Replace {
            delete_ids,
            after: anchor_id,
            new_lines,
            group_id,
        });
    }

    ops
}
```

---

## Deterministic Merge Algorithm

### Core Principle

**Every replica must compute the exact same result given the same operations, regardless of the order operations are received.**

### Merge Rules

```rust
impl LineCRDT {
    fn apply(&mut self, op: Operation) {
        match op {
            Operation::Insert { after, lines, group_id } => {
                for (id, content) in lines {
                    if self.lines.contains_key(&id) {
                        continue;  // Idempotent: already have this line
                    }

                    self.lines.insert(id, Line {
                        id,
                        content,
                        left_origin: after,
                        group_id,
                        deleted: false,
                        hlc: HLC::now(),
                    });
                }

                self.recompute_order();
            }

            Operation::Delete { line_ids } => {
                for id in line_ids {
                    if let Some(line) = self.lines.get_mut(&id) {
                        line.deleted = true;  // Tombstone, don't remove
                    }
                }
            }

            Operation::Replace { delete_ids, after, new_lines, group_id } => {
                // Check for same-line conflict
                let dominated_lines = self.find_concurrent_replacements(&delete_ids);

                if !dominated_lines.is_empty() {
                    // Store as conflict, don't apply directly
                    self.record_conflict(delete_ids, new_lines, dominated_lines);
                } else {
                    // Clean replacement
                    self.apply(Operation::Delete { line_ids: delete_ids });
                    self.apply(Operation::Insert { after, lines: new_lines, group_id });
                }
            }

            Operation::ResolveConflict { conflict_id, resolution, .. } => {
                // Resolution is itself a deterministic operation
                self.conflicts.remove(&conflict_id);
                // Insert resolved content
            }
        }
    }

    fn recompute_order(&mut self) -> Vec<LineId> {
        // Topological sort based on left_origin
        // Tie-break by: (group_id, line_id) for determinism
    }
}
```

### Ordering Concurrent Inserts

When two agents insert after the same line:

```
Base state:
  A1: "function foo() {"
  A2: "}"

Agent A inserts after A1: [(B1, "  console.log('a');")]
Agent B inserts after A1: [(C1, "  console.log('b');")]
```

Deterministic ordering:

```rust
fn order_concurrent_inserts(a: &Line, b: &Line) -> Ordering {
    // 1. Group ID (lines from same hunk stay together)
    match a.group_id.cmp(&b.group_id) {
        Ordering::Equal => {},
        other => return other,
    }

    // 2. HLC timestamp
    match a.hlc.cmp(&b.hlc) {
        Ordering::Equal => {},
        other => return other,
    }

    // 3. Agent ID (final tie-breaker, always deterministic)
    a.id.agent_id.cmp(&b.id.agent_id)
}
```

Result (assuming B's HLC < C's HLC):

```
A1: "function foo() {"
B1: "  console.log('a');"
C1: "  console.log('b');"
A2: "}"
```

Both replicas compute identical order.

---

## Conflict Detection and Resolution

### What Triggers a Conflict

A conflict occurs when **two agents delete (replace) the same line**:

```
Agent A: Delete A2, Insert "  return x + 1;"
Agent B: Delete A2, Insert "  return x * 2;"
```

Both want to replace line A2. This is detected deterministically.

### Conflict State (Multi-Value Register)

```rust
struct ConflictSet {
    base_line_id: LineId,           // A2
    base_content: String,           // Original content
    versions: BTreeMap<(HLC, AgentId), String>,
    // {
    //   (hlc_a, agent_a): "  return x + 1;",
    //   (hlc_b, agent_b): "  return x * 2;",
    // }
}
```

All replicas converge to the **same conflict state**. The file shows:

```
function calculate(x) {
  <<<<<<< Agent A (add one)
    return x + 1;
  ======= Agent B (double)
    return x * 2;
  >>>>>>>
}
```

### Conflict Broadcast System

When a conflict is detected, it's broadcast to resolution agents:

```rust
struct ConflictNotification {
    file_path: PathBuf,
    conflict_id: LineId,
    base_content: String,

    // Context from each side
    versions: Vec<ConflictVersion>,
}

struct ConflictVersion {
    agent_id: AgentId,
    new_content: String,

    // Why did this agent make this change?
    task_context: String,      // "Implement error handling"
    conversation_id: ThreadId, // Link to agent's conversation
}
```

### Resolution as CRDT Operation

A resolution agent (or human) picks or merges the conflict:

```rust
// Resolution agent decides
let resolution = Operation::ResolveConflict {
    conflict_id: LineId::from("A2"),
    resolution: "  return (x + 1) * 2;  // Combined both intents".to_string(),
    resolver_id: AgentId::from("resolver-agent"),
    resolution_hlc: HLC::now(),
};

// Broadcast to all replicas
broadcast(resolution);
```

This is a **deterministic CRDT operation**. All replicas apply it identically.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Agents                                      │
│                                                                          │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│   │  Agent A    │  │  Agent B    │  │  Agent C    │  │  Resolver   │   │
│   │  (coding)   │  │  (coding)   │  │  (coding)   │  │  Agent      │   │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│          │                │                │                │           │
│          │ diff           │ diff           │ diff           │ resolve   │
│          ▼                ▼                ▼                ▼           │
└──────────┼────────────────┼────────────────┼────────────────┼───────────┘
           │                │                │                │
           └────────────────┴────────────────┴────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CRDT Sync Layer                                  │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    Operation Log (append-only)                   │   │
│   │                                                                  │   │
│   │  [Insert, Delete, Replace, Replace, ResolveConflict, ...]       │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│                    ┌───────────────┴───────────────┐                    │
│                    ▼                               ▼                    │
│   ┌─────────────────────────────┐  ┌─────────────────────────────┐     │
│   │     Local Replica           │  │    Remote Replicas          │     │
│   │                             │  │                              │     │
│   │  LineCRDT {                 │  │  (same state, eventually)   │     │
│   │    lines: {...},            │◄─┼──────────────────────────────│     │
│   │    conflicts: {...},        │──┼─────────────────────────────►│     │
│   │  }                          │  │       WebSocket sync         │     │
│   └──────────────┬──────────────┘  └─────────────────────────────┘     │
│                  │                                                      │
└──────────────────┼──────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         File System                                      │
│                                                                          │
│   project/                                                               │
│     src/                                                                 │
│       app.js          ← Rendered from CRDT (clean, human-readable)      │
│       utils.py                                                           │
│     .crdt/                                                               │
│       state.db        ← CRDT state (lines, tombstones, conflicts)       │
│       oplog/          ← Operation log for sync                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Conflict Resolution Agent Flow

```
┌───────────────────────────────────────────────────────────────┐
│                    Conflict Detected                           │
│                                                                │
│  File: src/utils.js:42                                         │
│  Base: "  return calculate(x);"                                │
│                                                                │
│  Agent A (task: "add caching"):                                │
│    "  return cache.get(x) ?? calculate(x);"                   │
│                                                                │
│  Agent B (task: "add logging"):                                │
│    "  console.log('calc', x); return calculate(x);"           │
│                                                                │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                   Resolution Agent                             │
│                                                                │
│  "Both changes are compatible. Agent A added caching,          │
│   Agent B added logging. I can merge these:"                   │
│                                                                │
│  Resolution:                                                   │
│    "  console.log('calc', x); return cache.get(x) ?? calculate(x);"
│                                                                │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│              Broadcast ResolveConflict Operation               │
│                                                                │
│  All replicas apply deterministically                          │
│  Conflict cleared, merged line in place                        │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Line CRDT

1. Implement `LineCRDT` data structure
2. Implement `Insert`, `Delete`, `Replace` operations
3. Deterministic ordering algorithm
4. Basic file read/write (render CRDT to file, parse file to bootstrap CRDT)

### Phase 2: Diff Integration

1. Parse unified diff format
2. Convert diffs to CRDT operations
3. Integrate with existing agent output (Claude Code diffs)
4. Sidecar storage (`.crdt/` directory)

### Phase 3: Sync Layer

1. Operation log persistence
2. WebSocket sync protocol
3. Multi-agent coordination
4. Offline support and reconnection

### Phase 4: Conflict Resolution

1. Conflict detection (same-line edits)
2. Multi-value register for conflict storage
3. Conflict broadcast protocol
4. Resolution agent integration
5. `ResolveConflict` operation

### Phase 5: Production Hardening

1. Tombstone garbage collection
2. Large file handling (lazy loading)
3. Binary file support (LWW fallback)
4. Performance optimization

---

## Open Questions

1. **Anchor stability**: What happens when the anchor line itself is deleted by another agent? Need orphan handling.

2. **Semantic conflicts**: Two agents edit different lines but create incompatible code (e.g., function signature change + call site). Beyond line-level CRDT scope?

3. **Resolution authority**: Who is allowed to resolve conflicts? Any agent? Designated resolver? Human only?

4. **Undo semantics**: How does undo work in a multi-agent CRDT? Is it per-agent or global?

5. **Git integration**: Should CRDT operations map to Git commits? Or keep them separate?

---

## References

- [CRDT Primer](https://crdt.tech)
- [Yjs Architecture](https://docs.yjs.dev)
- [Fugue: Minimizing Interleaving](https://mattweidner.com/2022/10/21/basic-list-crdt.html)
- [Hybrid Logical Clocks](https://jaredforsyth.com/posts/hybrid-logical-clocks/)
- [Automerge Sync Protocol](https://automerge.org/docs/how-it-works/sync/)
