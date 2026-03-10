# Use Claude Login Credentials

Allow Mort users to authenticate using their existing `claude login` credentials instead of requiring a separate API key. Scoped to Claude Code OAuth credentials only — BYOK API key is handled separately.

## How It Works

The Claude Agent SDK's `query()` spawns Claude Code CLI as a subprocess. That subprocess resolves credentials in this order:

1. `ANTHROPIC_API_KEY` env var → API key auth
2. `CLAUDE_CODE_OAUTH_TOKEN` env var → OAuth token
3. macOS Keychain / `~/.claude/.credentials.json` → credentials stored by `claude login`

**Key insight:** If we simply don't pass `ANTHROPIC_API_KEY` to the agent subprocess, the CLI falls back to keychain credentials automatically. The core change is making the API key optional in the agent spawn path.

### Credential Storage

`claude login` stores credentials in the macOS Keychain under service `Claude Code-credentials`:
```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1748276587173,
    "scopes": ["user:inference", "user:profile"]
  }
}
```

## Current Auth Flow (What Changes)

**`src/lib/agent-service.ts`** — two spawn functions (`startSimpleAgent`, `resumeSimpleAgent`):
```ts
// Lines 714-721 and 878-885: Currently REQUIRES an API key
const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("Anthropic API key not configured");

// Lines 741-742 and 913-914: Passes it to subprocess env
const envVars = { ANTHROPIC_API_KEY: apiKey, ... };
```

**`src/entities/settings/store.ts`** — `isConfigured()` currently requires both repo AND apiKey:
```ts
isConfigured: () => {
  const { repository, anthropicApiKey } = get().workspace;
  return repository !== null && anthropicApiKey !== null;
}
```

**`agents/src/runners/shared.ts:1343`** — `query()` passes `process.env` through to the CLI:
```ts
env: { ...process.env, CLAUDECODE: undefined, ... }
```

**Naming services** (`simple-runner-strategy.ts:553, 609`) — make direct Anthropic API calls using `process.env.ANTHROPIC_API_KEY`. When it's missing, they already gracefully skip.

## Phases

- [ ] Add auth method to settings schema and store
- [ ] Update agent spawn to support no-API-key mode
- [ ] Add Claude login detection (keychain probe)
- [ ] Add auth method UI in settings

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add Auth Method to Settings Schema

**`src/entities/settings/types.ts`**

Add an `authMethod` field to `WorkspaceSettingsSchema`:

```ts
authMethod: z.enum(["api-key", "claude-login", "default"]).optional(),
```

- `"api-key"` — use `anthropicApiKey` from settings (BYOK, handled separately)
- `"claude-login"` — don't pass API key, let CLI use keychain credentials
- `"default"` / `undefined` — current behavior (use built-in key from env)

**`src/entities/settings/store.ts`**

Update `isConfigured()` to allow Claude Login auth without an API key:

```ts
isConfigured: () => {
  const { repository, anthropicApiKey, authMethod } = get().workspace;
  if (repository === null) return false;
  if (authMethod === "claude-login") return true;  // No API key needed
  return anthropicApiKey !== null;
}
```

Add a selector:
```ts
getAuthMethod: () => get().workspace.authMethod ?? "default",
```

## Phase 2: Update Agent Spawn to Support No-API-Key Mode

**`src/lib/agent-service.ts`** — both `startSimpleAgent` (~line 714) and `resumeSimpleAgent` (~line 878):

Replace the hard requirement for an API key:

```ts
const settings = settingsService.get();
const authMethod = settings.authMethod ?? "default";

const envVars: Record<string, string> = {
  NODE_PATH: nodeModulesPath,
  MORT_DATA_DIR: mortDir,
  PATH: shellPath,
};

if (authMethod === "claude-login") {
  // Don't pass ANTHROPIC_API_KEY — CLI will use keychain credentials
  // Naming services will gracefully skip (existing behavior when no key)
} else {
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }
  envVars.ANTHROPIC_API_KEY = apiKey;
}
```

**Note on env inheritance:** The Rust `spawn_agent` (dispatch_agent.rs:62) uses `.envs(&env)` which extends the parent environment. In production (desktop app), `ANTHROPIC_API_KEY` won't be in the parent env, so not passing it in the dict is sufficient. For dev (where `.env` sets it), we should explicitly pass an empty value to override:

```ts
if (authMethod === "claude-login") {
  envVars.ANTHROPIC_API_KEY = "";  // Explicitly clear to override any inherited env
}
```

Actually — empty string may still be treated as "set". Better approach: the Rust side should support an env var removal convention, OR we ensure `query()` in `shared.ts` handles this. Since `shared.ts:1343` already spreads `process.env` into the `query()` env option, we can add:

```ts
// In shared.ts query() env construction:
env: {
  ...process.env,
  CLAUDECODE: undefined,
  // If no ANTHROPIC_API_KEY in env, let CLI use keychain
  ...(process.env.ANTHROPIC_API_KEY === "" && { ANTHROPIC_API_KEY: undefined }),
}
```

## Phase 3: Add Claude Login Detection

We need a way to detect whether the user has Claude Code credentials, so the UI can show status.

**New file: `src/lib/claude-login-detector.ts`** (~50 lines)

```ts
import { Command } from "@tauri-apps/plugin-shell";

export interface ClaudeLoginStatus {
  detected: boolean;
  /** Which method was found */
  source?: "keychain" | "env-var" | "credentials-file";
}

export async function detectClaudeLogin(): Promise<ClaudeLoginStatus> {
  // 1. Check CLAUDE_CODE_OAUTH_TOKEN env var
  // (unlikely in desktop app, but check anyway)

  // 2. macOS Keychain probe
  try {
    const cmd = Command.create("security", [
      "find-generic-password",
      "-s", "Claude Code-credentials",
      "-w"
    ]);
    const output = await cmd.execute();
    if (output.code === 0 && output.stdout.trim().length > 0) {
      return { detected: true, source: "keychain" };
    }
  } catch {
    // Keychain access failed or not on macOS
  }

  // 3. Fallback: check ~/.claude/.credentials.json
  // (Use Tauri fs plugin to check file existence)

  return { detected: false };
}
```

**Note:** This does NOT extract or store the token — it just checks existence. The actual auth happens inside the Claude Code CLI subprocess which has native keychain access.

## Phase 4: Add Auth Method UI

**New file: `src/components/main-window/settings/auth-settings.tsx`** (~80 lines)

A settings section that shows:

```
Authentication
┌─────────────────────────────────────────┐
│ ○ Default (Mort built-in key)           │
│ ○ Claude Login  ✓ Detected              │
│ ○ API Key       [handled by BYOK plan]  │
└─────────────────────────────────────────┘

Claude Login uses credentials from `claude login`.
Run this in your terminal if not detected.
```

- Radio group for auth method selection
- Detection status shown inline (calls `detectClaudeLogin()` on mount)
- "Not detected" shows helper text: "Run `claude login` in your terminal"
- Selecting "Claude Login" saves `authMethod: "claude-login"` to settings
- Selecting "Default" saves `authMethod: "default"` (or removes the field)
- "API Key" option defers to the BYOK plan's UI

**Integration point:** Wire this into the existing settings page layout (likely `repository-settings.tsx` or a new tab/section adjacent to it).

---

## Files Changed Summary

| File | Change |
|------|--------|
| `src/entities/settings/types.ts` | Add `authMethod` field to schema |
| `src/entities/settings/store.ts` | Update `isConfigured()`, add `getAuthMethod()` |
| `src/lib/agent-service.ts` | Make API key optional when `authMethod === "claude-login"` |
| `agents/src/runners/shared.ts` | Handle empty `ANTHROPIC_API_KEY` in `query()` env |
| `src/lib/claude-login-detector.ts` | **New** — keychain probe for detection UI |
| `src/components/main-window/settings/auth-settings.tsx` | **New** — auth method selector UI |
| `src/entities/settings/settings.test.ts` | Tests for new auth method behavior |

## Edge Cases

- **No credentials anywhere:** Error message on thread start: "No authentication configured. Run `claude login` or add an API key in settings."
- **Expired OAuth token:** The CLI handles refresh automatically using the stored refresh token.
- **Dev environment:** `.env` sets `ANTHROPIC_API_KEY` which is inherited by agent subprocess. When `authMethod === "claude-login"`, we explicitly clear it so the CLI uses keychain instead.
- **Thread/worktree naming:** These make direct API calls (not through SDK). With Claude Login, `ANTHROPIC_API_KEY` won't be in env, so naming is skipped gracefully (existing fallback behavior). This is acceptable — naming is cosmetic.
