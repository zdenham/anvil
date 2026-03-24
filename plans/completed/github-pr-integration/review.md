# GitHub PR Integration — Plan Review

## Overall Verdict

**The plan is ready for implementation after the revision pass below.** The dependency graph, wave structure, and key decisions are sound. All critical blockers identified in the initial review have been corrected.

### Corrections Applied

The following issues from the initial review have been fixed across all sub-plans:

**Plan A (pr-entity):**
- Shell execution now specifies `Command.create("gh", ...)` from `@tauri-apps/plugin-shell` with capability config
- Event emissions added to `create()`, `update()`, and `archive()` service methods
- Timestamps corrected to `z.number()` (Unix epoch ms)
- `index.ts` barrel export and entity registration section added
- `_applyDelete` rollback now restores `prDetails` and `prDetailsLoading`
- `fetchDetails` uses `useRepoWorktreeLookupStore` for worktree path resolution
- `findWorktreeByBranch` placed in `src/entities/pull-requests/utils.ts`
- Gateway handler role clarified (handler called by D2 listeners, not a standalone listener)

**Plan B1 (pr-ui-panel-integration):**
- `handleItemSelect` case for `"pull-request"` added (Phase 5f)
- Timestamp fields use direct `pr.updatedAt` / `pr.createdAt` (already epoch ms)

**Plan B2 (pr-ui-content-pane):**
- `useCallback` syntax error on `isLoading` selector fixed
- D1 added as explicit dependency for Phase 5 (auto-address toggle)
- Missing import paths added for `gatewayChannelService` and `pullRequestService` in toggle
- Note added clarifying `ExternalLink`, `PictureInPicture2`, `X` already imported

**Plan C (pr-creation):**
- Thread creation uses `createThread()` from `thread-creation-service.ts` (correct API)
- Content pane navigation uses `contentPanesService.setActivePaneView()`
- `findWorktreeByBranch` used instead of nonexistent `worktreeService.getByBranch()`
- `PR_CREATED` event uses `EventName.PR_CREATED` enum
- `getBranchInfo()` has concrete implementation using `Command.create("git", ...)`
- Worktree path resolution uses `useRepoWorktreeLookupStore`

**Plan D1 (pr-gateway-channels):**
- Timestamps corrected to `z.number()` (Unix epoch ms)
- Gateway base URL corrected to `https://anvil-server.fly.dev`
- `getDeviceId()` implementation specified (reads `~/.anvil/identity.json` via `IdentitySchema`)
- Explicit channel registration HTTP call added with field mapping (`channelId` → `id`)
- `.js` extensions added to import paths

**Plan D2 (pr-event-handling):**
- Permission mode uses `PermissionModeId` from `core/types/permissions.ts`
- `settingsService.get()` removed; hardcoded to `"approve"` with TODO for settings UI
- Worktree path lookup uses `useRepoWorktreeLookupStore`
- `createThread()` call matches actual `CreateThreadOptions` interface
- Gateway handler vs listeners relationship clarified
- `threadName` usage removed from spawn function (not a valid `createThread` param)

---

## Remaining Items (non-blocking)

These are lower-severity items that agents can handle during implementation:

### Across all plans
- **No tests specified** — agent guidelines require proving code works. Each plan's verification section describes what to test but doesn't include test file specs. Implementing agents should add tests as part of each phase.
- **Event names not yet in `core/types/events.ts`** — Plan A Phase 1 should add all new event names (`PR_CREATED`, `PR_UPDATED`, `PR_ARCHIVED`) and D1 Phase 2 adds gateway events. This is documented in both plans.

### Plan A
- Service uses object literal vs class preference — minor style choice
- `GhCli` may exceed 250 lines — plan already notes splitting as contingency
- Missing Zod schemas for `gh` CLI output parsing — agents can add inline

### Plan B1
- `use-tree-data.ts` already exceeds 250-line limit — plan notes extracting `derivePrStatusDot` to `src/utils/pr-status.ts`

### Plan B2
- `content-pane-header.tsx` is 432 lines — plan acknowledges and suggests extraction
- `PrLoadingSkeleton` not fully implemented — standard skeleton pattern, agent can implement
- No `formatRelativeTime` helper — agent can add a simple utility
- GhCli error handling described but not fully wired — agent can implement based on description

### Plan D1
- `ensureGatewayChannelForRepo` runs sequentially — could parallelize with `Promise.allSettled`
- `ConnectionStatus` type could be reused from `core/gateway/client.ts`

---

## Execution Readiness Summary

| Plan | Ready? | Remaining Work | Risk |
|------|--------|----------------|------|
| A: pr-entity | 95% | Tests, minor style | Low |
| B1: pr-ui-panel | 95% | Tests | Low |
| B2: pr-ui-content-pane | 90% | Skeleton impl, error wiring, tests | Low |
| C: pr-creation | 95% | Tests | Low |
| D1: pr-gateway-channels | 95% | Parallelize hydration, tests | Low |
| D2: pr-event-handling | 90% | Tests, debounce cleanup hook | Low |

**Recommendation: Ready to proceed with Wave 1 (Plan A).**
