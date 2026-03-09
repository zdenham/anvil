# PR Merge Button

Add a "Merge" button to the PR view that merges the pull request via `gh pr merge`.

## Context

The PR view (`src/components/content-pane/pull-request-content.tsx`) currently shows info, description, checks, comments, and an auto-address toggle. There is no way to merge the PR from within Mort — users must open GitHub in the browser.

The `gh` CLI is already allowed in the Tauri shell scope and all PR operations use `GhCli` + `execGh` from `src/lib/gh-cli/`.

## Phases

- [x] Add `getRepoMergeSettings` and `mergePr` to gh-cli layer

- [x] Add `fetchMergeSettings` and `mergePr` to `pullRequestService` + store

- [x] Create `PrMergeSection` UI component

- [x] Wire merge section into `PullRequestContent`

- [x] Add tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add `getRepoMergeSettings` and `mergePr` to gh-cli layer

### Fetch allowed merge methods

**File:** `src/lib/gh-cli/pr-queries.ts`

Query the repo's allowed merge methods via `gh api`:

```typescript
export type MergeMethod = "merge" | "squash" | "rebase";

export interface RepoMergeSettings {
  /** Which merge methods the repo allows */
  allowedMethods: MergeMethod[];
  /** The repo's default merge method (based on GitHub's priority: squash > merge > rebase) */
  defaultMethod: MergeMethod;
}

export async function getRepoMergeSettings(
  cwd: string,
  repoSlug: string,
): Promise<RepoMergeSettings> {
  const raw = await execGhJson<{
    allow_merge_commit: boolean;
    allow_squash_merge: boolean;
    allow_rebase_merge: boolean;
  }>(
    ["api", `repos/${repoSlug}`, "--jq", "{allow_merge_commit, allow_squash_merge, allow_rebase_merge}"],
    cwd,
  );

  const allowed: MergeMethod[] = [];
  if (raw.allow_squash_merge) allowed.push("squash");
  if (raw.allow_merge_commit) allowed.push("merge");
  if (raw.allow_rebase_merge) allowed.push("rebase");

  // Default: first allowed method (squash preferred, matching GitHub's UI default)
  const defaultMethod = allowed[0] ?? "squash";

  return { allowedMethods: allowed, defaultMethod };
}
```

This uses the existing `execGhJson` helper. The GitHub REST API returns `allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge` booleans on the repo object.

### Merge function

```typescript
export async function mergePr(
  cwd: string,
  prNumber: number,
  method: MergeMethod,
): Promise<void> {
  const methodFlag = `--${method}`;
  await execGh(
    ["pr", "merge", String(prNumber), methodFlag, "--delete-branch"],
    cwd,
  );
}
```

The `--delete-branch` flag cleans up the head branch after merge (standard GitHub behavior). The method flag maps directly to `gh pr merge` flags: `--merge`, `--squash`, `--rebase`.

### GhCli class methods

**File:** `src/lib/gh-cli/client.ts`

Add corresponding methods on `GhCli`:

```typescript
async getRepoMergeSettings(repoSlug: string): Promise<RepoMergeSettings> {
  return getRepoMergeSettings(this.cwd, repoSlug);
}

async mergePr(
  prNumber: number,
  method: MergeMethod,
): Promise<void> {
  return mergePr(this.cwd, prNumber, method);
}
```

Update imports to include `mergePr`, `getRepoMergeSettings`, `MergeMethod`, `RepoMergeSettings`.

## Phase 2: Add `fetchMergeSettings` and `mergePr` to service + store

### Store additions

**File:** `src/entities/pull-requests/store.ts`

Add to state:

```typescript
/** Cached repo merge settings, keyed by repoSlug */
repoMergeSettings: Record<string, RepoMergeSettings>;
```

Add action:

```typescript
setRepoMergeSettings(repoSlug: string, settings: RepoMergeSettings): void;
```

### Service additions

**File:** `src/entities/pull-requests/service.ts` (or `pr-details.ts` if service is near the line limit)

`fetchMergeSettings` — fetches allowed merge methods for a PR's repo and caches in store:

```typescript
async fetchMergeSettings(id: string): Promise<RepoMergeSettings | null> {
  const pr = this.get(id);
  if (!pr) return null;

  // Check cache first
  const cached = usePullRequestStore.getState().repoMergeSettings[pr.repoSlug];
  if (cached) return cached;

  const worktreePath = useRepoWorktreeLookupStore
    .getState()
    .getWorktreePath(pr.repoId, pr.worktreeId);
  if (!worktreePath) return null;

  const ghCli = new GhCli(worktreePath);
  const settings = await ghCli.getRepoMergeSettings(pr.repoSlug);
  usePullRequestStore.getState().setRepoMergeSettings(pr.repoSlug, settings);
  return settings;
},
```

`merge` — executes the merge:

```typescript
async merge(
  id: string,
  method: MergeMethod,
): Promise<void> {
  const pr = this.get(id);
  if (!pr) throw new Error(`PR not found: ${id}`);

  const worktreePath = useRepoWorktreeLookupStore
    .getState()
    .getWorktreePath(pr.repoId, pr.worktreeId);
  if (!worktreePath) throw new Error(`No worktree path for PR ${id}`);

  const ghCli = new GhCli(worktreePath);
  await ghCli.mergePr(pr.prNumber, method);

  // Refresh details so UI updates to "Merged" state
  await this.fetchDetails(id);
},
```

## Phase 3: Create `PrMergeSection` component

**File:** `src/components/content-pane/pr-merge-section.tsx` (new, \~80 lines)

A section that appears between the checks section and the comments section. It shows a merge button with a method dropdown.

### Behavior

- **Only visible** when `details.state === "OPEN"` and `!details.isDraft`
- On mount, calls `pullRequestService.fetchMergeSettings(prId)` to load allowed methods
- **Only shows methods the repo allows** — dropdown is filtered to `allowedMethods`
- Default selection is `defaultMethod` from the repo settings (squash-preferred order)
- If only one method is allowed, hide the dropdown entirely — just show the button
- Loading state while merge is in progress
- Error display if merge fails (e.g., branch protection, merge conflicts)
- After successful merge, the section disappears (PR state flips to MERGED, component hides)

### Props

```typescript
interface PrMergeSectionProps {
  prId: string;
  repoSlug: string;
  state: PullRequestDetails["state"];
  isDraft: boolean;
}
```

### Implementation sketch

```tsx
const METHOD_LABELS: Record<MergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

export function PrMergeSection({ prId, repoSlug, state, isDraft }: PrMergeSectionProps) {
  const mergeSettings = usePullRequestStore(
    useCallback((s) => s.repoMergeSettings[repoSlug], [repoSlug]),
  );
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Don't render for non-open or draft PRs
  if (state !== "OPEN" || isDraft) return null;

  // Fetch allowed methods on mount
  useEffect(() => {
    pullRequestService.fetchMergeSettings(prId);
  }, [prId]);

  // Set default method once settings load
  useEffect(() => {
    if (mergeSettings && !method) {
      setMethod(mergeSettings.defaultMethod);
    }
  }, [mergeSettings, method]);

  const selectedMethod = method ?? mergeSettings?.defaultMethod ?? "squash";
  const allowedMethods = mergeSettings?.allowedMethods ?? [];

  const handleMerge = async () => { /* ... same as before ... */ };

  return (
    <div className="bg-surface-800/30 rounded-lg border border-dashed border-surface-700 px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Only show dropdown if multiple methods allowed */}
        {allowedMethods.length > 1 && (
          <select value={selectedMethod} onChange={...} className="...">
            {allowedMethods.map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </select>
        )}
        {allowedMethods.length === 1 && (
          <span className="text-sm text-surface-300">{METHOD_LABELS[allowedMethods[0]]}</span>
        )}

        <button onClick={handleMerge} disabled={isMerging || !mergeSettings} className="...">
          {isMerging ? "Merging..." : "Merge"}
        </button>
      </div>
      {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
    </div>
  );
}
```

Style to match existing sections (same `bg-surface-800/30 rounded-lg border border-dashed border-surface-700` pattern). Use a green-tinted button to match GitHub's merge button affordance. Button is disabled until merge settings have loaded.

## Phase 4: Wire into `PullRequestContent`

**File:** `src/components/content-pane/pull-request-content.tsx`

Add `PrMergeSection` between `PrChecksSection` and `PrCommentsSection`:

```tsx
<PrChecksSection checks={details.checks} />
<PrMergeSection
  prId={pr.id}
  repoSlug={pr.repoSlug}
  state={details.state}
  isDraft={details.isDraft}
/>
<PrCommentsSection comments={details.reviewComments} />
```

## Phase 5: Tests

1. **Unit test for** `mergePr` **gh-cli function** — mock `execGh`, verify correct args for each method
2. **Unit test for** `PrMergeSection` — renders only for open non-draft PRs, hides for merged/closed/draft, shows error on failure
3. **Service test** — mock `GhCli.mergePr`, verify it calls with correct args and refreshes details after

## Notes

- **Respects repo settings** — only merge methods the repo allows are shown. The `gh api repos/{owner}/{repo}` endpoint provides `allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge` booleans. Merge settings are cached per `repoSlug` in the store (fetched once, reused across PRs in the same repo).
- No `--admin` flag — respects branch protection rules. If the repo requires reviews or passing checks, the merge will fail with a descriptive error from `gh`, which we display.
- `--delete-branch` is safe — it only deletes the remote head branch, not local branches. This is the default GitHub behavior when merging via the web UI.