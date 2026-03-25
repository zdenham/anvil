# Remove Default Built-in API Key

Users should only authenticate via their own API key (BYOK) or their own Claude login — the built-in Anvil API key should be removed entirely from the codebase.

## Phases

- [x] Phase 1: Remove `"default"` from types and migrate persisted settings

- [x] Phase 2: Remove built-in key from env and type declarations

- [x] Phase 3: Strip default auth from UI, store, and spawn logic

- [x] Phase 4: Add first-run auth gating

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Remove `"default"` from types and migrate persisted settings

Start at the foundation — remove the concept of `"default"` auth from the type system and handle existing users.

**Files:**

- `src/entities/settings/types.ts` — remove `"default"` from `authMethod` Zod enum (line \~31), leaving `["api-key", "claude-login"]`
- `src/entities/settings/service.ts` — add migration: if persisted `authMethod` is `"default"` or `undefined`, rewrite to `"claude-login"`
- `src/entities/settings/store.ts` — change `getAuthMethod` return type to `"api-key" | "claude-login"`, default fallback from `"default"` to `"claude-login"` (line \~55)

## Phase 2: Remove built-in key from env and type declarations

Delete the key itself so it's no longer baked into builds.

**Files:**

- `.env` — delete the `VITE_ANTHROPIC_API_KEY=...` line
- `src/vite-env.d.ts` — delete the `VITE_ANTHROPIC_API_KEY` type declaration (line \~7)

## Phase 3: Strip default auth from UI, store, and spawn logic

With the type gone and key deleted, remove all code that referenced them.

**Files:**

- `src/components/main-window/settings/auth-settings.tsx`:
  - Remove `"default"` from the local `AuthMethod` type (line \~8)
  - Remove the "Default (Anvil built-in key)" radio button (lines \~26-35)
  - Change the fallback from `?? "default"` to `?? "claude-login"` (line \~11)
  - Remove the `method === "default" ? undefined : method` ternary — just pass `method` directly (line \~19)
- `src/lib/agent-service.ts`:
  - In `spawnSimpleAgent()` (\~lines 846-878): remove the `else` branch that reads `import.meta.env.VITE_ANTHROPIC_API_KEY`, change `?? "default"` fallback to `?? "claude-login"`, leaving only the `claude-login` and `api-key` branches
  - In `resumeSimpleAgent()` (\~lines 1025-1060): same changes — remove the default/built-in key branch, change fallback

After this phase, `VITE_ANTHROPIC_API_KEY` and `"default"` should have zero references in `src/`.

## Phase 4: Add first-run auth gating

Ensure users can't spawn agents without valid auth configured.

**Files:**

- `src/entities/settings/store.ts` — update `isConfigured()` (or add `isAuthConfigured()`) to require either:
  - `authMethod === "claude-login"`, OR
  - `authMethod === "api-key"` AND `anthropicApiKey` is set
- `src/components/main-window/settings/auth-settings.tsx` (or existing first-run flow) — when auth is not configured, show a message directing users to set up authentication before they can create agents