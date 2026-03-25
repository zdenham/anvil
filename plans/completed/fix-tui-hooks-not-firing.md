# Fix TUI Hooks Not Firing

## Problem

User messages sent via TUI threads aren't captured, and no hooks fire. The sidecar is running and its hook endpoints respond correctly when called directly (verified with manual curl), but Claude CLI never calls them.

## Root Cause (confirmed via spike)

**hooks.json schema mismatch.** Claude CLI expects hooks.json to have a top-level wrapper:

```json
{ "hooks": { "UserPromptSubmit": [...], ... } }
```

But `hooks-writer.ts` writes the events directly at the top level:

```json
{ "UserPromptSubmit": [...], ... }
```

This causes a Zod validation error during plugin loading:

```
"expected": "record", "code": "invalid_type", "path": ["hooks"],
"message": "Invalid input: expected record, received undefined"
```

The plugin itself loads (`plugin validate` passes), but hooks silently fail to register. Visible only with `--debug-file`.

### Additional finding: CLI version

- `conductor/cc/claude` was v2.0.54 (Dec 2024) — very stale
- Installed v2.1.81 globally via npm — hooks work on both versions with correct format
- Consider updating the bundled binary path or using the npm-installed one

## Spike Evidence

```bash
# With WRONG format (current): "Failed to load hooks" in debug log
# With CORRECT format (wrapped): hooks fire, sidecar receives calls
ANVIL_THREAD_ID=spike-http-test claude --plugin-dir /tmp/hook-test-plugin -p "say pong"
# Sidecar log: "[hooks] user-prompt-submit for thread spike-http-test (13 chars)"
```

Debug flag that reveals the error: `--debug-file /tmp/debug.log` then grep for "hook".

## Phases

- [x] Spike: verify Claude CLI plugin loading and hook discovery with `--debug-file`

- [x] Fix `hooks-writer.ts`: wrap output in `{ "hooks": { ... } }`

- [x] Verify: restart sidecar, create a TUI thread, send a message, confirm hooks fire and state.json is populated

- [ ] Update bundled Claude CLI path (conductor/cc/claude is v2.0.54, npm global is v2.1.81)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## The Fix

In `sidecar/src/hooks/hooks-writer.ts`, change `writeHooksJson` to wrap the config:

```typescript
// Before (broken):
writeFileSync(join(hooksDir, "hooks.json"), JSON.stringify(config, null, 2) + "\n");

// After (correct):
writeFileSync(join(hooksDir, "hooks.json"), JSON.stringify({ hooks: config }, null, 2) + "\n");
```

That's it — one line change.

## Key Files

| File | Role |
| --- | --- |
| `sidecar/src/hooks/hooks-writer.ts` | Writes hooks.json — **needs the fix** |
| `src/lib/claude-tui-args-builder.ts` | Builds `--plugin-dir` arg for Claude CLI |
| `sidecar/src/hooks/hook-handler.ts` | Express router handling hook HTTP requests |

## Debug Commands

```bash
# Test hooks with debug output
ANVIL_THREAD_ID=test-123 claude --plugin-dir ~/.anvil-dev --debug-file /tmp/debug.log -p "hi"
grep -i hook /tmp/debug.log

# Check if sidecar responds
curl -X POST http://localhost:9604/hooks/user-prompt-submit \
  -H "Content-Type: application/json" \
  -H "X-Anvil-Thread-Id: test-123" \
  -d '{"prompt": "hello"}'
```