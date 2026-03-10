# Use Claude Login Credentials (BYOL — Bring Your Own Login)

Allow Mort users to authenticate using their existing `claude login` credentials instead of requiring a separate API key.

## Research Summary

### How Conductor Does It

Conductor's approach is simple:
1. **Bundles its own Claude Code CLI** at `~/Library/Application Support/com.conductor.app/bin`
2. The Claude Agent SDK's `query()` function **spawns Claude Code CLI as a subprocess**
3. That subprocess reads OAuth credentials from the **macOS Keychain** (service: `Claude Code-credentials`)
4. No custom auth code needed — the bundled CLI handles it natively

The keychain entry (written by `claude login`) contains:
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

Alternatively, the `CLAUDE_CODE_OAUTH_TOKEN` env var can be set (it overrides keychain). Users can generate a long-lived token via `claude setup-token`.

### Critical Policy Problem

**Anthropic explicitly prohibits this as of January/February 2026.**

From their [legal docs](https://code.claude.com/docs/en/legal-and-compliance):
> "Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted and constitutes a violation of the Consumer Terms of Service."

Key facts:
- Enforcement began January 2026 with server-side blocks on third-party harnesses
- Multiple apps (OpenCode, Clawdbot, etc.) were [forced to remove Claude subscription auth](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)
- Anthropic engineer Thariq Shihipar confirmed this is deliberate: third-party harnesses "generate unusual traffic patterns without any of the usual telemetry"
- The SDK itself is allowed, but **only with API keys**, not subscription OAuth tokens

Conductor appears to still work because:
- They bundle their own Claude Code CLI (so it looks like a normal Claude Code session)
- Anthropic may not yet be detecting/blocking this pattern
- Or they may have a partner arrangement (unconfirmed)

**Risk: If we do the same, Anthropic could block Mort users at any time, or take action against us.**

### What's Actually Allowed

1. **API keys** from console.anthropic.com (pay-as-you-go) — always allowed
2. **Claude for Teams/Enterprise** credentials — allowed
3. **Cloud providers** (Bedrock, Vertex, Foundry) — allowed
4. **`apiKeyHelper`** — a Claude Code setting that runs a shell script to return an API key dynamically

## Recommended Approach

Given the policy landscape, I recommend a **tiered approach** rather than just copying Conductor:

### Option A: Safe — API Key Only (Current BYOK Plan)

The existing `plans/bring-your-own-api-key.md` plan already covers this. Users paste their API key into settings. Zero risk.

### Option B: Medium Risk — Detect & Offer Claude Login Credentials

Read the user's existing Claude Code credentials from the keychain and offer to use them. This is technically what Conductor does. It works today but violates Anthropic's stated policy.

### Option C: Safest + Best UX — Hybrid Auth with Fallback

Support multiple auth methods with clear user communication:

1. **Primary: API key** (settings UI from BYOK plan)
2. **Secondary: Detect Claude Code login** and let users opt-in with a warning about Anthropic's policy
3. **Future: Cloud provider support** (Bedrock/Vertex env vars)

## Phases

- [ ] Implement BYOK API key UI (execute existing `bring-your-own-api-key.md` plan)
- [ ] Add Claude login credential detection
- [ ] Add auth method selector UI
- [ ] Add cloud provider env var support

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Implement BYOK API Key UI

Execute the existing `plans/bring-your-own-api-key.md` plan. This is the safe, policy-compliant baseline.

## Phase 2: Add Claude Login Credential Detection

**New file:** `agents/src/lib/claude-credential-reader.ts`

Detect whether the user has Claude Code credentials available:

```ts
// On macOS: read from keychain
// security find-generic-password -s "Claude Code-credentials" -w
// On Linux: use libsecret / secret-tool
// Fallback: check ~/.claude/.credentials.json

// Also check for CLAUDE_CODE_OAUTH_TOKEN env var
```

**File:** `src/lib/agent-service.ts`

When spawning agent subprocesses, if no API key is configured, check for Claude login credentials and pass `CLAUDE_CODE_OAUTH_TOKEN` as an env var to the subprocess.

Auth resolution order:
1. User-provided API key (from settings)
2. `CLAUDE_CODE_OAUTH_TOKEN` env var (if user opted in)
3. Detected keychain credentials (if user opted in)
4. Built-in default key (current fallback)

## Phase 3: Add Auth Method Selector UI

**File:** `src/components/main-window/settings/auth-settings.tsx`

Replace the simple API key input with an auth method selector:

- **API Key** — paste your key from console.anthropic.com
- **Claude Login** — use credentials from `claude login` (detected automatically, show warning about Anthropic policy)
- **Default** — use Mort's built-in key

Show detection status: "Claude Code login detected" / "Not logged in — run `claude login` in terminal"

## Phase 4: Cloud Provider Support

Support Bedrock/Vertex/Foundry via environment variables:
- Detect `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`
- Pass through to agent subprocess env
- Show status in auth settings UI

---

## Decision Needed

**Which option do you want to pursue?**

- **Just Option A** (BYOK plan only) — safest, already planned
- **Option B** (detect Claude login like Conductor) — works today, policy risk
- **Option C** (hybrid with all methods) — most complete, phases 1+2+3+4 above

The technical implementation is straightforward regardless. The main question is how much policy risk you're comfortable with.
