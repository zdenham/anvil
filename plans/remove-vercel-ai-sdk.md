# Remove Vercel AI SDK — Use Agent SDK for Naming

## Why

The default `ANTHROPIC_API_KEY` is going away. Users will authenticate via Claude Code login (OAuth), which the Agent SDK already supports. The Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) requires an explicit API key, so it won't work for users without one. We need to replace all Vercel AI usage with Agent SDK `query()` calls that inherit the user's login session.

## Current State

**Vercel AI is used for exactly one thing:** LLM-powered naming (thread + worktree).

- `core/lib/naming/llm-fallback.ts` — the only file that imports `createAnthropic` + `generateText`
- `core/lib/naming/thread-name.ts` — thread naming (≤25 char short-circuit, else LLM)
- `core/lib/naming/worktree-name.ts` — worktree naming (≤20 char short-circuit, else LLM)

**Callers:**
1. `agents/src/runners/simple-runner-strategy.ts` — fire-and-forget naming for main threads
2. `agents/src/runners/shared.ts` — fire-and-forget naming for sub-agent threads
3. `sidecar/src/hooks/naming.ts` — fire-and-forget naming for TUI threads

**Dependencies declared in 3 package.json files:**
- Root: `"ai": "^5.0.108"`, `"@ai-sdk/anthropic": "^2.0.53"`
- Agents: `"ai": "^6.0.77"`, `"@ai-sdk/anthropic": "^3.0.38"`
- Sidecar: `"ai": "^6.0.77"`, `"@ai-sdk/anthropic": "^3.0.38"`

## Approach

Replace `generateText()` from Vercel AI with a minimal Agent SDK `query()` call. The SDK handles auth (API key OR Claude Code login) automatically. We'll spawn a tiny agent with no tools that just returns text — effectively using it as a completion API.

### Key design decision: minimal `query()` wrapper

The Agent SDK's `query()` is designed for full agent loops, but we can use it as a simple completion by:
- Passing `tools: []` (no tools available → model just responds with text)
- Passing `maxTurns: 1` or equivalent (single response, no agentic loop)
- Using `model: "claude-haiku-4-5"` for cost efficiency
- The system prompt + user prompt stay the same as today

This is lightweight: no tool definitions, no hooks, no permission handling. The SDK manages auth transparently.

## Phases

- [x] Phase 1: Create Agent SDK naming backend
- [x] Phase 2: Migrate callers and remove API key threading
- [x] Phase 3: Remove Vercel AI dependencies
- [x] Phase 4: Update tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Create Agent SDK naming backend

Replace `core/lib/naming/llm-fallback.ts` with a new implementation that uses the Agent SDK.

**New `core/lib/naming/llm-fallback.ts`:**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const MODELS = {
  primary: "claude-haiku-4-5-20251001",
  fallback: "claude-sonnet-4-6-20260217",
} as const;

export interface FallbackOptions {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  cwd: string; // needed by query()
}

export interface FallbackResult {
  text: string;
  usedFallback: boolean;
}

export async function generateWithFallback(
  options: FallbackOptions,
): Promise<FallbackResult> {
  try {
    const text = await runMinimalQuery({ ...options, model: MODELS.primary });
    return { text, usedFallback: false };
  } catch {
    // Primary model failed — try fallback
  }

  const text = await runMinimalQuery({ ...options, model: MODELS.fallback });
  return { text, usedFallback: true };
}

async function runMinimalQuery(opts: {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  model: string;
  cwd: string;
}): Promise<string> {
  const result = query({
    prompt: opts.prompt,
    options: {
      model: opts.model,
      systemPrompt: { type: "raw", text: opts.system },
      maxTurns: 1,
      tools: [],
      cwd: opts.cwd,
      maxOutputTokens: opts.maxOutputTokens,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  });

  let text = "";
  for await (const message of result) {
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === "text") {
          text += block.text;
        }
      }
    }
  }
  return text;
}
```

**Key changes to the interface:**
- Remove `apiKey` parameter — SDK handles auth
- Add `cwd` parameter — required by `query()`

> **Open question:** Does `query()` support `maxOutputTokens`, `maxTurns`, `tools: []`, and raw system prompts? Need to verify against SDK types before implementing. If `maxTurns` isn't available, we can use an AbortController to stop after the first response.

> **Open question:** Does `query()` work without a `cwd`? For naming, the working directory is irrelevant. If required, callers can pass `process.cwd()` or the thread's working directory.

> **Open question:** The sidecar currently also uses these naming functions. The sidecar is a separate Node process — does it have access to the Agent SDK? If not, we may need to move naming into the agent process and have the sidecar request naming via IPC. Check `sidecar/package.json` for SDK dependency.

## Phase 2: Migrate callers and remove API key threading

Update the function signatures to drop `apiKey`:

**`core/lib/naming/thread-name.ts`:**
- `generateThreadName(prompt, apiKey)` → `generateThreadName(prompt, cwd)`

**`core/lib/naming/worktree-name.ts`:**
- `generateWorktreeName(prompt, apiKey)` → `generateWorktreeName(prompt, cwd)`

**Callers to update:**

1. **`agents/src/runners/simple-runner-strategy.ts`** (lines ~563, ~619):
   - Remove `const apiKey = process.env.ANTHROPIC_API_KEY` guard
   - Pass `context.workingDir` instead of `apiKey`
   - Remove early return when no API key

2. **`agents/src/runners/shared.ts`** (line ~879):
   - Same pattern — drop API key, pass working dir

3. **`sidecar/src/hooks/naming.ts`** (line ~31):
   - This is the tricky one. The sidecar runs as a separate process.
   - **Option A:** If sidecar has the Agent SDK, just pass `cwd` instead of `apiKey`
   - **Option B:** If sidecar does NOT have the Agent SDK, move naming responsibility to the agent process. The sidecar would send a "please name this thread" event to the agent via hub, and the agent would do the naming and write to metadata.json.
   - **Option C:** Add the Agent SDK as a sidecar dependency (simplest if it works standalone)

## Phase 3: Remove Vercel AI dependencies

1. Remove from `core/lib/naming/llm-fallback.ts`:
   - `import { createAnthropic } from "@ai-sdk/anthropic"`
   - `import { generateText } from "ai"`

2. Remove from **root** `package.json`:
   - `"ai": "^5.0.108"`
   - `"@ai-sdk/anthropic": "^2.0.53"`

3. Remove from **agents** `package.json`:
   - `"ai": "^6.0.77"`
   - `"@ai-sdk/anthropic": "^3.0.38"`

4. Remove from **sidecar** `package.json`:
   - `"ai": "^6.0.77"`
   - `"@ai-sdk/anthropic": "^3.0.38"`

5. Run `pnpm install` to update lockfiles

6. Verify no other imports of `"ai"` or `"@ai-sdk"` remain: `grep -r "from [\"']ai" && grep -r "@ai-sdk"`

## Phase 4: Update tests

1. **`agents/src/testing/__tests__/worktree-naming.integration.test.ts`**:
   - Currently mocks `generateText` and `createAnthropic`
   - Update to mock `query` from `@anthropic-ai/claude-agent-sdk` instead
   - Or better: test against the real SDK (already have `describeWithApi` pattern)

2. **`agents/src/runners/__tests__/skip-naming.test.ts`**:
   - Mocks `thread-naming-service` and `worktree-naming-service`
   - Update assertions: no longer checking for API key, checking for `cwd` instead
   - Remove `process.env.ANTHROPIC_API_KEY` setup/teardown

3. Run full test suite: `cd agents && pnpm test` + `pnpm test`

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Agent SDK `query()` may not support minimal/toolless mode | Test with `tools: []` early. If it doesn't work, use the raw Anthropic SDK (`@anthropic-ai/sdk`) directly — it also supports OAuth tokens. |
| Sidecar can't use Agent SDK (different process, no Claude Code session) | Move naming to agent process, sidecar requests via IPC event |
| Naming latency increases (SDK overhead vs direct API) | Naming is fire-and-forget, latency doesn't block UX. Acceptable. |
| SDK `query()` spawns a subprocess | Need to verify — if so, consider using `@anthropic-ai/sdk` (the raw SDK, not agent SDK) directly with Messages API, which should also work with Claude Code login tokens |

## Alternative: Raw Anthropic SDK instead of Agent SDK

If `query()` is too heavyweight for simple completions (subprocess spawn, tool infrastructure), consider using `@anthropic-ai/sdk` directly:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // auto-discovers auth (API key or OAuth)
const response = await client.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 50,
  system: systemPrompt,
  messages: [{ role: "user", content: prompt }],
});
```

This is simpler and lighter. The raw SDK already supports OAuth/login tokens. However, need to verify it's already a dependency or if adding it is acceptable. Check if `@anthropic-ai/sdk` is in the dependency tree (it likely is, as a transitive dep of the Agent SDK).
