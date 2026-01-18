# Collaborative File System Research: CRDTs for Real-Time Code Editing

## Executive Summary

This document explores architectural approaches for building a collaborative file system where multiple developers can edit files simultaneously using CRDTs (Conflict-free Replicated Data Types). The key challenge is maintaining compatibility with existing file types while enabling real-time synchronization.

---

## 1. How Existing Solutions Handle This

### VS Code Live Share
- **Architecture**: File system level synchronization (not screen sharing)
- **Model**: Centralized client-server through Microsoft's relay servers
- **Performance**: ~50KB/s per collaborator, 200-400ms global latency
- **Key insight**: Operates at file system level, not editor level

### Zed Editor
- **Architecture**: True CRDT implementation built from the ground up in Rust
- **Model**: Each buffer maintains ReplicaId, version vectors, causally ordered operations
- **Key insight**: "Engineered from ground up to be collaborative - not a bolt-on"

### Figma
- **Architecture**: "CRDT-inspired" but explicitly not a true CRDT
- **Model**: Central server for ordering (Last-Writer-Wins Register pattern)
- **Key insight**: Found OT too complex; property-level sync (not character-level) works better for design tools

### Replit
- **Architecture**: Operational Transformation (OT) with server-as-authority
- **Model**: File watching daemon on server generates OT messages, broadcasts to clients
- **Key insight**: Chose OT because their centralized infrastructure already existed

---

## 2. CRDT Libraries for Text

| Library | Language | Algorithm | Strengths | Weekly Downloads |
|---------|----------|-----------|-----------|------------------|
| **Yjs** | JavaScript | YATA | Fastest, huge ecosystem, extensive editor integrations | 900k+ |
| **Automerge** | Rust (WASM) | RGA | JSON-native, multi-language bindings | Popular |
| **Diamond Types** | Rust | Custom | 5000x faster than competitors (cutting edge) | Experimental |
| **Loro** | Rust (JS) | Fugue/REG | Rich text, movable trees, solves interleaving | Newer |

### Recommendation
- **Yjs** for most use cases (ecosystem, performance, documentation)
- **Loro** if rich text formatting or tree structures are critical
- **Diamond Types** for maximum performance (but less mature)

---

## 3. Architecture Options

### Option A: In-Memory Layer on Top of File System

```
┌─────────────────┐
│   Application   │
└────────┬────────┘
         ▼
┌─────────────────┐
│  CRDT Layer     │  ← Intercepts reads/writes
│  (in-memory)    │
└────────┬────────┘
         ▼
┌─────────────────┐
│  File System    │  ← Actual files on disk
└─────────────────┘
```

**Pros**:
- Transparent to existing tools (compilers, linters work unchanged)
- Can batch writes for performance
- Supports offline editing with later sync

**Cons**:
- Complex state management between memory and disk
- Risk of data loss on crash
- Must handle large files that don't fit in memory

**Implementation approach**:
1. Each client maintains own CRDT state file
2. Watch for changes from other clients
3. Merge CRDT states when external changes detected
4. Regenerate actual files from merged state

### Option B: FUSE-Based Virtual File System

```
┌─────────────────┐
│   Application   │
└────────┬────────┘
         ▼
┌─────────────────┐
│  FUSE Interface │  ← User-space file system
└────────┬────────┘
         ▼
┌─────────────────┐
│  CRDT Layer     │ ←→ Network Sync
└────────┬────────┘
         ▼
┌─────────────────┐
│  Local Storage  │
└─────────────────┘
```

**Pros**:
- Completely transparent to all applications
- Works with any tool/editor
- Mature ecosystem (SSHFS, mergerfs as examples)
- Available on Linux, macOS, FreeBSD, Windows

**Cons**:
- Performance overhead from user-space operations
- Platform-specific implementations needed
- Complex error handling for network issues

### Option C: Editor Plugin Approach

**LSP-Level**: Current LSP spec doesn't support multi-client editing (one server serves one tool). Would require protocol extensions.

**Editor-Specific**:
- VS Code: Extension API
- Atom: Teletype-CRDT
- Zed: Native support

**Pros**:
- Rich integration with editor features (cursors, selections, presence)
- Can leverage IntelliSense/completion

**Cons**:
- Requires separate implementation per editor
- External tools (compilers) see files differently than editor
- Limited to supported editors

### Option D: Git-Based with Operational Transforms

**Pros**:
- Familiar workflow for developers
- Built-in version control
- Works with existing Git tooling

**Cons**:
- Not truly real-time (batch-oriented)
- Manual conflict resolution for structural conflicts
- OT is notoriously complex ("subject of whole subdiscipline of CS research")

---

## 4. The Layer Question: Where Should This Live?

### Analysis

The question of "on top of" vs "lower level" is really about **transparency vs integration**:

| Approach | Transparency to Tools | Editor Integration | Complexity | Performance |
|----------|----------------------|-------------------|------------|-------------|
| FUSE (lowest) | Perfect | None | High | Lower |
| In-Memory Layer | Good | Limited | Medium | Good |
| Editor Plugin | None | Perfect | Lower | Best |

### The Hybrid Approach (Recommended)

Based on the research, the most practical architecture for code editing is a **hybrid approach**:

```
┌─────────────────────────────────────────────────┐
│                  Editor Plugin                   │
│         (handles UI, cursors, presence)          │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│              Shared CRDT Core                    │
│  (library like Yjs, runs in editor AND daemon)   │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│           Background Sync Daemon                 │
│  - Watches for external file changes             │
│  - Flushes CRDT state before tool invocation     │
│  - Syncs with other developers                   │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│              File System                         │
│  project/                                        │
│    src/app.js          ← Human-readable file     │
│    .crdt/                                        │
│      src/app.js.crdt   ← CRDT state (binary)     │
└─────────────────────────────────────────────────┘
```

**Why this works**:
1. **Editors** get real-time collaboration through plugins
2. **External tools** see regular files (flush before compile/lint)
3. **CRDT state** is persisted separately, not polluting source files
4. **Multiple implementations** can share the core CRDT library

---

## 5. File Format Compatibility

### The Core Problem

CRDT libraries maintain internal state (operation history, version vectors, tombstones) that doesn't belong in source files. How do we keep `app.js` looking like a normal JavaScript file?

### Solution: Sidecar Storage

```
project/
  src/
    app.js              # Human-readable, valid JavaScript
    utils.py            # Human-readable, valid Python
  .crdt/
    src/
      app.js.crdt       # Binary CRDT state
      utils.py.crdt     # Binary CRDT state
  .crdt-meta.json       # Index, version info
```

**Benefits**:
- Source files remain pristine
- `.crdt/` can be gitignored or version controlled separately
- Non-technical users can still read/export files manually
- Easy to "eject" by deleting `.crdt/`

### Handling Different File Types

| File Type | CRDT Approach | Rationale |
|-----------|---------------|-----------|
| Text (`.js`, `.py`, `.rs`) | Character-level sequence CRDT | Fine-grained merging |
| Config (`.json`, `.yaml`) | Structural CRDT (OR-Map) | Preserve structure |
| Binary (`.png`, `.wasm`) | Last-Writer-Wins (LWW) | No meaningful merge |
| Large files (>1MB) | Chunked + lazy load | Memory efficiency |

---

## 6. Key Technical Challenges

### Conflict Resolution

**Automatic (CRDT handles)**:
- Concurrent inserts at same position → ordered by replica ID
- Interleaving prevention → Fugue/FugueMax algorithms
- Property updates → last-writer-wins

**Requires User Input**:
- Structural conflicts (rename vs edit same file)
- Semantic conflicts (incompatible function signatures)
- Tree conflicts (move file vs delete parent directory)

### Tombstone Garbage Collection

Deleted items are kept as "tombstones" for sync, causing unbounded growth.

**Best approaches**:
1. **Version vector based**: Safe to GC when all replicas past tombstone version
2. **Time-based**: 24-hour delay before GC (assumes sync completes)
3. **Delta-CRDTs**: O(N+D) space instead of O(N^2)

### File Operations Beyond Text

| Operation | Challenge | Solution |
|-----------|-----------|----------|
| Create | Concurrent creation of same path | LWW with replica ID tiebreaker |
| Delete | Edit vs delete race | "Adding wins" policy |
| Rename | Concurrent renames | Tree CRDT with move operation |
| Move | Move into deleted directory | Orphan handling, intent preservation |

### Integration with External Tools

**Compilers/Linters**:
- Need to see consistent file state
- Solution: Flush CRDT state to disk before invocation

**File Watchers**:
- May conflict with CRDT layer
- Solution: Coordination protocol (pause watching during sync)

**Version Control**:
- Git sees final file state, not operations
- Solution: CRDT history separate from Git history

---

## 7. Network Synchronization

### Protocol Options

**WebSocket (Recommended for reliability)**:
- y-websocket: Central endpoint distributes updates
- Automerge-repo: CBOR-encoded messages, multi-hop sync
- Scaling: PubSub between servers or consistent hashing

**WebRTC (For low-latency P2P)**:
- y-webrtc: Signaling server for discovery only
- Document data exchanged directly
- Limit: Best for <100 users per document

### State vs Operation Sync

| Approach | Bandwidth | Complexity | Use Case |
|----------|-----------|------------|----------|
| State-based | Higher | Lower | Initial sync, recovery |
| Operation-based | Lower | Higher | Incremental updates |
| Delta-CRDTs | Optimal | Medium | Best of both worlds |

---

## 8. Recommended Implementation Path

### Phase 1: Proof of Concept
1. Choose Yjs as CRDT library (best ecosystem, performance)
2. Build VS Code extension for single-file collaboration
3. Use y-websocket for sync
4. Store CRDT state in `.crdt/` directory

### Phase 2: Multi-File Support
1. Add directory watching
2. Implement file create/delete/rename as CRDT operations
3. Handle binary files with LWW
4. Build presence system (who's editing what)

### Phase 3: External Tool Integration
1. Implement "flush before compile" hook
2. Coordinate with file watchers
3. Add CLI for non-editor workflows

### Phase 4: Scaling (Optional)
1. Consider FUSE layer for maximum transparency
2. Implement sharding for large codebases
3. Add tombstone GC
4. Evaluate P2P for LAN scenarios

---

## 9. Key Insights from Research

1. **Don't reinvent the wheel**: Use Yjs, Automerge, or Loro rather than building custom CRDTs

2. **Separation of concerns**: Keep CRDT state separate from source files

3. **The "bolt-on" problem**: Zed's success comes from building collaboration into the core, not as an afterthought

4. **OT vs CRDT**: CRDTs are simpler for decentralized sync; OT is fine if you already have centralized infrastructure

5. **Interleaving matters**: Use Fugue-based algorithms to prevent text from getting scrambled during concurrent edits

6. **Binary files are different**: Don't try to merge them character-by-character; use LWW

7. **GC is essential**: Plan for tombstone cleanup from the start

---

## 10. References

- [Yjs Documentation](https://docs.yjs.dev)
- [Automerge](https://automerge.org)
- [Loro CRDT](https://loro.dev)
- [Diamond Types](https://github.com/josephg/diamond-types)
- [Zed's CRDT Blog Post](https://zed.dev/blog/crdts)
- [Peritext: Rich Text CRDTs](https://www.inkandswitch.com/peritext/)
- [Fugue Algorithm](https://mattweidner.com/2022/10/21/basic-list-crdt.html)
- [Xi-Editor CRDT Retrospective](https://raphlinus.github.io/xi/2020/06/27/xi-retrospective.html)
- [FUSE Documentation](https://github.com/libfuse/libfuse)
- [Tonsky: Local, First, Forever](https://tonsky.me/blog/crdt-filesync/)
