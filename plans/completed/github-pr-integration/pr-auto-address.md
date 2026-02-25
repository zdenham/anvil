# D: PR Auto-Address via Gateway Events

Enables automated responses to PR review comments and CI failures using the buffered event gateway. When auto-address is toggled on for a PR, incoming gateway events for that PR spawn agents with appropriate skills (`address-pr-comment`, `fix-ci`) to handle the feedback. Gateway channels and webhooks exist for all repos by default -- the toggle only controls whether agents are spawned, not whether events are received.

**Depends on:** A (PR entity + GhCli), B (PR UI + content pane), C (PR creation flow + gateway channel setup)

## Phases

- [ ] Implement gateway-channels entity (disk-persisted, lifecycle management)
- [ ] Implement repo webhook lifecycle via gh CLI
- [ ] Implement gateway event handling via PR entity listeners
- [ ] Create skills for auto-addressing comments and CI failures
- [ ] Wire up auto-address toggle in PR content pane

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Gateway Channels Entity

### Overview

Gateway channels are a first-class entity following the standard pattern (`types.ts`, `store.ts`, `service.ts`, `listeners.ts`). The entity owns the `GatewayClient` lifecycle: on startup it hydrates channels from disk, connects the SSE client if any channels are active, and routes incoming events to entity listeners via the event bus.

Channels are created for **all repos by default** during repo hydration (not on-demand when auto-address is enabled). This means webhook events flow for every repo regardless of auto-address state. PR creation detection, CI status updates, and review notifications are always available. The auto-address toggle controls whether agents are **spawned** in response to events, not whether events are **received**. The gateway channel entity has no `activePrIds` field -- auto-address state lives entirely on PR metadata (`autoAddressEnabled` + `gatewayChannelId`), not on the channel.

Channel setup runs idempotently on every app mount via `ensureGatewayChannelForRepo`, called for every repo during entity hydration. This handles retries after previous failures, reinstalls, and keeps channels in sync.

### Types: `core/types/gateway-channel.ts`

Validated with Zod at trust boundaries (disk reads, network responses) per codebase convention.

```typescript
import { z } from "zod";

export const GatewayChannelMetadataSchema = z.object({
  /** Stable ID: matches the server-side channelId (UUID) */
  id: z.string().uuid(),
  /** Channel type -- determines event routing */
  type: z.literal("github"),
  /** Human label (e.g. "owner/repo") */
  label: z.string().min(1),
  /** Whether this channel is currently active (receiving events) */
  active: z.boolean(),
  /** The webhook URL that external sources post to (contains unguessable channelId) */
  webhookUrl: z.string().url(),
  /** Associated repo entity ID */
  repoId: z.string().uuid().nullable().default(null),
  /** GitHub webhook ID for cleanup on delete */
  webhookId: z.number().nullable().default(null),
  /** ISO timestamp */
  createdAt: z.string().datetime(),
  /** ISO timestamp */
  updatedAt: z.string().datetime(),
});

export type GatewayChannelMetadata = z.infer<typeof GatewayChannelMetadataSchema>;
```

### Storage

```
~/.mort/gateway-channels/{channelId}/
  metadata.json    <- GatewayChannelMetadata (Zod-validated on read)
~/.mort/gateway-channels/
  checkpoint       <- Last-Event-ID string for SSE replay on reconnect
```

### Store: `src/entities/gateway-channels/store.ts`

Zustand store following the single-copy-per-entity rule.

```typescript
interface GatewayChannelStoreState {
  channels: Record<string, GatewayChannelMetadata>;
  /** Gateway SSE connection status */
  connectionStatus: "disconnected" | "connecting" | "connected";
  _hydrated: boolean;
}

interface GatewayChannelStoreActions {
  getChannel(id: string): GatewayChannelMetadata | undefined;
  getChannelByRepoId(repoId: string): GatewayChannelMetadata | undefined;
  getActiveChannels(): GatewayChannelMetadata[];
  hasActiveChannels(): boolean;

  _applyCreate(channel: GatewayChannelMetadata): () => void;
  _applyUpdate(id: string, channel: GatewayChannelMetadata): () => void;
  _applyDelete(id: string): () => void;
  setConnectionStatus(status: "disconnected" | "connecting" | "connected"): void;

  hydrate(channels: Record<string, GatewayChannelMetadata>): void;
}
```

### Service: `src/entities/gateway-channels/service.ts`

The service owns the singleton `GatewayClient` instance. On hydration, if any channels are active, it connects. On activate/deactivate, it manages the connection lifecycle.

```typescript
export class GatewayChannelService {
  /** Load all channel metadata from disk into store */
  async hydrate(): Promise<void>;

  /** Register a channel on the server and persist locally */
  async create(input: {
    deviceId: string;
    type: "github";
    label: string;
    repoId: string;
  }): Promise<GatewayChannelMetadata>;

  /** Activate a channel (start receiving events). Connects GatewayClient if not already connected. */
  async activate(channelId: string): Promise<void>;

  /** Deactivate a channel (stop routing events). Disconnects GatewayClient if no active channels remain. */
  async deactivate(channelId: string): Promise<void>;

  /** Delete channel from disk, store, and clean up webhook */
  async delete(channelId: string): Promise<void>;

  get(id: string): GatewayChannelMetadata | undefined;
  getByRepoId(repoId: string): GatewayChannelMetadata | undefined;
}
```

Keep the service class under 250 lines per codebase convention. Extract the `GatewayClient` lifecycle management into a private helper module if the file exceeds the limit.

### GatewayClient Lifecycle (internal to service)

```typescript
// Internal to gateway-channels/service.ts

let gatewayClient: GatewayClient | null = null;

function ensureConnected(deviceId: string): void {
  if (gatewayClient) return;

  gatewayClient = new GatewayClient({
    baseUrl: GATEWAY_BASE_URL,
    deviceId,
    loadLastEventId: () => appData.readText("gateway-channels/checkpoint"),
    saveLastEventId: (id) => appData.writeText("gateway-channels/checkpoint", id),
    onEvent: (event) => eventBus.emit(EventName.GATEWAY_EVENT, event),
    onStatus: (status) => {
      useGatewayChannelStore.getState().setConnectionStatus(status);
      eventBus.emit(EventName.GATEWAY_STATUS, { status });
    },
  });

  gatewayClient.connect();
}

function disconnectIfIdle(): void {
  const anyActive = useGatewayChannelStore.getState().hasActiveChannels();
  if (!anyActive && gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }
}
```

On app startup, `hydrateEntities()` in `src/entities/index.ts` calls `gatewayChannelService.hydrate()`. If any channels have `active: true`, the service calls `ensureConnected()` automatically. Channels that were active when the app last closed reconnect on relaunch. Events buffered in Redis while the app was closed are replayed via the `Last-Event-ID` mechanism built into the SSE client (see `core/gateway/client.ts`).

Since channels are always active per-repo, the SSE connection is always established on startup. There is no connection status indicator on the auto-address toggle -- the connection is a background concern, not a per-PR concern.

### Listeners: `src/entities/gateway-channels/listeners.ts`

Routes raw gateway events into typed entity events so downstream listeners can subscribe by type.

```typescript
export function setupGatewayChannelListeners(): void {
  // Route gateway events to typed entity-specific events
  eventBus.on(EventName.GATEWAY_EVENT, (event: GatewayEvent) => {
    if (event.type.startsWith("github.")) {
      eventBus.emit(EventName.GITHUB_WEBHOOK_EVENT, {
        channelId: event.channelId,
        githubEventType: event.type.replace("github.", ""),
        payload: event.payload,
      });
    }
  });
}
```

Register this in `setupEntityListeners()` in `src/entities/index.ts` alongside all other entity listeners. Add `GATEWAY_EVENT`, `GATEWAY_STATUS`, and `GITHUB_WEBHOOK_EVENT` to the `EventName` enum and `EventPayloads` in `core/types/events.ts`.

### Hydration Integration

Add to `hydrateEntities()` in `src/entities/index.ts`:

```typescript
// After core entities, hydrate gateway channels
await gatewayChannelService.hydrate();
logger.log("[entities:hydrate] Gateway channels hydrated");

// Ensure a gateway channel exists for each repo (idempotent)
const repos = repoService.getAll();
for (const repo of repos) {
  try {
    await ensureGatewayChannelForRepo(repo.id, repo.mainWorktreePath);
  } catch (e) {
    // Non-fatal: channel creation failure is retried on next launch
    logger.error(`[entities:hydrate] Failed to ensure gateway channel for ${repo.name}:`, e);
  }
}
```

If `gh` CLI is not installed or not authenticated, `ensureGatewayChannelForRepo` skips the channel/webhook creation for that repo and logs a warning. The channel is retried on the next app launch or when the user manually retries from the error banner. PR features remain disabled until `gh` is available.

---

## Phase 2: Repo Webhook Lifecycle via gh CLI

### Approach

Webhooks are **repo-level, not per-PR** -- GitHub does not support per-PR webhooks. We create one repo webhook via `gh api repos/{owner}/{repo}/hooks` and filter events server-side by PR number. One webhook per repo is shared across all PRs and all uses (PR creation detection, display updates, auto-address).

All GitHub data is fetched via the `gh` CLI, not direct API calls. This leverages the user's existing GitHub credentials -- no OAuth, no tokens to manage. Shell commands run in a repo/worktree context so `{owner}/{repo}` resolves automatically from the git remote.

The `GhCli` class (defined in pr-entity.md Phase 2) is a proper typed client, not a thin shell wrapper. Each method parses output into strongly-typed return values, handles errors with descriptive types, and parallelizes independent sub-queries (e.g., `getPrDetails` runs 3 commands concurrently via `Promise.all`). For webhook CRUD and repo-level API calls, `GhCli` is always instantiated with the **repo root path** -- GitHub has no concept of local worktrees. For PR-specific queries, any worktree path works since they share the same remote.

### Webhook Creation (embedded in gateway-channels service)

When creating a github-type channel, the service also creates the repo webhook:

```typescript
// In GatewayChannelService.create() for github type:

// 1. Register channel on gateway server
const { channelId, webhookUrl } = await postToGateway("/channels", {
  deviceId, type: "github", label: repoSlug,
});

// 2. Create repo webhook pointing to the channel's webhook URL.
//    The URL contains the unguessable channelId -- sufficient for v1 security.
//    No webhook secret verification (deferred to v2).
const ghCli = new GhCli(repoRootPath);
const webhookId = await ghCli.createWebhook(webhookUrl, [
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issue_comment",
  "check_run",
  "check_suite",
]);

// 3. Persist channel with webhookId for cleanup
await this.persistChannel({ ...channel, webhookId });
```

On delete, if `webhookId` is set, clean up via `ghCli.deleteWebhook(webhookId)`. If cleanup fails (e.g., Mort crashed), orphaned webhooks can be removed manually via `gh api repos/{owner}/{repo}/hooks` or re-cleaned on next startup.

### Events We Subscribe To

| Event | Purpose |
|-------|---------|
| `pull_request` | PR opened/closed/merged -- used for auto-detecting new PRs (pr-creation.md Phase 3) and auto-disabling auto-address on close |
| `pull_request_review` | New reviews (changes requested, approved, etc.) -- triggers display refresh and optionally auto-address agent |
| `pull_request_review_comment` | Inline code review comments -- triggers display refresh and optionally auto-address agent |
| `issue_comment` | Top-level PR comments -- triggers display refresh and optionally auto-address agent (with discretion) |
| `check_run` | Individual CI check completed -- triggers display refresh and optionally fix-ci agent |
| `check_suite` | CI suite completed -- triggers display refresh and optionally fix-ci agent |

### Idempotent Channel Per Repo

`ensureGatewayChannelForRepo` is called for every repo during entity hydration on every app mount. It checks if a channel already exists for the repo and creates one if not. If a channel exists but is inactive, it reactivates it.

```typescript
async function ensureGatewayChannelForRepo(
  repoId: string,
  repoRootPath: string,
): Promise<string> {
  let channel = gatewayChannelService.getByRepoId(repoId);
  if (channel) {
    if (!channel.active) {
      await gatewayChannelService.activate(channel.id);
    }
    return channel.id;
  }

  const ghCli = new GhCli(repoRootPath);
  if (!await ghCli.isAvailable()) {
    // gh CLI missing or unauthenticated -- skip, retry on next launch
    throw new Error("gh CLI not available");
  }

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

---

## Phase 3: Gateway Event Handling via PR Entity Listeners

### Architecture

Event handling follows the existing listeners pattern. The PR entity's `listeners.ts` handles gateway events, classifies them, fetches fresh data, and spawns agents. No standalone `PrEventDispatcher` or `pr-auto-address.ts` modules needed.

Events are **signals, not data**. Gateway events trigger a fresh `gh` CLI query rather than using the webhook payload. This ensures the agent always works with current data and avoids stale payload issues. The webhook payload is only used for routing (extracting the PR number and event type).

The PR entity listener handles gateway events in two stages:
1. **Display update (always)** -- refreshes cached `PullRequestDetails` in the store so the side panel status dots and content pane stay current for **all** PRs, not just auto-addressed ones.
2. **Agent spawn (only if `autoAddressEnabled`)** -- spawns an agent to address the event. The filtering for agent spawning happens at the PR entity listener level.

```
Gateway SSE Stream
      |
      v
  GatewayClient.onEvent()
      |
      v
  eventBus.emit(GATEWAY_EVENT)
      |
      v
  gateway-channels/listeners.ts
      | (routes to typed event)
      v
  eventBus.emit(GITHUB_WEBHOOK_EVENT)
      |
      |-- pull_request events --> PR creation/close handler
      |                           (see pr-creation.md Phase 3)
      v
  pull-requests/listeners.ts       <-- handles event classification,
      |                                 fresh data fetch, agent spawn
      |-- Extract PR number from payload
      |
      |-- Find PR entity (skip if no entity exists)
      |
      |-- Classify event type
      |
      |-- Stage 1: Update display data (always, for all PRs)
      |
      |-- Stage 2: Check pr.autoAddressEnabled
      |   |-- No -> stop (display already updated)
      |
      |-- Debounce (30s CI, 5s review/comment)
      |
      |-- Fresh query via GhCli (events are signals, not data)
      |   |-- check_run / check_suite -> ghCli.getPrChecks(prNumber)
      |   |-- pull_request_review_comment -> ghCli.getPrComments(prNumber)
      |   |-- issue_comment -> ghCli.getPrDetails(prNumber)
      |   |-- pull_request_review -> ghCli.getPrDetails(prNumber)
      |
      |-- Spawn agent with appropriate skill + fresh data
```

### Implementation: `src/entities/pull-requests/listeners.ts`

This file handles both `pull_request` lifecycle events (creation/close, defined in pr-creation.md) and the auto-address event handling below. Keep the file under 250 lines; extract helper functions into a sibling `event-helpers.ts` if needed.

```typescript
export function setupPullRequestListeners(): void {
  // ... pull_request lifecycle listeners (PR_CREATED, PR_UPDATED, etc.) ...
  // ... pull_request.opened / pull_request.closed handlers (from pr-creation.md) ...

  // ================================================================
  // Gateway Event Handling: Display Updates + Auto-Address
  // ================================================================

  eventBus.on(EventName.GITHUB_WEBHOOK_EVENT, async ({ channelId, githubEventType, payload }) => {
    // pull_request events handled separately for PR creation/close detection
    if (githubEventType === "pull_request") return;

    // 1. Resolve channel to repo
    const channel = gatewayChannelService.get(channelId);
    if (!channel?.repoId) return;

    // 2. Extract PR number from payload
    const prNumber = extractPrNumber(githubEventType, payload);
    if (!prNumber) return;
    // Empty check_run.pull_requests array is acceptable --
    // fork PRs and some CI configs deliver events without PR associations.
    // extractPrNumber returns null and the event is silently dropped.

    // 3. Find the PR entity
    const pr = pullRequestService.getByRepoAndNumber(channel.repoId, prNumber);
    if (!pr) return;

    // 4. Classify the event
    const action = classifyGithubEvent(githubEventType, payload);
    if (!action) return;

    // -- Stage 1: Display Update (always, for all PRs) ---------------
    const worktree = worktreeService.get(pr.worktreeId);
    if (worktree) {
      const ghCli = new GhCli(worktree.path);
      try {
        if (action.type === "ci-failure") {
          const checks = await ghCli.getPrChecks(pr.prNumber);
          const existing = usePullRequestStore.getState().getPrDetails(pr.id);
          if (existing) {
            usePullRequestStore.getState().setPrDetails(pr.id, { ...existing, checks });
          }
        } else {
          const details = await ghCli.getPrDetails(pr.prNumber);
          usePullRequestStore.getState().setPrDetails(pr.id, details);
        }
      } catch {
        // Display update failure is non-fatal -- do not block agent spawn
      }
    }

    // -- Stage 2: Agent Spawn (only if auto-address enabled) ---------
    if (!pr.autoAddressEnabled) return;

    debounceAutoAddress(pr.id, action, async () => {
      if (!worktree) return;

      const ghCli = new GhCli(worktree.path);
      const context = await fetchFreshContext(ghCli, pr.prNumber, action);

      // Permission mode is a user setting (default: "approve").
      // Users can change this in Settings to a more permissive mode
      // for hands-free automation.
      const permissionMode = getAutoAddressPermissionMode();

      await spawnAutoAddressAgent(pr, action, context, permissionMode);
    });
  });
}
```

### Event Classification Helpers

Extract these into `src/entities/pull-requests/event-helpers.ts` if `listeners.ts` exceeds 250 lines.

#### PR Number Extraction

```typescript
function extractPrNumber(
  eventType: string,
  payload: Record<string, unknown>,
): number | null {
  // pull_request_review, pull_request_review_comment:
  //   payload.pull_request.number
  // issue_comment:
  //   payload.issue.number (only if payload.issue.pull_request exists)
  // check_run:
  //   payload.check_run.pull_requests[0]?.number (may be empty array)
  // check_suite:
  //   payload.check_suite.pull_requests[0]?.number (may be empty array)
  //
  // Returns null if PR number cannot be determined.
  // Empty pull_requests arrays (common with fork PRs) return null and
  // the event is silently dropped -- out of scope to add commit SHA lookups.
}
```

#### Event Classification

The classifier checks conclusions before signaling actionable events. `check_run` and `check_suite` events only produce a `ci-failure` action when the conclusion is `"failure"` or `"timed_out"`. Passing, pending, and cancelled checks are silently ignored.

```typescript
type PrAction =
  | { type: "ci-failure" }
  | { type: "review-submitted" }
  | { type: "review-comment" }
  | { type: "pr-comment" };

function classifyGithubEvent(
  eventType: string,
  payload: Record<string, unknown>,
): PrAction | null {
  switch (eventType) {
    case "check_run":
      if (payload.action !== "completed") return null;
      if (!["failure", "timed_out"].includes(payload.check_run?.conclusion)) return null;
      return { type: "ci-failure" };
    case "check_suite":
      if (payload.action !== "completed") return null;
      if (!["failure", "timed_out"].includes(payload.check_suite?.conclusion)) return null;
      return { type: "ci-failure" };
    case "pull_request_review":
      if (payload.action !== "submitted") return null;
      return { type: "review-submitted" };
    case "pull_request_review_comment":
      if (payload.action !== "created") return null;
      return { type: "review-comment" };
    case "issue_comment":
      if (payload.action !== "created") return null;
      return { type: "pr-comment" };
    default:
      return null;
  }
}
```

### Fresh Data Queries

After classifying the event, the listener fetches current state via the `GhCli` service before spawning an agent. Events are signals, not data -- the webhook payload is never passed to the agent.

- **CI failure**: `ghCli.getPrChecks(prNumber)` -- full check status, identifies which checks failed
- **Review comment**: `ghCli.getPrComments(prNumber)` -- review comments with resolution state via GraphQL (`reviewThreads` with `isResolved` field). Unresolved comments are what the agent addresses.
- **PR comment**: `ghCli.getPrDetails(prNumber)` -- recent top-level comments
- **Review submitted**: `ghCli.getPrDetails(prNumber)` -- review state and body

```typescript
async function fetchFreshContext(
  ghCli: GhCli,
  prNumber: number,
  action: PrAction,
): Promise<string> {
  switch (action.type) {
    case "ci-failure": {
      const checks = await ghCli.getPrChecks(prNumber);
      const failing = checks.filter(c => c.status === "fail");
      return failing.map(c => `- ${c.name}: ${c.conclusion} (${c.url ?? "no link"})`).join("\n");
    }
    case "review-comment":
    case "review-submitted": {
      const comments = await ghCli.getPrComments(prNumber);
      const unresolved = comments.filter(c => !c.isResolved);
      return unresolved.map(c =>
        `- ${c.author} on ${c.path}:${c.line ?? "?"}: ${c.body}`
      ).join("\n\n");
    }
    case "pr-comment": {
      const details = await ghCli.getPrDetails(prNumber);
      // Most recent top-level comment -- the agent uses discretion to determine
      // if it requires action (many PR comments are conversational: "LGTM", etc.)
      return `Recent comments:\n${JSON.stringify(details.reviews.slice(-3), null, 2)}`;
    }
  }
}
```

### Debouncing

Multiple events may fire in quick succession. Debouncing is per PR + action type with different windows:

- **CI events (30s)**: `check_run` and `check_suite` events fire in bursts as a CI suite runs. A longer window lets the full suite finish before spawning a fix agent, avoiding premature action on partial results.
- **Review/comment events (5s)**: Reviews and comments are typically individual actions. A short window catches rapid-fire comments from the same reviewer while staying responsive.

```typescript
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS: Record<PrAction["type"], number> = {
  "ci-failure": 30_000,
  "review-submitted": 5_000,
  "review-comment": 5_000,
  "pr-comment": 5_000,
};

function debounceAutoAddress(prId: string, action: PrAction, fn: () => void): void {
  const key = `${prId}:${action.type}`;
  const existing = debounceMap.get(key);
  if (existing) clearTimeout(existing);
  debounceMap.set(key, setTimeout(() => {
    debounceMap.delete(key);
    fn();
  }, DEBOUNCE_MS[action.type]));
}
```

### Agent Spawning

Agents are spawned via the existing thread creation service. The prompt begins with the skill slash command -- the agent SDK resolves the skill from the command automatically (no special wiring needed).

Concurrent agents are **not queued**. When multiple events fire for the same PR (e.g., CI failure + review comment), multiple agents may run in the same worktree simultaneously. The skills include a concurrency warning instructing agents to check `git status`, stash if needed, and pull before pushing.

```typescript
async function spawnAutoAddressAgent(
  pr: PullRequestMetadata,
  action: PrAction,
  context: string,
  permissionMode: string,
): Promise<void> {
  const worktree = worktreeService.get(pr.worktreeId);
  if (!worktree) return;

  const { prompt } = buildAutoAddressPrompt(pr, action, context);

  // Uses existing thread creation infrastructure
  await createThread({
    repoId: pr.repoId,
    worktreeId: pr.worktreeId,
    prompt,
    sourcePath: worktree.path,
    permissionMode,
    name: threadName(action, pr.prNumber),
  });
}

function threadName(action: PrAction, prNumber: number): string {
  switch (action.type) {
    case "ci-failure": return `Fix CI on PR #${prNumber}`;
    case "review-comment": return `Address review on PR #${prNumber}`;
    case "review-submitted": return `Address review on PR #${prNumber}`;
    case "pr-comment": return `Respond to comment on PR #${prNumber}`;
  }
}

function buildAutoAddressPrompt(
  pr: PullRequestMetadata,
  action: PrAction,
  context: string,
): { prompt: string } {
  switch (action.type) {
    case "ci-failure":
      return {
        prompt: `/fix-ci\n\nPR #${pr.prNumber} on ${pr.repoSlug}\nBranch: ${pr.headBranch}\n\nFailing checks:\n${context}`,
      };
    case "review-comment":
    case "pr-comment":
    case "review-submitted":
      return {
        prompt: `/address-pr-comment\n\nPR #${pr.prNumber} on ${pr.repoSlug}\nBranch: ${pr.headBranch}\n\nReview comments to address:\n${context}`,
      };
  }
}
```

### PR Close Auto-Disables Auto-Address

When a `pull_request.closed` event arrives (covers both close and merge), auto-address is automatically disabled on the PR entity. The PR stays visible in the side panel until the user archives it, but no agents will be spawned for it. This is handled in the `pull_request` event handler in pr-creation.md Phase 3.

---

## Phase 4: Auto-Address Skills

### Skill Location and Sync

All bundled skills live in `plugins/mort/skills/` alongside `commit/` and `simplify-code/`. The existing `syncManagedSkills()` in `src/lib/skill-sync.ts` copies them to `~/.mort/skills/` on every app startup. No changes needed to the sync mechanism.

Skill lookup follows the standard precedence:
1. Project skills: `<repo>/.claude/skills/{skill-name}/`
2. Personal skills: `~/.claude/skills/{skill-name}/`
3. Mort skills: `~/.mort/skills/{skill-name}/`

Users can override any bundled skill by placing their own version in the project or personal skills directory.

### Skill: `plugins/mort/skills/address-pr-comment/SKILL.md`

```markdown
---
name: Address PR Comment
description: Addresses a review comment on a pull request
user-invocable: false
allowed-tools: bash,read,edit,write,grep,glob
---

You are addressing a review comment on a pull request. The comment details
and file context are provided below.

## Instructions

1. Read the comment carefully and understand what change is being requested
2. Read the relevant file(s) and surrounding context
3. Make the requested changes
4. Verify the changes compile/lint if applicable
5. Commit with a message like "address review: <summary of change>"
6. Push the commit

## Important

- Only change what the reviewer asked for -- don't refactor unrelated code
- If the comment is a question (not a change request), reply via:
  ```bash
  gh pr comment {prNumber} --body "response text"
  ```
- If you're unsure what the reviewer means, leave a comment asking for
  clarification rather than guessing
- For top-level PR comments (not inline review comments): use your discretion
  to determine if the comment is actionable. Many PR comments are conversational
  ("LGTM", "looks good", etc.) and don't require code changes. If the comment
  doesn't request a specific change, skip it -- don't make unnecessary
  modifications.

## Concurrency Warning

Another agent may be working in this same worktree concurrently (e.g., fixing
CI while you address a review comment). Before committing:
1. Run `git status` to check for unexpected changes
2. If there are uncommitted changes you didn't make, do a `git stash` before
   your work and `git stash pop` after, or coordinate via sequential commits
3. Pull before pushing to avoid conflicts
```

### Skill: `plugins/mort/skills/fix-ci/SKILL.md`

```markdown
---
name: Fix CI Failure
description: Investigates and fixes a CI check failure on a pull request
user-invocable: false
allowed-tools: bash,read,edit,write,grep,glob
---

You are fixing a CI check failure on a pull request. The failing check
details are provided below.

## Instructions

1. Examine the failing check output to understand what went wrong
2. If the failure is in a test:
   - Read the test file and the code it tests
   - Determine if the test needs updating or the code has a bug
   - Fix accordingly
3. If the failure is a lint/build error:
   - Read the error output
   - Fix the source file
4. **Run the failing check locally to verify the fix before pushing.**
   This is critical -- do not push until you have confidence the fix works.
   Run the relevant test suite, linter, or build command locally.
5. Commit with a message like "fix: <what was fixed> (CI)"
6. Only push after local verification passes

## Important

- Focus only on the failing check -- don't fix unrelated issues
- If the failure seems like a flaky test or infrastructure issue, report it
  rather than making code changes
- If you can't determine the cause, report what you found
- **Do not push a fix unless you've verified it locally.** A bad push
  triggers another CI run and potentially another fix attempt, creating
  a feedback loop.

## Concurrency Warning

Another agent may be working in this same worktree concurrently (e.g.,
addressing review comments while you fix CI). Before committing:
1. Run `git status` to check for unexpected changes
2. If there are uncommitted changes you didn't make, do a `git stash` before
   your work and `git stash pop` after, or coordinate via sequential commits
3. Pull before pushing to avoid conflicts
```

---

## Phase 5: Auto-Address Toggle Wiring

### Auto-Address State Model

Auto-address state lives entirely on the PR metadata: `autoAddressEnabled` (boolean) and `gatewayChannelId` (nullable UUID), persisted on the `PullRequestMetadata` schema. The gateway channel is not aware of which PRs are auto-addressed -- it just delivers events. The PR entity listener checks `pr.autoAddressEnabled` when events arrive to decide whether to spawn agents.

Auto-address is **opt-in per PR**. The toggle lives in the PR content pane (defined in pr-ui.md Phase 3). There is no connection status indicator on the toggle since gateway channels are always active per-repo.

### Enable Flow

When the user toggles auto-address ON for a PR:

```
Toggle ON
    |
    v
1. Get existing gateway channel for this repo
   gatewayChannelService.getByRepoId(repoId)
   Channel always exists (created during repo hydration on mount)
    |
    v
2. Update PR entity metadata
   pullRequestService.update(prId, {
     autoAddressEnabled: true,
     gatewayChannelId: channelId,
   })
    |
    v
3. UI updates reactively via Zustand store subscription
```

### Disable Flow

```
Toggle OFF
    |
    v
1. Update PR entity metadata
   pullRequestService.update(prId, {
     autoAddressEnabled: false,
     gatewayChannelId: null,
   })
    |
    v
2. UI updates reactively
```

Note: disabling auto-address does **not** stop running threads. If auto-address agents are currently running when the user toggles off (or archives the PR), those threads continue to completion. The toggle only prevents new agents from being spawned.

### Auto-Disable on PR Close/Merge

When a `pull_request.closed` event arrives, the listener automatically disables auto-address on the affected PR. The PR stays visible in the side panel until archived.

### Auto-Disable on Archive

When a PR entity is archived (by the user, or cascading from worktree archive), auto-address is disabled. Running threads are not interrupted.

### Permission Mode Setting

The permission mode for auto-address agents is a user setting in Settings, accessible under a "Pull Requests" or "Auto-Address" section.

```typescript
// In settings/app-settings or similar
interface AutoAddressSettings {
  /** Permission mode for auto-address spawned agents. Default: "approve" */
  permissionMode: "approve" | "auto-approve" | string;
}

function getAutoAddressPermissionMode(): string {
  return appSettings.get("autoAddress.permissionMode") ?? "approve";
}
```

- **Default: "approve"** -- agents wait for user approval on each tool call before making changes. This is the safe default.
- Users who want hands-free automation can change this to a more permissive mode.
- This is a **global setting** (not per-PR) -- applies to all auto-address agent spawns.

### Startup Reconnection

On app launch, `gatewayChannelService.hydrate()` loads channels from disk. Since channels are active for all repos by default, the SSE connection is always established on startup. Events buffered in Redis while the app was closed are replayed via the `Last-Event-ID` mechanism. No manual reconnection logic needed for auto-address -- it piggybacks on the always-on channel infrastructure.

---

## GhCli Methods Used by Auto-Address

All GitHub API interactions use the `GhCli` class defined in pr-entity.md Phase 2. The methods relevant to auto-address are:

```typescript
// src/lib/gh-cli.ts (defined in pr-entity plan)

export class GhCli {
  constructor(private cwd: string) {}

  async isAvailable(): Promise<boolean>;
  async getPrDetails(prNumber: number): Promise<PullRequestDetails>;
  async getPrChecks(prNumber: number): Promise<PullRequestDetails["checks"]>;
  async getPrComments(prNumber: number): Promise<PullRequestDetails["reviewComments"]>;
  async createWebhook(url: string, events: string[]): Promise<number>;
  async deleteWebhook(webhookId: number): Promise<void>;
  async listWebhooks(): Promise<Array<{ id: number; url: string; events: string[] }>>;
}
```

Review comments are fetched via GraphQL (`gh api graphql`) to access the `reviewThreads` with `isResolved` field. Unresolved comments display expanded in the UI; resolved comments display collapsed. Rich comment rendering (markdown, thread replies) is future scope -- v1 shows plain text.

---

## Future Scope

### Event Routing Layer

In v1, all qualifying events are passed directly to agents which use discretion to determine if action is needed (especially for `issue_comment` / `pr-comment` events where many comments are conversational). In the future, a routing layer using a cheaper/faster LLM could triage events before spawning a full agent -- classifying whether a comment is actionable, extracting the specific ask, and only spawning the expensive agent when there is real work to do.

### CI Fix Feedback Loop Prevention

Currently, if an agent pushes a CI fix that itself fails CI, a new `check_run` failure event arrives and could spawn another agent. The v1 mitigation is: the `fix-ci` skill requires local verification before pushing, which should prevent most bad pushes. In the future, instead of spawning a new agent per failure, the original agent could use a "wait for CI" tool that monitors the check status and handles follow-up failures within the same session -- avoiding the spawn-per-failure pattern entirely.

---

## Security Considerations

1. **Webhook URL contains unguessable channelId** -- sufficient for v1 (per gateway design)
2. **No webhook secret verification** -- deferred to v2 (per gateway design)
3. **gh CLI auth** -- uses the user's existing GitHub credentials; no additional secrets stored by Mort
4. **Agent permission mode** -- auto-address agents default to "approve" mode; user must approve tool usage before the agent makes changes
5. **Webhook cleanup** -- if Mort crashes before cleaning up, orphaned webhooks can be removed manually via `gh api repos/{owner}/{repo}/hooks` or re-cleaned on next startup

---

## File Structure

```
core/types/
  gateway-channel.ts             <- NEW: Zod schemas + types
  events.ts                      <- MODIFIED: add GATEWAY_EVENT, GATEWAY_STATUS,
                                    GITHUB_WEBHOOK_EVENT to EventName + EventPayloads

src/entities/gateway-channels/
  types.ts                       <- NEW: re-exports from core/types
  store.ts                       <- NEW: Zustand store (channels + connection status)
  service.ts                     <- NEW: CRUD + GatewayClient lifecycle
  listeners.ts                   <- NEW: routes GATEWAY_EVENT -> typed entity events
  index.ts                       <- NEW: public exports

src/entities/pull-requests/
  listeners.ts                   <- NEW: handles GITHUB_WEBHOOK_EVENT for display
                                    updates + auto-address (event classification,
                                    fresh data fetch, debounce, agent spawn)
  event-helpers.ts               <- NEW (if needed): extractPrNumber,
                                    classifyGithubEvent, debounceAutoAddress,
                                    fetchFreshContext (extracted if listeners.ts
                                    exceeds 250 lines)

src/entities/index.ts            <- MODIFIED: import + call
                                    setupGatewayChannelListeners(),
                                    setupPullRequestListeners(),
                                    gatewayChannelService.hydrate(),
                                    ensureGatewayChannelForRepo()

plugins/mort/skills/
  address-pr-comment/SKILL.md    <- NEW: skill for addressing review comments
  fix-ci/SKILL.md                <- NEW: skill for fixing CI failures

~/.mort/gateway-channels/{channelId}/
  metadata.json                  <- Persisted channel state
~/.mort/gateway-channels/
  checkpoint                     <- Last-Event-ID for SSE replay
```

### Files NOT Needed (vs original plan)

- ~~`src/lib/pr-event-dispatcher.ts`~~ -- event dispatching handled by PR entity listeners
- ~~`src/lib/pr-auto-address.ts`~~ -- agent spawning handled by PR entity listeners
- ~~`src/lib/gateway-integration.ts`~~ -- GatewayClient lifecycle owned by gateway-channels service
- ~~`src/entities/pull-requests/webhook-registry.ts`~~ -- webhook tracking embedded in gateway-channels entity
- ~~`~/.mort/pull-requests/webhook-registry.json`~~ -- webhook state lives in channel metadata
