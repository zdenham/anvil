# Fix: SDK runner path resolution broken in production

## Problem

Quick actions fail in production with:

```
Error: Cannot find module '/Applications/Mort.app/Contents/Resources/sdk-runner.js'
```

The file actually exists at `/Applications/Mort.app/Contents/Resources/_up_/sdk-runner.js`.

## Root Cause

In `src/lib/paths.ts`, the production path resolution for `sdk-runner.js` (line 58) and `sdk-types.d.ts` (line 76) is missing the `_up_/` prefix.

When Tauri bundles resources specified with `../` in `tauri.conf.json` (lines 61-62), it places them under `_up_/` in the Resources directory. The code doesn't account for this.

**Dev mode works fine** because it uses `__PROJECT_ROOT__` filesystem paths directly.

**Production breaks** because `resolveResource('sdk-runner.js')` resolves to `Resources/sdk-runner.js` instead of `Resources/_up_/sdk-runner.js`.

The correct pattern is already used elsewhere in the codebase:
- `paths.ts:31` — `resolveResource('_up_/core/sdk/template')`
- `agent-service.ts` — `resolveResource('_up_/agents/dist/runner.js')`

## Fix

In `src/lib/paths.ts`:

**Line 58** — change:
```typescript
const runnerPath = await resolveResource('sdk-runner.js');
```
to:
```typescript
const runnerPath = await resolveResource('_up_/sdk-runner.js');
```

**Line 76** — change:
```typescript
const typesPath = await resolveResource('sdk-types.d.ts');
```
to:
```typescript
const typesPath = await resolveResource('_up_/sdk-types.d.ts');
```

## Phases

- [x] Fix `resolveResource` calls in `src/lib/paths.ts` to include `_up_/` prefix
- [x] Verify no other `resolveResource` calls are missing the prefix

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Verification

After rebuilding, confirm that `getRunnerPath()` returns a path containing `_up_/sdk-runner.js` in production.
