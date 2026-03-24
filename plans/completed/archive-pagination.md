# Archive Pagination

## Problem

The archive has **3,387 threads** (~18 MB of metadata.json files). `threadService.listArchived()` globs for all `archive/threads/*/metadata.json`, then reads and parses every single one sequentially in a for loop. This is why the archive doesn't load — it's trying to read 3,387 JSON files from disk via IPC before showing anything.

The UI already virtualizes rendering (only ~15 rows in DOM), but the **data fetching** loads everything upfront.

## Root Cause

`threadService.listArchived()` at `src/entities/threads/service.ts:782-796`:
```ts
async listArchived(): Promise<ThreadMetadata[]> {
  const pattern = `${ARCHIVE_THREADS_DIR}/*/metadata.json`;
  const files = await appData.glob(pattern);       // 3,387 files
  const threads: ThreadMetadata[] = [];
  for (const filePath of files) {                   // Sequential reads
    const raw = await appData.readJson(filePath);   // IPC per file
    const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
    if (result?.success) threads.push(result.data);
  }
  return threads;
}
```

Each `appData.readJson` goes through Tauri IPC (`invoke` → Rust → fs::read → serialize → IPC back). That's 3,387 IPC round-trips.

## Approach: Rust-side Grep

Add a single `fs_grep` Rust command that searches file contents without per-file IPC round-trips. The metadata.json files already contain `"updatedAt": <timestamp>` — we just need a way to extract that from 3,387 files in one IPC call.

### How it works

1. **One IPC call**: `fs_grep(dir, pattern, file_glob)` walks `archive/threads/*/metadata.json` in Rust, matches `"updatedAt"` lines, returns `{path, line}` pairs
2. **Parse results in TS**: extract thread ID from each path, timestamp from each matched line
3. **Sort + paginate**: sort by timestamp descending, slice for current page
4. **Read full metadata only for visible rows**: ~15 `readJson` calls for display labels

### Why this works

- **3,387 IPC calls → 1**: Rust reads all files in-process (~50-100ms for 18 MB), returns results over a single IPC boundary
- **No schema changes** — metadata.json already has everything we need
- **No new files** — no markers, no index, no migration
- **No backfill** — works immediately with existing archive
- **General-purpose** — `fs_grep` is useful beyond this specific feature

### IPC budget

| Step | IPC calls |
|------|-----------|
| `fs_grep` for updatedAt across all archived metadata | 1 |
| `fs_bulk_read` for visible page metadata (~15 files) | 1 |
| **Total** | **2** |

vs. current: **~6,800** (3,400 glob traversal + 3,400 readJson)

## Phases

- [x] Add `fs_grep` and `fs_bulk_read` Rust commands + Tauri/WS wiring + TS client
- [x] Replace `listArchived()` with grep-based paginated version
- [x] Update `ArchiveView` UI for paginated loading
- [x] Wire up unarchive to work with the new list shape

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Rust Commands

Two new commands: `fs_grep` for searching file contents across many files, and `fs_bulk_read` for reading multiple files in one IPC call.

### Rust side (`src-tauri/src/filesystem.rs`)

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    pub path: String,
    pub line: String,
    pub line_number: usize,
}

/// Searches files matching a glob pattern under a directory for lines matching a regex.
/// Returns matching lines with file paths. All I/O happens in Rust — single IPC call.
#[tauri::command]
pub fn fs_grep(dir: String, pattern: String, file_glob: String) -> Result<Vec<GrepMatch>, String> {
    let re = regex::Regex::new(&pattern).map_err(|e| format!("Invalid regex: {}", e))?;
    let base = Path::new(&dir);
    let mut results = Vec::new();

    let entries = fs::read_dir(base).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries.flatten() {
        if !entry.path().is_dir() { continue; }
        let file_path = entry.path().join(&file_glob);
        if !file_path.exists() { continue; }

        if let Ok(contents) = fs::read_to_string(&file_path) {
            for (i, line) in contents.lines().enumerate() {
                if re.is_match(line) {
                    results.push(GrepMatch {
                        path: file_path.to_string_lossy().to_string(),
                        line: line.to_string(),
                        line_number: i + 1,
                    });
                }
            }
        }
    }

    Ok(results)
}

/// Reads multiple files in a single IPC call.
/// Returns contents in the same order as paths. Null for files that don't exist or fail to read.
#[tauri::command]
pub fn fs_bulk_read(paths: Vec<String>) -> Vec<Option<String>> {
    paths
        .iter()
        .map(|p| fs::read_to_string(p).ok())
        .collect()
}
```

Add `regex` crate to `src-tauri/Cargo.toml` if not already present.

### Register in Tauri (`src-tauri/src/lib.rs`)

Add `filesystem::fs_grep` and `filesystem::fs_bulk_read` to the `invoke_handler` list.

### WS dispatch (`src-tauri/src/ws_server/dispatch_fs.rs`)

```rust
"fs_grep" => {
    let dir: String = extract_arg(&args, "dir")?;
    let pattern: String = extract_arg(&args, "pattern")?;
    let file_glob: String = extract_arg(&args, "fileGlob")?;
    let result = crate::filesystem::fs_grep(dir, pattern, file_glob)?;
    Ok(serde_json::to_value(result).unwrap())
}
"fs_bulk_read" => {
    let paths: Vec<String> = serde_json::from_value(
        args.get("paths").cloned().ok_or("Missing 'paths'")?
    ).map_err(|e| format!("Invalid paths: {}", e))?;
    let result = crate::filesystem::fs_bulk_read(paths);
    Ok(serde_json::to_value(result).unwrap())
}
```

### TS client (`src/lib/filesystem-client.ts`)

```ts
export const GrepMatchSchema = z.object({
  path: z.string(),
  line: z.string(),
  lineNumber: z.number(),
});
export type GrepMatch = z.infer<typeof GrepMatchSchema>;

async grep(dir: string, pattern: string, fileGlob: string): Promise<GrepMatch[]> {
  const raw = await invoke<unknown>("fs_grep", { dir, pattern, fileGlob });
  return z.array(GrepMatchSchema).parse(raw);
}

async bulkRead(paths: string[]): Promise<(string | null)[]> {
  return invoke<(string | null)[]>("fs_bulk_read", { paths });
}
```

### AppDataStore (`src/lib/app-data-store.ts`)

```ts
async grep(dir: string, pattern: string, fileGlob: string): Promise<GrepMatch[]> {
  const fullDir = await this.resolvePath(dir);
  return this.fs.grep(fullDir, pattern, fileGlob);
}

async bulkReadJson<T>(paths: string[]): Promise<(T | null)[]> {
  const fullPaths = await Promise.all(paths.map((p) => this.resolvePath(p)));
  const results = await this.fs.bulkRead(fullPaths);
  return results.map((content) => {
    if (!content) return null;
    try { return JSON.parse(content) as T; }
    catch { return null; }
  });
}
```

## Phase 2: Paginated `listArchived`

**File:** `src/entities/threads/service.ts`

Replace the current `listArchived()`:

```ts
interface ArchivedThreadSummary {
  id: string;
  updatedAt: number;
}

async listArchived(opts?: { limit?: number; offset?: number }): Promise<{
  threads: ArchivedThreadSummary[];
  total: number;
}> {
  // Single IPC call — Rust reads all 3,387 metadata.json files
  const matches = await appData.grep(
    ARCHIVE_THREADS_DIR,
    '"updatedAt"\\s*:\\s*(\\d+)',
    "metadata.json"
  );

  // Parse thread ID from path, timestamp from matched line
  const entries: ArchivedThreadSummary[] = [];
  for (const match of matches) {
    const id = extractThreadIdFromPath(match.path);
    const tsMatch = match.line.match(/(\d{10,})/);
    if (id && tsMatch) {
      entries.push({ id, updatedAt: parseInt(tsMatch[1], 10) });
    }
  }

  // Sort by updatedAt descending
  entries.sort((a, b) => b.updatedAt - a.updatedAt);

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  return {
    threads: entries.slice(offset, offset + limit),
    total: entries.length,
  };
}

function extractThreadIdFromPath(absPath: string): string | null {
  // path: /Users/.../.anvil/archive/threads/{id}/metadata.json
  const parts = absPath.split("/");
  const metaIdx = parts.lastIndexOf("metadata.json");
  return metaIdx > 0 ? parts[metaIdx - 1] : null;
}
```

Keep the old `listArchived` signature available for `unarchive()` — it reads a single thread's metadata directly, so it's already fine (1 readJson).

## Phase 3: Update ArchiveView UI

**File:** `src/components/content-pane/archive-view.tsx`

- Change state from `ThreadMetadata[]` to `ArchivedThreadSummary[]`
- Track `labels: Map<string, string>` separately
- Initial load calls `threadService.listArchived({ limit: 50 })`
- For visible rows, bulk-fetch labels via `threadService.getArchivedLabels(visibleThreads)` — **1 IPC call** via `bulkReadJson`:
  ```ts
  async getArchivedLabels(threads: ArchivedThreadSummary[]): Promise<Map<string, string>> {
    const paths = threads.map(({ id }) => `${ARCHIVE_THREADS_DIR}/${id}/metadata.json`);
    const results = await appData.bulkReadJson<unknown>(paths);
    const labels = new Map<string, string>();
    for (let i = 0; i < threads.length; i++) {
      const parsed = results[i] ? ThreadMetadataSchema.safeParse(results[i]) : null;
      if (parsed?.success) {
        const meta = parsed.data;
        labels.set(threads[i].id, meta.name ?? meta.turns[0]?.prompt?.slice(0, 80) ?? threads[i].id.slice(0, 8));
      }
    }
    return labels;
  }
  ```
- Show total count in header (e.g., "3,387 archived threads")
- `ArchivedThreadRow` displays `labels.get(id) ?? id.slice(0, 8)` + relative time from `updatedAt`
- Add "Load more" / infinite scroll to fetch next page + labels
- Unarchive optimistically removes from list, calls `threadService.unarchive(threadId)` (unchanged)

## Phase 4: Wire Up Unarchive

`unarchive()` already reads metadata from `archive/threads/{id}/metadata.json` and deletes the directory. No changes needed — it doesn't depend on the list format. Just verify the `ArchiveView` correctly removes the item from its `ArchivedThreadSummary[]` state on unarchive (already does this optimistically).
