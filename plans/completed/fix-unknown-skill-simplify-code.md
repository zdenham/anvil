# Fix: "Unknown skill: simplify-code"

## Problem

When invoking `/simplify-code` from the UI, the agent logs:
```json
{ "result": "Unknown skill: simplify-code" }
```

The skill exists at both `~/.anvil/skills/simplify-code/SKILL.md` and `~/.anvil-dev/skills/simplify-code/SKILL.md`, with correct frontmatter and valid SKILL.md content. The plugin manifest at `~/.anvil-dev/.claude-plugin/plugin.json` is also correct.

## Diagnosis

This is the **same class of bug** as the previous `/commit` fix documented in `plans/completed/fix-command-skill-processing.md`. That fix was subsequently **removed** (see `plans/completed/remove-skill-injection.md`), relying entirely on the SDK's native plugin system.

### Two Independent Issues Found

#### Issue 1: SDK Plugin May Not Be Loading Skills Correctly

**The flow:**
1. `shared.ts:968` passes `plugins: [{ type: "local", path: config.anvilDir }]` to `query()`
2. The SDK translates this to `--plugin-dir <path>` when spawning the CLI child process
3. The CLI's `lY()` function discovers plugins from `--plugin-dir` paths
4. Plugin skills get loaded via `Y0A()` → `lU7()` with names like `anvil:simplify-code`
5. When user types `/simplify-code`, the SDK's `bb4()` function calls `hd("simplify-code", allCommands)`
6. `hd()` checks: `K.name === "simplify-code"` (false — name is `anvil:simplify-code`) OR `K.userFacingName() === "simplify-code"` (should be true from frontmatter `name: simplify-code`)

**The `hd` check should pass** because `userFacingName()` returns the frontmatter `name` field ("simplify-code"). But it's failing, which means one of:
- **The plugin isn't being loaded at all** — the SDK's `lY()` function might not find the plugin at `~/.anvil-dev` (e.g., it doesn't look at `--plugin-dir` paths, or the path resolution fails)
- **The skills loading from the plugin fails silently** — `Y0A()` catches errors and returns empty
- **The command list (`cZ`) is cached before plugins finish loading** — timing issue where the `bb4` slash parser runs before async plugin discovery completes

**Recommended debug step:** Add `DEBUG_CLAUDE_AGENT_SDK=1` as an env var when spawning the agent to see the SDK's internal debug output. This will show whether the plugin is being loaded and what commands are discovered.

#### Issue 2: Frontend SkillsService Hardcoded to `~/.anvil` (Not `~/.anvil-dev`)

The `SkillsService` in `core/lib/skills/skills-service.ts` line 18 has:
```typescript
{ getPath: (_, home) => `${home}/.anvil/skills`, source: 'anvil', isLegacy: false },
```

This always looks at `~/.anvil/skills`, never `~/.anvil-dev/skills`. In dev mode, the actual data directory is `~/.anvil-dev` (determined by `FilesystemClient.getDataDir()`). This is inconsistent:

- **Skill sync** (`src/lib/skill-sync.ts`) correctly syncs to `~/.anvil-dev/skills/` (via `getAnvilDir()` which returns the correct dev path)
- **But SkillsService** looks at `~/.anvil/skills` (hardcoded with `home` dir)

The skill files happen to exist at BOTH locations because some may have been manually placed or synced in a previous session. But this is fragile — any changes synced to `~/.anvil-dev/skills/` won't be seen by the SkillsService.

**This issue affects UI autocomplete/discovery only, not the SDK invocation.** But it's a correctness bug.

## Root Cause (Most Likely)

The SDK's plugin discovery (`lY()`) scans for plugins matching a specific directory structure. The `--plugin-dir` argument specifies an additional plugin search directory. However, the SDK's internal plugin loader may require:

1. The `.claude-plugin/plugin.json` to be **directly** inside the `--plugin-dir` path (i.e., `~/.anvil-dev/.claude-plugin/plugin.json`) — this IS the case, so it should work
2. **OR** the plugin loader may have a bug where it doesn't scan `--plugin-dir` as a direct plugin root, but rather as a directory CONTAINING plugin directories

If hypothesis 2 is correct, the SDK expects:
```
~/.anvil-dev/
└── anvil/              ← plugin dir
    ├── .claude-plugin/
    │   └── plugin.json
    └── skills/
        └── simplify-code/
```

But we have:
```
~/.anvil-dev/           ← passed as --plugin-dir, IS the plugin root
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── simplify-code/
```

## Phases

- [x] Add SDK debug logging to diagnose plugin loading
- [x] Fix SkillsService to use data dir instead of hardcoded `~/.anvil`
- [ ] Implement correct fix based on debug findings
- [ ] Test skill invocation end-to-end

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Recommended Fix Strategy

### Phase 1: Add Debug Logging

Add `DEBUG_CLAUDE_AGENT_SDK=1` to the agent spawn env vars temporarily to see what the SDK's internal plugin discovery outputs. This will show:
- Whether `--plugin-dir ~/.anvil-dev` is being parsed
- Whether the plugin at `~/.anvil-dev` is being found by `lY()`
- What skills are loaded from the plugin
- What the full commands list looks like when `hd` is called

**Location:** `src/lib/agent-service.ts` line ~696:
```typescript
const envVars = {
  ANTHROPIC_API_KEY: apiKey,
  NODE_PATH: nodeModulesPath,
  ANVIL_DATA_DIR: anvilDir,
  PATH: shellPath,
  DEBUG_CLAUDE_AGENT_SDK: "1",  // TEMPORARY: remove after diagnosis
};
```

### Phase 2: Fix SkillsService Hardcoded Path

In `core/lib/skills/skills-service.ts`, change the hardcoded `~/.anvil/skills` to accept the actual data directory:

**Option A (preferred):** Pass the anvil data directory as a parameter to `discover()`:
```typescript
async discover(repoPath: string, homeDir: string, anvilDataDir?: string): Promise<SkillMetadata[]> {
```

And use `anvilDataDir` in the SKILL_LOCATIONS config:
```typescript
{ getPath: (_, __, anvilDir) => anvilDir ? `${anvilDir}/skills` : `${home}/.anvil/skills`, source: 'anvil', isLegacy: false },
```

**Option B (simpler):** Make the skill handler pass the data dir when calling discover:
```typescript
// In skill-handler.ts
const anvilDir = await fs.getDataDir();
await skillsService.discover(context.rootPath, homeDir, anvilDir);
```

### Phase 3: Fix Based on Debug Findings

If the SDK's plugin discovery IS working but `hd` still fails → the issue is likely that `userFacingName()` isn't matching. In that case, re-introduce a lightweight version of the removed skill injection (just the message transformation, not the system prompt injection):

```typescript
// Before passing to SDK query():
// If prompt starts with /skill-name and we know it's a local plugin skill,
// transform to /anvil:skill-name so the SDK recognizes it
```

If the SDK's plugin discovery is NOT working → the issue is in how `--plugin-dir` is interpreted. The fix would be to restructure `~/.anvil-dev` so the plugin is in a subdirectory:
```
~/.anvil-dev/plugins/anvil/  ← pass this as plugin-dir
├── .claude-plugin/
│   └── plugin.json
└── skills/
```

Or pass `--plugin-dir ~/.anvil-dev` differently to match what the SDK expects.

---

## Files Involved

| File | Role |
|------|------|
| `agents/src/runners/shared.ts:968` | Passes `plugins` option to SDK `query()` |
| `core/lib/skills/skills-service.ts:18` | Hardcoded `~/.anvil/skills` path (Issue 2) |
| `src/lib/skill-sync.ts` | Syncs skills to correct data dir (working) |
| `src/lib/triggers/handlers/skill-handler.ts` | Calls `discover()` for UI autocomplete |
| `src/lib/agent-service.ts:696` | Agent spawn env vars (for debug logging) |
| `plans/completed/fix-command-skill-processing.md` | Previous fix for same error (removed) |
| `plans/completed/remove-skill-injection.md` | Documents removal of previous fix |

## Related Plans
- `plans/completed/fix-command-skill-processing.md` — same error class, previous fix
- `plans/completed/remove-skill-injection.md` — removed the previous fix
- `plans/bundled-skills-plugin.md` — original plugin implementation plan
