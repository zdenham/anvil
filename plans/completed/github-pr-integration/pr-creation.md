# C: PR Creation Flow

Handles two paths for creating PR entities: (1) agent-driven creation via the plus menu with a configurable skill, and (2) automatic detection via `pull_request.opened` webhook events through the gateway channel infrastructure.

All GitHub data is fetched via the `gh` CLI, leveraging the user's existing GitHub credentials. No OAuth, no tokens to manage. Shell commands run in the worktree context so `{owner}/{repo}` resolves automatically from git remote configuration.

## Phases

- [x] Create the `create-pr` skill
- [x] Implement the "Create pull request" action flow
- [x] Wire up PR entity creation from both paths (webhook detection + action flow)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Create-PR Skill

### File: `plugins/anvil/skills/create-pr/SKILL.md`

A bundled skill shipped with Anvil, living in `plugins/anvil/skills/` alongside `commit` and `simplify-code`. On startup, `syncManagedSkills()` (in `src/lib/skill-sync.ts`) copies the entire `plugins/anvil/skills/` directory to `~/.anvil/skills/`, making the skill available at runtime. No changes to the sync mechanism are required -- the existing `syncManagedSkills()` already iterates all subdirectories in `plugins/anvil/skills/` and copies them.

The skill is granted `bash,read,grep,glob` tools. The agent needs `read`, `grep`, and `glob` to examine the codebase and write good PR descriptions (commit history, changed files, code context), and `bash` to run git and `gh` CLI commands. It intentionally does NOT have `edit` or `write` tools since the create-pr agent should not modify code.

```markdown
---
name: Create Pull Request
description: Creates a GitHub pull request for the current branch
user-invocable: true
allowed-tools: bash,read,grep,glob
---

Create a pull request for the current branch using the GitHub CLI.

## Instructions

1. Check the current branch and recent commits to understand what this PR is about:
   - Run `git log --oneline main..HEAD` (or appropriate base branch) to see commits
   - Run `git diff --stat main..HEAD` to see changed files

2. Draft a PR title and description:
   - Title: concise summary under 70 characters
   - Description: summarize the changes, motivation, and any notable decisions
   - Use conventional commit style for the title if the repo follows that convention

3. Create the PR:
   ```bash
   gh pr create --title "the title" --body "$(cat <<'EOF'
   ## Summary
   <description>

   ## Changes
   <bullet list of key changes>
   EOF
   )"
   ```

4. If `gh pr create` fails because the branch hasn't been pushed, push it first:
   ```bash
   git push -u origin HEAD
   ```
   Then retry the PR creation.

5. Report the PR URL when done.
```

### Skill Precedence & Configurability

When the agent SDK resolves the `/create-pr` slash command, skill lookup follows standard precedence:

1. **Project skills**: `<repo>/.claude/skills/create-pr/` -- highest priority, repo-specific overrides
2. **Personal skills**: `~/.claude/skills/create-pr/` -- user-level customization
3. **Anvil skills**: `~/.anvil/skills/create-pr/` -- the bundled default (synced from `plugins/anvil/skills/`)

Users can customize PR creation by placing their own `create-pr/SKILL.md` in their project's `.claude/skills/` directory. This lets teams enforce their own PR conventions (required sections, template formats, label assignment, reviewer assignment) without modifying Anvil's bundled skill.

---

## Phase 2: "Create Pull Request" Action Flow

When the user clicks "Create pull request" in the plus dropdown menu (added in [pr-ui.md](./pr-ui.md) Phase 4), the following flow executes. The button label always says "Create pull request" regardless of state -- if a PR already exists for the current branch, clicking it opens the existing PR instead.

### Flow Diagram

```
User clicks "Create pull request"
        |
        v
  Check gh CLI availability
        |
        +-- Not available ---------> Show error banner:
        |                            "GitHub CLI not found"
        |                            with "Install GitHub CLI" button
        |                            (runs `brew install gh`)
        |
        +-- Not authenticated -----> Show error banner:
        |                            "Not authenticated"
        |                            with "Authenticate" button
        |                            (opens `gh auth login` in terminal)
        |
        v
  gh pr view --json number (check existing PR)
        |
        +-- PR exists ----------------+
        |                             |
        v                             v
  No existing PR               Create/fetch PR entity
        |                       Open PR content pane
        |                            DONE
        v
  Create new thread
  with create-pr skill
        |
        v
  Open thread content pane
  (user watches the agent work)
        |
        v
  Agent runs, creates PR
  via gh pr create
        |
        v
  Gateway receives pull_request.opened
  webhook event (see Phase 3)
        |
        v
  PR entity created automatically
  PR item appears in side panel
  (blue GitPullRequest icon, does NOT
   force-open content pane)
       DONE
```

### Implementation: `src/lib/pr-actions.ts`

This file should remain under 250 lines per codebase guidelines. It contains the single action handler for "Create pull request". Business logic lives here (in the Node-adjacent Tauri frontend layer) rather than in a React component, consistent with the pattern of keeping logic outside React constructs.

```typescript
import { GhCli } from "./gh-cli";
import { pullRequestService } from "@/entities/pull-requests";
import { createThread } from "@/lib/thread-creation-service";
import { contentPanesService } from "@/stores/content-panes";
import { logger } from "./logger-client";

export async function handleCreatePr(
  repoId: string,
  worktreeId: string,
  worktreePath: string,
): Promise<void> {
  // GhCli accepts any path within the repo — for PR queries, any worktree
  // path works since all worktrees share the same remote.
  const ghCli = new GhCli(worktreePath);

  // 1. Check if gh is available and authenticated.
  //    If gh is missing, show an "Install GitHub CLI" banner with a button
  //    that runs `brew install gh`. If not authenticated, show an
  //    "Authenticate" banner that opens `gh auth login` in a terminal.
  if (!await ghCli.isAvailable()) {
    // Show error toast or banner — implementation depends on pr-ui.md
    // error banner pattern (see pr-entity.md Phase 2 error handling)
    return;
  }

  // 2. Check if a PR already exists for the current branch.
  //    Uses `gh pr view --json number --jq '.number'`.
  const existingPrNumber = await ghCli.getCurrentBranchPr();

  if (existingPrNumber) {
    // PR exists — create entity if needed and open it.
    // Entity key is {repoId}:{prNumber}, deduplicated by getByRepoAndNumber.
    let pr = pullRequestService.getByRepoAndNumber(repoId, existingPrNumber);
    if (!pr) {
      const repoSlug = await ghCli.getRepoSlug();
      const branchInfo = await getBranchInfo(worktreePath);
      pr = await pullRequestService.create({
        prNumber: existingPrNumber,
        repoId,
        worktreeId,
        repoSlug,
        headBranch: branchInfo.head,
        baseBranch: branchInfo.base,
      });
    }
    // Open PR content pane — fetches fresh PullRequestDetails on mount
    contentPanesService.setActivePaneView({ type: "pull-request", prId: pr.id });
    return;
  }

  // 3. No PR exists — spawn an agent with the create-pr skill.
  //    Gateway channel already exists for this repo (channels are created
  //    for all repos by default during entity hydration on app mount, via
  //    ensureGatewayChannelForRepo). The webhook will detect the PR once
  //    the agent runs `gh pr create`.

  const { threadId } = await createThread({
    prompt: "/create-pr",
    repoId,
    worktreeId,
    worktreePath,
    permissionMode: "approve",
  });

  // Open thread content pane so the user can watch the agent work.
  // createThread() handles optimistic UI, so the thread already appears.
  contentPanesService.setActivePaneView({ type: "thread", threadId });

  // PR detection happens asynchronously via gateway webhook:
  // 1. Agent runs `gh pr create` which creates the PR on GitHub
  // 2. GitHub fires a `pull_request.opened` webhook event
  // 3. The repo's gateway channel receives the event via SSE
  // 4. The PR entity listener (pull-requests/listeners.ts) creates
  //    the PR entity and emits PR_CREATED
  // 5. The side panel reacts to the new entity — PR item appears
  //    with a blue GitPullRequest icon (unseen indicator)
  // 6. The content pane is NOT force-opened (avoids interrupting
  //    the user who is watching the agent thread)
}
```

### `getBranchInfo` Helper

```typescript
async function getBranchInfo(worktreePath: string): Promise<{
  head: string;
  base: string;
}> {
  // Get head branch from git
  const headResult = await Command.create("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: worktreePath }).execute();
  const head = headResult.stdout.trim();

  // Detect base branch: check remote HEAD, fallback to "main"
  try {
    const baseResult = await Command.create("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd: worktreePath }).execute();
    const base = baseResult.stdout.trim().replace("origin/", "");
    return { head, base };
  } catch {
    return { head, base: "main" };
  }
}
```

### Gateway Channel Pre-Existence

Gateway channels are created for **all repos by default** when a repo is added to Anvil or on every app mount (idempotently). The `ensureGatewayChannelForRepo` function runs during entity hydration for every repo, ensuring channels survive app restarts, failed creates, and reinstalls. This means:

- The webhook is already installed when "Create pull request" is clicked
- PRs created via the agent **and** PRs created manually in any terminal are both detected
- The channel handles `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment`, `check_run`, and `check_suite` events
- The auto-address toggle (in the PR content pane) controls only whether agents are *spawned* in response to events -- event *reception* is always active

Because channels are per-repo (not per-PR), one webhook serves all PR lifecycle events for the repo. GitHub does not support per-PR webhooks, so all events are filtered server-side by PR number at the listener level.

```typescript
// Called idempotently on every app mount for each repo
// (in src/entities/index.ts hydration flow)
async function ensureGatewayChannelForRepo(
  repoId: string,
  worktreePath: string,
): Promise<string> {
  // Check if channel already exists for this repo
  let channel = gatewayChannelService.getByRepoId(repoId);
  if (channel) {
    if (!channel.active) {
      await gatewayChannelService.activate(channel.id);
    }
    return channel.id;
  }

  // Create a new channel — this registers with the gateway server
  // and creates the GitHub repo webhook via gh CLI.
  // GhCli is instantiated with the repo root path (not a worktree path)
  // because GitHub has no concept of local worktrees. For webhook CRUD
  // and repo-level API calls, the repo root is always used.
  const ghCli = new GhCli(worktreePath);
  const repoSlug = await ghCli.getRepoSlug();
  const deviceId = getDeviceId();

  channel = await gatewayChannelService.create({
    deviceId,
    type: "github",
    label: repoSlug,
    repoId,
  });

  await gatewayChannelService.activate(channel.id);
  return channel.id;
}
```

If `gh` CLI is missing or unauthenticated during `ensureGatewayChannelForRepo`, channel creation is skipped for that repo. It retries on next app launch or when the user manually retries from Settings.

---

## Phase 3: Wiring PR Entity Creation

PR entities are created from two sources, both funneling through the same listener infrastructure. The PR entity stores minimal metadata (PR number, repo, worktree binding) -- all display data is fetched on-demand via `gh pr view --json` and `gh pr checks --json`. The entity key is `{repoId}:{prNumber}`, and `pullRequestService.getByRepoAndNumber()` prevents duplicates.

### From Gateway Webhook Events

When a `pull_request.opened` event arrives via the gateway SSE stream, the PR entity listener in `pull-requests/listeners.ts` handles it. Events are treated as signals, not data: the listener uses the webhook payload only to identify the PR number and branch, then fetches current details via `gh` CLI queries.

This listener also handles `pull_request.closed` events. When a PR is closed or merged, auto-address is automatically disabled (`autoAddressEnabled` set to `false`, `gatewayChannelId` set to `null`). The PR remains visible in the side panel until the user explicitly archives it (or its parent worktree is archived). Archiving does NOT stop running auto-address threads -- in-progress agents continue to completion.

```typescript
// In pull-requests/listeners.ts — alongside the auto-address event handling

eventBus.on(EventName.GITHUB_WEBHOOK_EVENT, async ({ channelId, githubEventType, payload }) => {
  // ── PR Creation Detection ──────────────────────────────────────
  if (githubEventType === "pull_request" && payload.action === "opened") {
    const channel = gatewayChannelService.get(channelId);
    if (!channel?.repoId) return;

    const prNumber = payload.pull_request?.number;
    if (!prNumber) return;

    // Idempotent: skip if entity already exists for this repo + PR number
    const existing = pullRequestService.getByRepoAndNumber(channel.repoId, prNumber);
    if (existing) return;

    // Map the PR's head branch to a local worktree.
    // Uses worktreeService.getByBranch() which internally runs
    // `git worktree list --porcelain` and matches branch names.
    // The branch name should also be cached on the worktree entity
    // to avoid repeated shell-outs for every lookup.
    const headBranch = payload.pull_request?.head?.ref;
    const baseBranch = payload.pull_request?.base?.ref;
    const worktree = findWorktreeByBranch(channel.repoId, headBranch);
    // Uses the `findWorktreeByBranch` helper from `src/entities/pull-requests/utils.ts`
    // (defined in plan A). This looks up worktrees from the repository store by matching
    // `currentBranch` on `WorktreeState`, falling back to `git worktree list --porcelain`
    // if needed.
    if (!worktree) return; // No local worktree for this branch — skip

    const repoSlug = payload.repository?.full_name;

    const pr = await pullRequestService.create({
      prNumber,
      repoId: channel.repoId,
      worktreeId: worktree.id,
      repoSlug,
      headBranch,
      baseBranch,
    });

    // Emit event for UI to react.
    // The PR item appears in the side panel with a blue GitPullRequest icon
    // (lucide-react) to indicate it's newly detected. The icon reverts to
    // grey after the user clicks/views it. The content pane is NOT
    // force-opened — this avoids interrupting whatever the user is
    // currently doing (reading a thread, editing code, etc.).
    eventBus.emit(EventName.PR_CREATED, { prId: pr.id, repoId: channel.repoId, worktreeId: worktree.id });
  }

  // ── PR Closed / Merged ─────────────────────────────────────────
  if (githubEventType === "pull_request" && payload.action === "closed") {
    const channel = gatewayChannelService.get(channelId);
    if (!channel?.repoId) return;

    const prNumber = payload.pull_request?.number;
    if (!prNumber) return;

    const pr = pullRequestService.getByRepoAndNumber(channel.repoId, prNumber);
    if (!pr) return;

    // Auto-disable auto-address when PR is closed or merged.
    // Auto-address state lives on PR metadata (autoAddressEnabled +
    // gatewayChannelId), not on the gateway channel entity.
    // The gateway channel has no activePrIds field — it is concerned
    // only with event lifecycle (connection, webhook, routing).
    if (pr.autoAddressEnabled) {
      await pullRequestService.update(pr.id, {
        autoAddressEnabled: false,
        gatewayChannelId: null,
      });
    }

    // Refresh display data so UI shows closed/merged state immediately.
    // This is part of the "Stage 1: always refresh display data" pattern --
    // gateway events update PullRequestDetails for ALL PRs (not just
    // auto-addressed ones) so status dots and content pane stay current.
    const worktreePath = useRepoWorktreeLookupStore.getState().getWorktreePath(channel.repoId, pr.worktreeId);
    if (worktreePath) {
      const ghCli = new GhCli(worktreePath);
      const details = await ghCli.getPrDetails(pr.prNumber);
      usePullRequestStore.getState().setPrDetails(pr.id, details);
    }
  }

  // ... auto-address event handling for check_run, check_suite,
  // pull_request_review, pull_request_review_comment, issue_comment
  // continues below (see pr-auto-address.md Phase 3) ...
});
```

### Both Creation Paths

This webhook-based detection catches PRs created via both paths:

1. **Agent-driven (plus menu)**: User clicks "Create pull request" -> agent thread spawns with `/create-pr` skill -> agent runs `gh pr create` -> GitHub fires `pull_request.opened` -> gateway delivers event -> PR entity created -> blue icon appears in side panel
2. **Manual (terminal)**: User runs `gh pr create` in any Anvil terminal -> same webhook flow -> PR entity created (as long as a gateway channel exists for the repo, which it does by default)

In both cases, the PR item appears with a loading skeleton briefly while the title and status are fetched via `gh pr view --json`. The skeleton resolves quickly since PR details are queried immediately on entity creation.

### From the Action Flow (existing PR)

When `handleCreatePr()` finds an existing PR via `gh pr view`, it creates the entity directly (no webhook needed) and opens the PR content pane. The content pane fetches fresh `PullRequestDetails` on mount -- there is no background polling. Since the gateway channel is always active, real-time updates via SSE keep the display current. A manual "Refresh" button in the content pane lets the user force a fresh `gh` CLI query.

---

## Error Handling

### `gh` CLI Missing or Unauthenticated

If `gh` is not installed, an error banner appears with an "Install GitHub CLI" action button that runs `brew install gh` in a shell. If `gh` is installed but not authenticated, an "Authenticate" button opens `gh auth login` in a terminal session.

When `gh` is unavailable:
- Gateway channel creation is skipped for affected repos during setup
- The "Create pull request" button shows a toast/banner explaining the issue
- Channel creation retries on next app launch or manual retry from Settings
- PR features are fully disabled until `gh` is working

### Webhook Event Edge Cases

- **`check_run.pull_requests` empty array**: Fork PRs and some CI configurations deliver `check_run` events without PR associations. `extractPrNumber` returns `null` and these events are silently dropped. Commit SHA lookups to resolve the PR are out of scope for v1.
- **PR for unknown branch**: If a `pull_request.opened` event references a branch with no local worktree, the event is silently dropped (the `worktreeService.getByBranch()` call returns `null`).
- **Duplicate events**: PR entity creation is idempotent -- `pullRequestService.getByRepoAndNumber()` checks for existing entities before creating.

---

## File Structure

```
src/lib/
  pr-actions.ts                  NEW: handleCreatePr action flow
  gh-cli.ts                      FROM pr-entity plan (Phase 2)

plugins/anvil/skills/create-pr/
  SKILL.md                       NEW: bundled create-pr skill
                                 (synced to ~/.anvil/skills/ by syncManagedSkills)
```

### Files NOT Needed

- ~~`src/lib/pr-detection.ts`~~ -- no terminal output parsing needed; PR creation is detected via `pull_request.opened` gateway webhook events
- ~~`src/lib/gateway-setup.ts`~~ -- gateway channel setup is handled by `ensureGatewayChannelForRepo` in the gateway-channels entity service, not by the PR creation flow
