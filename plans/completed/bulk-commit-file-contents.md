# Bulk commit file content fetching

## Problem

Clicking a commit in the side panel is slow because loading file contents spawns **2 git subprocesses per file** (`git show hash~1:path` + `git show hash:path`). A 10-file commit = 20 subprocess spawns, each with \~50-100ms overhead, and they only start **after** the diff is fully fetched and parsed (waterfall).

## Solution

Replace N×2 individual `git show` calls with **2 bulk** `git cat-file --batch` **calls** (one for old contents, one for new contents) per commit. This is a single subprocess that reads all objects in one shot.

### How `git cat-file --batch` works

You pipe object identifiers (one per line) into stdin and get back all contents sequentially:

```
# stdin:
abc123~1:src/foo.ts
abc123~1:src/bar.ts

# stdout (per object):
<sha> blob <size>\n
<content>\n
```

For missing objects (e.g. added files), it outputs `<ref> missing\n` — easy to detect.

## Phases

- [x] Add `git_cat_file_batch` Tauri command in Rust

- [x] Add TS wrapper in `tauri-commands.ts`

- [x] Replace per-file fetching in `changes-diff-fetcher.ts` with bulk fetch

- [x] Cache file contents alongside diff in `commitDiffCache`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Rust — `git_cat_file_batch`

Add a new Tauri command in `git_commands.rs`:

```rust
#[tauri::command]
pub async fn git_cat_file_batch(
    cwd: String,
    refs: Vec<String>,  // e.g. ["abc123~1:src/foo.ts", "abc123:src/bar.ts"]
) -> Result<Vec<Option<String>>, String>
```

Implementation:

- Spawn `git cat-file --batch` with stdin piped
- Write all refs (one per line) to stdin, then close it
- Parse stdout: for each entry, read the `<sha> blob <size>` header or `<ref> missing` line
- Read exactly `<size>` bytes + trailing newline for blob content
- Return `Vec<Option<String>>` — `None` for missing objects, `Some(content)` for found ones
- Skip non-UTF-8 content (binary files) by returning `None`

Register the command in `lib.rs`.

## Phase 2: TS wrapper

In `tauri-commands.ts`, add to `gitCommands`:

```ts
catFileBatch: (cwd: string, refs: string[]) => invoke<(string | null)[]>("git_cat_file_batch", { cwd, refs }),
```

## Phase 3: Replace per-file fetching

In `changes-diff-fetcher.ts`, replace `fetchCommitFileContent` (the per-file approach) with a bulk version:

```ts
async function fetchCommitFileContentsBulk(
  cwd: string,
  files: ParsedDiffFile[],
  commitHash: string,
): Promise<Record<string, FileContentEntry>> {
  // Build two ref lists: old (hash~1:path) and new (hash:path)
  const oldRefs: string[] = [];
  const newRefs: string[] = [];
  const filePaths: string[] = [];

  for (const file of files) {
    const path = file.newPath ?? file.oldPath;
    if (!path) continue;
    filePaths.push(path);
    oldRefs.push(file.type !== "added" ? `${commitHash}~1:${path}` : "");
    newRefs.push(file.type !== "deleted" ? `${commitHash}:${path}` : "");
  }

  // Filter out empty refs, batch the rest
  const allRefs = [...oldRefs.filter(Boolean), ...newRefs.filter(Boolean)];
  const results = await gitCommands.catFileBatch(cwd, allRefs);

  // Map results back to FileContentEntry records
  // (reconstruct which result belongs to which file)
  ...
}
```

Update `fetchFileContents` to call this bulk version when `commitHash` is set.

Also apply the same pattern for `fetchUncommittedFileContent` and `fetchRangeFileContent` — those call `git show` per-file too, though they matter less since range mode has stale-while-revalidate caching.

## Phase 4: Cache file contents for commits

Currently `commitDiffCache` only stores `{ raw, parsed }`. Extend it:

```ts
const commitDiffCache = new Map<string, {
  raw: string;
  parsed: ParsedDiff;
  fileContents?: Record<string, FileContentEntry>;  // add this
}>();
```

After bulk-fetching file contents for a commit, store them in the cache. On cache hit, return both diff + file contents — skipping the second `useEffect` entirely for repeat views.

In `use-changes-data.ts`, check for cached file contents alongside the diff:

```ts
// In the commit path of fetchRawDiff (or a new combined function):
const cached = commitDiffCache.get(commitHash);
if (cached?.fileContents) {
  // Return everything at once — no waterfall
}
```

## Expected improvement

| Metric | Before | After |
| --- | --- | --- |
| Subprocess spawns (10-file commit) | 21 (1 diff + 20 show) | 3 (1 diff + 2 batch) |
| Subprocess spawns (repeat view) | 20 (diff cached, contents not) | 0 (all cached) |
| Waterfall stages | 2 (diff → contents) | 1 (or 0 on cache hit) |
| Estimated latency (first view) | 800-4500ms | 300-800ms |
| Estimated latency (repeat view) | 500-4000ms | \~0ms |
