# Fix: User Message Disappears on Agent INIT

## Problem

When a user submits a message, the optimistic `APPEND_USER_MESSAGE` is briefly visible but then **disappears** when the agent emits `INIT` (which replaces the entire state). The message reappears moments later when the agent emits its own `APPEND_USER_MESSAGE`.

## Root Cause

Two issues:
1. The user message is excluded from `INIT` — there's a gap between `initState()` and `appendUserMessage()` in `shared.ts:440-441`
2. The frontend-generated `messageId` (`crypto.randomUUID()`) is never passed to the agent — the agent generates its own `nanoid()`, so the same logical message has two different IDs

## Fix

**Pass the frontend `messageId` through the full chain and include the user message in INIT.**

### 1. `RunnerConfig` — add `messageId` field

`agents/src/runners/types.ts`:
```typescript
/** Frontend-generated message ID for the user prompt (ensures ID consistency) */
messageId?: string;
```

### 2. `SimpleRunnerStrategy.parseArgs` — parse `--message-id`

`agents/src/runners/simple-runner-strategy.ts:204-242`, add case:
```typescript
case "--message-id":
  config.messageId = args[++i];
  break;
```

### 3. `shared.ts:runAgentLoop` — include user message in INIT with the frontend's ID

`agents/src/runners/shared.ts:438-441`:
```typescript
// Before:
await initState(..., priorMessages, ...);
await appendUserMessage(config.prompt);

// After:
const userMessage: StoredMessage = {
  role: "user",
  content: config.prompt,
  id: config.messageId ?? crypto.randomUUID(),
};
await initState(..., [...priorMessages, userMessage], ...);
```

### 4. Frontend spawn/resume — pass `messageId` through CLI args

**`SpawnSimpleAgentOptions`** (`src/lib/agent-service.ts:540`):
```typescript
messageId?: string;
```

**`spawnSimpleAgent`** (`src/lib/agent-service.ts:729-739`): add to commandArgs:
```typescript
...(parsed.messageId ? ["--message-id", parsed.messageId] : []),
```

**`resumeSimpleAgent`** (`src/lib/agent-service.ts:858`): add `messageId` param and pass through:
```typescript
export async function resumeSimpleAgent(threadId: string, prompt: string, sourcePath: string, messageId?: string)
// ... in commandArgs:
...(messageId ? ["--message-id", messageId] : []),
```

### 5. Frontend call sites — pass `messageId`

**`thread-content.tsx:326-335`**: pass messageId to spawn/resume:
```typescript
await spawnSimpleAgent({ ..., messageId });
// or
await resumeSimpleAgent(threadId, userPrompt, workingDirectory, messageId);
```

**`control-panel-window.tsx`** and **`floating-address-button.tsx`**: check if they call spawn/resume — these may not have a messageId (that's fine, the agent falls back to `crypto.randomUUID()`).

### 6. `SpawnOptionsSchema` validation — add messageId

`src/lib/agent-service.ts:615-623`: add to schema:
```typescript
messageId: z.string().uuid("messageId must be a valid UUID").optional(),
```

## Key Files

| File | Change |
|------|--------|
| `agents/src/runners/types.ts` | Add `messageId` to `RunnerConfig` |
| `agents/src/runners/simple-runner-strategy.ts` | Parse `--message-id` CLI arg |
| `agents/src/runners/shared.ts:438-441` | Merge user message into INIT, use frontend ID |
| `src/lib/agent-service.ts` | Add `messageId` to options/schema, pass as CLI arg |
| `src/components/content-pane/thread-content.tsx` | Pass `messageId` to spawn/resume calls |

## Phases

- [x] Thread the frontend `messageId` through: types → CLI parsing → spawn/resume → runner config
- [x] Include user message in INIT payload using the frontend's ID (remove separate `appendUserMessage`)
- [x] Verify other spawn call sites (control-panel, floating-address-button) work without messageId

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
