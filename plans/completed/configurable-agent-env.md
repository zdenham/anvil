# Configurable Agent .env

Allow users to supply a custom `.env` file that gets loaded into the agent process environment. Primary use case: enabling Vertex AI or other provider configurations via environment variables on the Claude Agent SDK.

## Phases

- [x] Extend settings schema with env file fields

- [x] Build settings UI component

- [x] Load and inject env vars at agent spawn time

- [x] Add tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Extend Settings Schema

**File:** `src/entities/settings/types.ts`

Add two new fields to `WorkspaceSettingsSchema`:

```typescript
/** Path to a .env file whose variables are injected into agent processes. */
envFilePath: z.string().optional(),

/** Whether the custom env file is active. When false, the file is ignored even if a path is set. */
envFileEnabled: z.boolean().optional(),
```

No changes to `DEFAULT_WORKSPACE_SETTINGS` needed — both fields are optional and default to `undefined` (path defaults to `.anvil/.env` in the UI, enabled defaults to `false`).

## Phase 2: Settings UI Component

**New file:** `src/components/main-window/settings/env-file-settings.tsx`

A new `<EnvFileSettings />` section in the settings page with three controls:

1. **Toggle** — Enable/disable env file loading (`envFileEnabled`)
2. **Path input** — Text input showing the current path, with a file-picker button (use `@tauri-apps/plugin-dialog` `open()` like `repository-settings.tsx`). Defaults to displaying `.anvil/.env` as placeholder when no custom path is set.
3. **"Open" button** — Just calls `paneLayoutService.openFile(resolvedPath)`, same as the file explorer. If the file doesn't exist yet, create it first (empty) so the editor can open it.

**File:** `src/components/main-window/settings-page.tsx`

Import and render `<EnvFileSettings />` in the settings page, placed after the API key section (since they're related — both configure how the agent authenticates with providers).

### UI Behavior

- When no path is set and the user enables the toggle, auto-populate with the default path (`{anvilDir}/.env` resolved via `FilesystemClient.getDataDir()`).
- Show a subtle status indicator: "Active — N variables loaded" or "Disabled" based on toggle state.
- The path input is editable regardless of toggle state (user can set up the path before enabling).

## Phase 3: Load and Inject Env Vars at Agent Spawn Time

**File:** `src/lib/agent-service.ts`

In both `spawnSimpleAgent()` and `resumeSimpleAgent()`, after building the base `envVars` dict:

1. Read `envFileEnabled` and `envFilePath` from `useSettingsStore.getState().workspace`
2. If enabled and path is set:
   - Read the file via `FilesystemClient.readFile(resolvedPath)`
   - Parse `KEY=VALUE` pairs (see parsing rules below)
   - Merge into `envVars` — env file vars are added to the dict, but **explicit settings like** `ANTHROPIC_API_KEY` **take precedence** (they're set after the merge)

### .env Parsing Rules

Extract into a small utility: `src/lib/parse-env-file.ts`

- Skip empty lines and lines starting with `#`
- Split on first `=` only (values can contain `=`)
- Trim whitespace from keys
- Strip matching outer quotes from values (`"..."` or `'...'`)
- Ignore lines without `=`
- No variable interpolation (keep it simple)

```typescript
export function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1);
    // Strip matching quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}
```

### Merge Order in envVars

```
1. Base vars (PATH, NODE_PATH, ANVIL_DATA_DIR)
2. .env file vars (merged here — can set ANTHROPIC_API_KEY, CLOUD_ML_REGION, etc.)
3. Explicit overrides (ANTHROPIC_API_KEY from settings if set, diagnostic vars, proxy vars)
```

This means if the user sets `ANTHROPIC_API_KEY` in the .env file but also has a key in the API key settings, the settings key wins. If they only set it in .env, it works. This is the intuitive behavior.

### Sub-agent Inheritance

The env vars flow naturally to sub-agents:

- `child-spawner.ts` uses `{ ...process.env }` when spawning children
- Since the parent's `process.env` includes the .env vars (set by the Rust spawn), children inherit them automatically

### Error Handling

- If the file doesn't exist or can't be read: log a warning, proceed without env file vars (don't block agent spawn)
- If parsing fails on a line: skip that line, log a warning

## Phase 4: Tests

**File:** `src/entities/settings/settings.test.ts`

- Test that new schema fields validate correctly (optional string, optional boolean)
- Test backwards compatibility (settings without the new fields still parse)

**New file:** `src/lib/__tests__/parse-env-file.test.ts`

- Empty content → empty object
- Comments and blank lines skipped
- Basic `KEY=VALUE` parsing
- Quoted values (single and double)
- Values containing `=` signs
- Keys with leading/trailing whitespace trimmed
- Lines without `=` skipped

**File:** `src/lib/agent-service.ts` (or integration test)

- Verify env vars from .env file appear in the spawn envVars dict
- Verify explicit settings override .env vars (ANTHROPIC_API_KEY precedence)
- Verify disabled toggle means no env file vars loaded

## Key Files

| File | Change |
| --- | --- |
| `src/entities/settings/types.ts` | Add `envFilePath`, `envFileEnabled` fields |
| `src/components/main-window/settings/env-file-settings.tsx` | New component (toggle, path, open button) |
| `src/components/main-window/settings-page.tsx` | Import and render `<EnvFileSettings />` |
| `src/lib/parse-env-file.ts` | New utility for .env parsing |
| `src/lib/agent-service.ts` | Load .env and merge into envVars at spawn time |
| `src/lib/__tests__/parse-env-file.test.ts` | Unit tests for parser |
| `src/entities/settings/settings.test.ts` | Schema validation tests |
