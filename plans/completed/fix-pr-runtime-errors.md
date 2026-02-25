# Fix PR Runtime Errors

Two runtime errors are firing on the `gateway` branch. Both relate to the new PR integration.

## Phases

- [x] Add diagnostic logging to identify root causes
- [ ] Fix root causes once logging reveals them

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Bug 1: `undefined is not an object (evaluating 'event.type.startsWith')`

**File:** `src/entities/gateway-channels/listeners.ts:15`

**Stack trace chain:**
```
create@service.ts → eventBus.emit(PR_CREATED) → mitt.emit → gateway-channels/listeners handler
```

**What we know:**
- The only legitimate emitter of `GATEWAY_EVENT` is `gateway-client-lifecycle.ts:32`, and the `GatewayClient` validates events via `GatewayEventSchema.safeParse()` before calling `onEvent` — so the happy path should never produce an invalid event.
- There are no wildcard (`"*"`) listeners registered on the event bus.
- `GATEWAY_EVENT` is not in the `BROADCAST_EVENTS` list, so it's not being forwarded cross-window.
- The stack trace claims `PR_CREATED` emission triggers the `GATEWAY_EVENT` handler, which would be a mitt registration bug or an issue with how the handler ends up in the wrong handler array.
- No string collisions between event names.

**Diagnostic logging added:**
- `gateway-channels/listeners.ts` — logs every event hitting the `GATEWAY_EVENT` handler (payload, keys, types). Logs full error + stack trace if event has no `.type`.
- `gateway-client-lifecycle.ts` — logs the validated event *before* emission to confirm it has `.type`.

**Reproduce, then check logs for:**
1. Does the `onEvent` callback fire with a valid event right before the crash?
2. Does the listener log show an event without `.type`? What keys does it have? (`prId`, `repoId`, `worktreeId` would confirm the PR_CREATED payload is leaking.)
3. What does the diagnostic stack trace show as the caller?

## Bug 2: `ZodError: Invalid option for reviewDecision`

**File:** `src/lib/gh-cli/pr-schemas.ts:17-19`

**What we know:**
- GitHub's `gh pr view --json reviewDecision` is returning something other than the three enum values or `null`.
- The plan's hypothesis is `""` (empty string), but we haven't confirmed this.

**Diagnostic logging added:**
- `pr-queries.ts:fetchPrView()` — logs the raw `reviewDecision` value, its type, and its JSON representation before Zod parse.

**Reproduce, then check logs for:**
1. What is the actual value of `reviewDecision`? Is it `""`, `undefined`, some other string?
2. What is `typeof reviewDecision`?
