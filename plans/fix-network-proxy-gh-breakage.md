# Fix Network Proxy Breaking `gh` CLI and Non-Node Tools

## Problem

The MITM network debugger proxy is **unconditionally enabled** for all agent spawns (`agent-service.ts:752-753`), which sets `HTTPS_PROXY`, `HTTP_PROXY`, and `NODE_EXTRA_CA_CERTS` env vars. These propagate to every subprocess the agent spawns — including `gh`, `git`, `curl`, and other non-Node tools.

The proxy uses a self-signed CA cert that's only trusted via `NODE_EXTRA_CA_CERTS` (a Node.js-specific mechanism). Non-Node tools like `gh` (Go binary) see `HTTPS_PROXY`, route through the proxy, get an untrusted MITM cert, and fail with TLS errors.

**Evidence:** Thread `85f0074e` shows an agent repeatedly failing to use `gh` until it discovered it needed to `unset HTTPS_PROXY HTTP_PROXY` before every `gh` call. The agent even identified "the proxy is interfering with `gh`".

### Secondary issue

`resumeSimpleAgent` doesn't set `MORT_NETWORK_DEBUG=1` at all, so the proxy is inconsistently applied — active on spawn, absent on resume.

## Root Cause

`agent-service.ts:751-753`:

```ts
// Enable network debugging unconditionally — near-zero overhead,
// hub socket handles the volume fine. Settings toggle can be added later.
envVars.MORT_NETWORK_DEBUG = "1";
```

And `runner.ts:359-383` — when this flag is set, the proxy starts and injects `HTTPS_PROXY`/`HTTP_PROXY` into `process.env`, which all child processes (including Bash tool executions) inherit.

## Phases

- [x] Phase 1: Wire existing Record button to control `MORT_NETWORK_DEBUG` via settings

- [x] Phase 2: Auto-disable network debugger when debug panel closes

- [x] Phase 3: Scope proxy to API traffic only (don't pollute subprocess env)

- [x] Phase 4: Fix resume inconsistency

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Wire existing Record button to control `MORT_NETWORK_DEBUG` via settings

The debug panel's Network tab already has a Record/Stop button in `network-request-list.tsx:151-162` that toggles `isCapturing` in the network debugger store. Currently this is purely frontend state — it gates whether incoming hub messages are stored, but has no effect on whether the proxy is actually started for agent processes.

### What exists today

- **Record button**: `network-request-list.tsx` — toggles `useNetworkDebuggerStore.isCapturing`
- **Store**: `stores/network-debugger/store.ts` — `isCapturing: false` by default, `toggleCapture()` flips it
- **Agent spawn**: `agent-service.ts:751-753` — unconditionally sets `MORT_NETWORK_DEBUG=1`
- **Settings**: `entities/settings/types.ts` — `WorkspaceSettingsSchema` has no network debugger field

### Changes

**1. Add** `networkDebugEnabled` **to workspace settings** — `src/entities/settings/types.ts`

```ts
// Add to WorkspaceSettingsSchema:
networkDebugEnabled: z.boolean().optional(),
```

No need for a nested object — a simple boolean is sufficient. `.optional()` keeps backwards compat with existing settings files (defaults to `undefined`/falsy = off).

**2. Wire** `toggleCapture` **to persist to settings** — `src/stores/network-debugger/store.ts`

When the user clicks Record, also persist `networkDebugEnabled` to workspace settings so the next agent spawn picks it up:

```ts
toggleCapture: () => {
  const next = !get().isCapturing;
  logger.info(`[network-debugger] Capture ${next ? "started" : "stopped"}`);
  set({ isCapturing: next });

  // Persist to settings so next agent spawn knows whether to start proxy
  settingsService.update({ networkDebugEnabled: next });
},
```

Import `settingsService` from `@/entities/settings`. Check how `settingsService.update()` works — it likely does a partial merge + persist.

**3. Gate** `MORT_NETWORK_DEBUG` **on settings** — `src/lib/agent-service.ts`

Replace the unconditional line 751-753:

```ts
// Before (unconditional):
envVars.MORT_NETWORK_DEBUG = "1";

// After (settings-gated):
const networkDebugEnabled = useSettingsStore.getState().workspace.networkDebugEnabled;
if (networkDebugEnabled) {
  envVars.MORT_NETWORK_DEBUG = "1";
}
```

This makes the proxy **off by default** and only active when the user has clicked Record.

## Phase 2: Auto-disable network debugger when debug panel closes

When the debug panel is closed (X button or Cmd+Shift+D), the network debugger should be turned off. This prevents the proxy from silently running on subsequent agent spawns after the user has dismissed the debug panel.

### Changes

`src/stores/debug-panel/service.ts` — In `close()`, also disable network capturing:

```ts
close(): void {
  useDebugPanelStore.getState()._applyClose();

  // Turn off network capture when debug panel closes
  const networkStore = useNetworkDebuggerStore.getState();
  if (networkStore.isCapturing) {
    networkStore.toggleCapture(); // This will persist networkDebugEnabled=false via Phase 1 wiring
  }
},
```

Import `useNetworkDebuggerStore` from `@/stores/network-debugger`.

**Note:** This means the user must have the debug panel open with Record active for the proxy to be enabled on new agent spawns. Closing the panel = opting out. Re-opening the panel doesn't auto-start — user must click Record again.

## Phase 3: Scope proxy to API traffic only

Even when the proxy is enabled, it should NOT intercept traffic from non-Node tools. The proxy currently mutates `process.env` at `runner.ts:376-378`, which all child processes (Bash tool executions → `gh`, `git`, `curl`) inherit.

### Approach: Pass proxy config through options, inject only into SDK `query()` env

**1.** `agents/src/runner.ts` — Stop mutating `process.env`. Store proxy config and pass it through:

```ts
// runner.ts — instead of process.env mutation:
let proxyConfig: { port: number; certPath: string } | undefined;

if (process.env.MORT_NETWORK_DEBUG === "1") {
  // ... existing proxy setup ...
  const { port } = await proxy.start();
  proxyConfig = { port, certPath: certManager.certPath };
  // REMOVE: process.env.HTTPS_PROXY = ...
  // REMOVE: process.env.HTTP_PROXY = ...
  // REMOVE: process.env.NODE_EXTRA_CA_CERTS = ...
}
```

Thread `proxyConfig` into the options bag passed to `runAgentLoop`.

**2.** `agents/src/runners/shared.ts` — When building env for `query()`, inject proxy vars only there:

```ts
const sdkEnv = { ...process.env };
if (options.proxyConfig) {
  sdkEnv.HTTPS_PROXY = `http://127.0.0.1:${options.proxyConfig.port}`;
  sdkEnv.HTTP_PROXY = `http://127.0.0.1:${options.proxyConfig.port}`;
  sdkEnv.NODE_EXTRA_CA_CERTS = options.proxyConfig.certPath;
}
```

This is surgical — only the SDK's API calls go through the proxy. Bash tool executions (which spawn `gh`, `git`, etc.) use vanilla `process.env` without proxy vars.

**Check**: Verify how `query()` passes env to the subprocess. The SDK `query()` call around line \~1202 in `shared.ts` already passes `env: { ...process.env }` — confirm this is where we inject.

## Phase 4: Fix resume inconsistency

`src/lib/agent-service.ts` — `resumeSimpleAgent` (line \~911) builds `resumeEnvVars` but never sets `MORT_NETWORK_DEBUG`. Apply the same settings-gated logic from Phase 1:

```ts
// In resumeSimpleAgent, after building resumeEnvVars (around line 919):
const networkDebugEnabled = useSettingsStore.getState().workspace.networkDebugEnabled;
if (networkDebugEnabled) {
  resumeEnvVars.MORT_NETWORK_DEBUG = "1";
}
```

## Files to modify

| File | Change |
| --- | --- |
| `src/entities/settings/types.ts` | Add `networkDebugEnabled: z.boolean().optional()` to schema |
| `src/stores/network-debugger/store.ts` | Wire `toggleCapture` to persist `networkDebugEnabled` to settings |
| `src/lib/agent-service.ts` | Gate `MORT_NETWORK_DEBUG` on `networkDebugEnabled` setting (spawn + resume) |
| `src/stores/debug-panel/service.ts` | Disable network capture on panel close |
| `agents/src/runner.ts` | Stop mutating `process.env`, store proxy config in local var |
| `agents/src/runners/shared.ts` | Accept proxy config, inject into SDK `query()` env only |
