# GitHub Pull Request Integration

First-class pull request support in Mort: a new PR entity, side panel item type, content pane, and event-driven automation via the buffered event gateway.

## Problem

Developers working in Mort have no visibility into their pull requests. They must context-switch to the browser to check CI status, read review comments, and address feedback. We want to:

1. Surface PRs in the side panel alongside threads, plans, and terminals
2. Display PR details (description, CI checks, review status) in a content pane
3. Detect PR creation via gateway webhook events (`pull_request.opened`)
4. Enable one-click PR creation via agent + configurable skill
5. Optionally auto-address review comments and CI failures via gateway events

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Side Panel                                          │
│  ┌─────────────────────────────────────────────────┐ │
│  │ repo / worktree                                 │ │
│  │   🔀 PR #42: Add auth flow   ← pinned at top   │ │
│  │   💬 Thread: implement login                    │ │
│  │   📄 Plan: auth-design                          │ │
│  │   > Terminal 1                                  │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  Plus menu (per worktree):                           │
│    + New thread                                      │
│    + New terminal                                    │
│    + Create pull request  ← NEW                      │
│    + New worktree                                    │
│    + New repository                                  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Content Pane (PR view)                              │
│  ┌─────────────────────────────────────────────────┐ │
│  │ PR #42: Add auth flow                           │ │
│  │ by @zac · Open · main ← feature/auth            │ │
│  │                                                 │ │
│  │ ## Description                                  │ │
│  │ Implements the authentication flow using...      │ │
│  │                                                 │ │
│  │ ## Checks                                       │ │
│  │ ✅ lint ·  ✅ build · ❌ test-e2e · ⏳ deploy    │ │
│  │                                                 │ │
│  │ ## Reviews                                      │ │
│  │ @reviewer: Approved                             │ │
│  │                                                 │ │
│  │ ┌─────────────────────────────────────────────┐ │ │
│  │ │ 🔔 Auto-address comments & CI    [  OFF  ] │ │ │
│  │ └─────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘

             Gateway Event Flow (when auto-address ON):

GitHub ──webhook──▶ Gateway ──SSE──▶ Mort Client
                                        │
                                        ▼
                              Event Handler (signal only)
                                        │
                                        ▼
                              gh cli fresh query
                                        │
                                        ▼
                              Spawn agent with skill
                              to address comment/fix CI
```

## Phases

- [x] Design and decompose all sub-plans
- [x] Wave 1: Implement PR entity and data model (A: pr-entity)
- [x] Wave 2: Implement side panel integration (B1: pr-ui-panel-integration)
- [x] Wave 2: Implement gateway channels (D1: pr-gateway-channels)
- [x] Wave 3: Implement PR content pane (B2: pr-ui-content-pane)
- [x] Wave 3: Implement PR creation flow (C: pr-creation)
- [x] Wave 3: Implement PR event handling (D2: pr-event-handling)
- [x] Integration testing across all components

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Sub-Plans

### Plan Index

| ID | Plan | Scope | Depends on | Est. Files |
|----|------|-------|------------|------------|
| A | [pr-entity](./pr-entity.md) | PR data model, entity service, store, GhCli client | None | 9-12 |
| **B** | **[pr-ui](./pr-ui.md)** | **Parent plan — decomposed into B1 + B2** | | |
| B1 | [pr-ui-panel-integration](./pr-ui-panel-integration.md) | Side panel PR item, tree data hook, type extensions, plus menu | A | 9 |
| B2 | [pr-ui-content-pane](./pr-ui-content-pane.md) | PR content pane with all sub-components and data fetching | A, B1 | 10 |
| C | [pr-creation](./pr-creation.md) | Create-pr skill, agent flow, PR detection via webhook | A, B1 | 3-5 |
| **D** | **[pr-auto-address](./pr-auto-address.md)** | **Parent plan — decomposed into D1 + D2** | | |
| D1 | [pr-gateway-channels](./pr-gateway-channels.md) | Gateway channels entity (types, store, service, listeners, webhook CRUD) | A | 9 |
| D2 | [pr-event-handling](./pr-event-handling.md) | PR event classification, auto-address logic, address-pr-comment + fix-ci skills | A, B1, D1 | 6 |

### Execution Map

```
Wave 1 (1 agent):
  └─ A: pr-entity

Wave 2 (2 agents in parallel):
  ├─ B1: pr-ui-panel-integration
  └─ D1: pr-gateway-channels

Wave 3 (3 agents in parallel):
  ├─ B2: pr-ui-content-pane
  ├─ C:  pr-creation
  └─ D2: pr-event-handling
```

### Dependency Graph

```
         ┌─────────┐
         │ A: entity│
         └────┬────┘
              │
     ┌────────┼────────┐
     ▼                  ▼
┌─────────┐      ┌──────────┐
│B1: panel │      │D1: gateway│
│integration│     │ channels  │
└────┬────┘      └─────┬────┘
     │                  │
  ┌──┼──────┐     ┌────┘
  │  │      │     │
  ▼  ▼      ▼     ▼
┌────┐ ┌────┐ ┌─────┐
│ B2 │ │ C  │ │ D2  │
│pane│ │crea│ │event│
│    │ │tion│ │hdlr │
└────┘ └────┘ └─────┘
```

**Wave 1** — A has no dependencies and must complete first. It establishes the PR data model, `GhCli` client, Zustand store, and entity service that everything else builds on.

**Wave 2** — B1 and D1 are independent of each other; both only depend on A. B1 wires the side panel item and tree data. D1 builds the gateway channels entity with SSE lifecycle and webhook CRUD.

**Wave 3** — B2, C, and D2 can all run in parallel once their dependencies from Wave 2 are met:
- **B2** needs B1's type extensions and panel integration
- **C** needs B1's plus menu wiring (the stub `handleCreatePr`)
- **D2** needs D1's gateway channel events and B1's PR store integration

## Key Decisions

1. **All GitHub data fetched via `gh` CLI, not direct API.** Leverages the user's existing GitHub credentials. No OAuth, no tokens to manage. Shell commands run in the worktree context so `{owner}/{repo}` resolves automatically.

2. **Events are signals, not data.** Gateway events trigger a fresh `gh` CLI query rather than using the webhook payload. This ensures data is always current and avoids stale payload issues.

3. **Webhooks are repo-level, not per-PR.** GitHub doesn't support per-PR webhooks. We create one repo webhook via `gh api repos/{owner}/{repo}/hooks` and filter events server-side by PR number.

4. **PR entity is lightweight — gh CLI is the source of truth.** We store minimal metadata (PR number, repo, worktree binding). All display data is fetched on-demand via `gh pr view --json` and `gh pr checks --json`.

5. **PR creation via agent + configurable skill.** The "Create PR" action spawns a thread with a `create-pr` skill. The skill is configurable (users can override with their own). The agent runs `gh pr create` and the resulting PR is detected via gateway webhook.

6. **PR detection via gateway webhook events.** Instead of parsing terminal output, we detect new PRs via `pull_request.opened` webhook events through the same gateway channel infrastructure used for auto-address. This catches PRs created both via the plus menu agent and manual terminal usage (as long as a gateway channel exists for the repo).

7. **Auto-address is opt-in per PR.** The toggle lives in the PR content pane. Turning it on registers a gateway channel and creates a repo webhook (if one doesn't already exist for this repo).

8. **One webhook per repo, shared across PRs.** When the first PR in a repo enables auto-address, we create the webhook. When the last PR disables it, we clean up. The webhook URL uses the gateway channel system from the buffered event gateway.

9. **PR items are pinned at the top of their worktree section.** Like terminals, PRs get priority placement. Each worktree can have at most one active PR (the branch's PR).

10. **PR number as the stable identifier within a repo.** The entity key is `{repoId}:{prNumber}`. The worktreeId binding can change if the user switches branches.

11. **PR lifecycle: closed/merged PRs stay visible until archived.** When a PR is closed or merged, its state updates in the side panel. The PR is archived when the user explicitly archives it or when its parent worktree is archived. Archiving disables auto-address if active.

12. **Worktree branch lookup via `git worktree list --porcelain`.** To map a webhook's branch name to a worktree entity, we parse `git worktree list` output. The branch name should also be stored on the worktree entity to avoid repeated shell-outs.

13. **Auto-address fields live on PR metadata.** `autoAddressEnabled` (boolean) and `gatewayChannelId` (nullable UUID) are persisted on the `PullRequestMetadata` schema, not derived from channel state.

14. **Auto-address permission mode is a user setting, default "approve".** Users can configure the permission mode for auto-address agents in Settings. Default is "approve" (agents wait for user approval on each tool call). Users who want hands-free automation can change this.

15. **All bundled skills live in `plugins/mort/skills/`.** The `create-pr`, `address-pr-comment`, and `fix-ci` skills are all defined in `plugins/mort/skills/` and synced to `~/.mort/skills/` via `syncManagedSkills()` on startup, consistent with `commit` and `simplify-code`.

16. **Concurrent agents are not queued — skills warn about concurrency instead.** When multiple events fire for the same PR (e.g., CI failure + review comment), multiple agents may run in the same worktree simultaneously. The skills include a concurrency warning instructing agents to check `git status`, stash if needed, and pull before pushing.

17. **Event classifier checks conclusion before spawning CI fix agents.** `check_run` and `check_suite` events only trigger auto-address when the conclusion is `"failure"` or `"timed_out"`. Passing checks are silently ignored.

18. **Gateway channels are created for all repos by default.** Channels and webhooks are set up during repo setup (hydration or initial add), not on-demand. This means webhook events flow for all repos regardless of auto-address state. The auto-address toggle controls agent spawning, not event reception.

19. **No polling — PR data refreshes on pane open and manual refresh only.** Since gateway channels are always active, real-time updates via SSE handle CI and review events. The content pane fetches fresh data when opened and provides a manual refresh button. No background polling.

20. **Review comments fetched via GraphQL for resolution state.** Uses `gh api graphql` to query `reviewThreads` with `isResolved` field. Unresolved comments display expanded, resolved comments display collapsed. Rich comment rendering (markdown, thread replies) is future scope.

21. **`create-pr` skill has `bash,read,grep,glob` tools.** The agent needs to read code to write good PR descriptions, not just run git commands. No `edit`/`write` since it shouldn't change code.

22. **PR side panel items show a loading skeleton on first appearance.** When a PR entity is created (via detection or plus menu), details are fetched immediately. A loading skeleton displays briefly until the title and status resolve. This is rare — PR items only appear after explicit user action or webhook detection.

23. **Gateway events update PR display data for all PRs, not just auto-addressed ones.** The PR entity listener has two stages: (a) always refresh cached `PullRequestDetails` in the store so the side panel status dots and content pane stay current, (b) only spawn agents if `autoAddressEnabled` is true. Filtering for agent spawning happens at the PR entity listener level.

24. **`gh` CLI missing/unauthenticated shows an error banner with action button.** If `gh` is not installed, an "Install GitHub CLI" button runs `brew install gh`. If not authenticated, an "Authenticate" button opens `gh auth login` in a terminal. Gateway channel creation is skipped and retried on next launch or manual retry.

25. **Auto-address agents use discretion for top-level PR comments.** Many `issue_comment` events are conversational ("LGTM", etc.) and don't require code changes. The agent determines if action is needed rather than blindly modifying code. A future routing layer with a cheaper LLM may triage events before spawning full agents.

26. **`pull_request.closed` auto-disables auto-address.** When a PR is closed or merged, auto-address is automatically disabled (removed from `activePrIds`, metadata updated). The PR stays visible in the side panel until archived, but no agents will be spawned for it.

27. **`GhCli` uses repo root for webhook/API operations.** GitHub has no concept of local worktrees. For webhook CRUD and repo-level API calls, `GhCli` is always instantiated with the repo root path. For PR-specific queries, any worktree path works since they share the same remote.

28. **No connection status indicator on auto-address toggle.** Since gateway channels are always active per-repo, the SSE connection is always on. The auto-address toggle is a simple on/off with no connection status display.

29. **Debounce timings vary by event type.** CI events use a 30-second window (to let the full suite finish), review/comment events use a 5-second window (typically individual actions, should be responsive).

30. **CI fix agents must verify locally before pushing.** The `fix-ci` skill requires running the failing check locally before pushing. This prevents feedback loops where a bad fix triggers another CI failure and another agent spawn. Future scope: a "wait for CI" tool that lets the same agent handle follow-up failures in one session.

31. **Gateway channel setup runs idempotently on every app mount.** `ensureGatewayChannelForRepo` is called for every repo during entity hydration, not just on first creation. This handles retries after failures, reinstalls, and ensures channels are always in sync.

32. **Skill invocation handled by agent SDK.** When a thread is spawned with `prompt: "/create-pr"`, the agent SDK resolves the skill from the slash command. No special wiring needed in the PR creation flow.

33. **Webhook-detected PRs appear silently with a blue icon.** When a `pull_request.opened` event creates a PR entity, the content pane is NOT force-opened (avoids interrupting the user). Instead, the PR item appears in the side panel with a blue `GitPullRequest` icon, reverting to grey after the user views it.

34. **"Create pull request" button label stays constant.** The button always says "Create pull request" — if a PR already exists for the branch, clicking it opens the existing PR. Multi-PR per worktree is out of scope.

35. **Gateway channel entity has no `activePrIds`.** The gateway channel is concerned only with event lifecycle (connection, webhook, routing). Auto-address state lives entirely on PR metadata (`autoAddressEnabled` + `gatewayChannelId`). The PR entity listener checks `pr.autoAddressEnabled` when events arrive — no channel-level PR tracking.

36. **`GhCli` is a proper typed client, not a thin shell wrapper.** Each method parses output into strongly-typed return values, handles errors with descriptive types, and parallelizes independent sub-queries (e.g., `getPrDetails` runs 3 commands concurrently via `Promise.all`).

37. **Archiving a PR does not stop running threads.** If auto-address agents are currently running when the user archives a PR, the threads continue to completion. Archiving disables auto-address (no new agents will spawn) but doesn't interrupt in-progress work.

38. **Empty `check_run.pull_requests` array is acceptable for v1.** Fork PRs and some CI configs may deliver `check_run` events without PR associations. These are silently dropped — `extractPrNumber` returns `null`. Out of scope to add commit SHA lookups.
