# Managed Skills Implementation Plan

Write Mort-provided skills to the `~/.mort` directory at runtime, allowing easy updates while preserving user-defined skills.

## Background

The Claude Agent SDK supports loading skills from various locations including plugins. This plan outlines a **managed skills** approach where:

1. Mort-provided skills are stored in `plugins/mort/skills/` in the repo
2. Skills are synced to `~/.mort/skills/` on **app startup** and via an explicit **re-sync button** in settings
3. User-defined skills in `~/.mort/skills/` are preserved
4. A plugin at `~/.mort/` is passed to the SDK via the `plugins` option
5. Skills are invoked as `/mort:skill-name` (namespaced by plugin)

## Phases

- [x] Create Mort plugin structure at `plugins/mort/`
- [x] Bundle plugin in Tauri resources and add path resolution
- [x] Create skill sync service (frontend-side, uses Tauri FS)
- [x] Wire sync into app startup (`hydrateEntities`) + settings re-sync button
- [x] Pass plugin reference to SDK `query()` in agent runner
- [x] Ensure `~/.mort/skills/` is detected for `/` invocation
- [x] Create initial managed skills
- [ ] Test skill sync and invocation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Official Anthropic Plugin Reference

### Plugin Structure

From [Anthropic Plugin Documentation](https://code.claude.com/docs/en/plugins):

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json              # Required: plugin manifest
├── commands/                     # Custom slash commands (Markdown files)
│   └── custom-cmd.md
├── agents/                       # Custom agent definitions
│   └── specialist.md
├── skills/                       # Agent Skills (directories with SKILL.md)
│   └── my-skill/
│       └── SKILL.md
├── hooks/                        # Event handlers
│   └── hooks.json
├── .mcp.json                    # MCP server configurations
└── README.md                    # Plugin documentation
```

**Critical:** Only `plugin.json` goes in `.claude-plugin/`. All other directories (commands/, skills/, etc.) must be at the plugin root level.

### Plugin Manifest (`plugin.json`)

```json
{
  "name": "mort",
  "description": "Mort's built-in skills for code assistance",
  "version": "1.0.0",
  "author": {
    "name": "Mort"
  }
}
```

**Fields:**
- `name` (required): Unique identifier and skill namespace (skills invoked as `/mort:skill-name`)
- `description` (required): Shown in plugin manager
- `version` (required): Semantic versioning

### Passing Plugins to `query()`

From [Anthropic SDK Documentation](https://platform.claude.com/docs/en/agent-sdk/plugins):

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: "Help me commit my changes",
  options: {
    plugins: [
      { type: "local", path: "/path/to/plugin" }
    ],
    // ... other options
  }
});
```

**Plugin Config Type:**
```typescript
type SdkPluginConfig = {
  type: 'local';           // Only 'local' is currently supported
  path: string;            // Absolute or relative path to plugin directory
}
```

### SKILL.md Frontmatter Reference

```yaml
---
name: commit                      # Display name (optional, defaults to folder name)
description: Create git commits   # When Claude should invoke (recommended)
disable-model-invocation: false   # Prevent Claude from auto-invoking (optional)
user-invocable: true              # Show in menu (optional, default: true)
allowed-tools: Read, Grep, Bash   # Restrict available tools (optional)
argument-hint: "[message]"        # Autocomplete hint (optional)
---

Skill instructions in markdown...
```

**String Substitutions:**
- `$ARGUMENTS` - All arguments passed when invoking
- `$ARGUMENTS[N]` or `$N` - Specific argument by index

---

## Implementation Details

### Phase 1: Create Mort Plugin Structure

Create the source plugin at `plugins/mort/`:

```
plugins/mort/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    ├── commit/
    │   └── SKILL.md
    ├── review-pr/
    │   └── SKILL.md
    └── plan/
        └── SKILL.md
```

**plugins/mort/.claude-plugin/plugin.json:**
```json
{
  "name": "mort",
  "description": "Mort's built-in skills for code assistance",
  "version": "1.0.0",
  "author": {
    "name": "Mort"
  }
}
```

This is the "source of truth" that gets synced to `~/.mort/`.

### Phase 2: Bundle Plugin in Tauri Resources + Path Resolution

The plugin source files must be available at runtime in both dev and production. Follow the established pattern from `src/lib/paths.ts` and `src/lib/agent-service.ts`.

**Add to `src-tauri/tauri.conf.json` resources:**
```json
"resources": [
  // ... existing resources ...
  "../plugins/mort/.claude-plugin/plugin.json",
  "../plugins/mort/skills/**/*"
]
```

**Add to `src/lib/paths.ts`:**
```typescript
/**
 * Gets the path to the bundled Mort plugin source directory.
 * In dev: points at the repo's plugins/mort/ directly.
 * In production: resolves from Tauri's bundled resources.
 */
export async function getBundledPluginPath(): Promise<string> {
  const isDev = import.meta.env.DEV;

  if (isDev) {
    return `${__PROJECT_ROOT__}/plugins/mort`;
  }

  // Production: resolve from bundled resources
  // resolveResource returns a path under the app's Resources directory.
  // The _up_ prefix navigates from src-tauri to the project root (Tauri convention).
  const pluginJsonPath = await resolveResource('_up_/plugins/mort/.claude-plugin/plugin.json');
  // Walk up from .claude-plugin/plugin.json to get the plugin root
  return await dirname(await dirname(pluginJsonPath));
}
```

**Why this works:** This mirrors the exact pattern used for `getRunnerPath()`, `getQuickActionsTemplatePath()`, and `getAgentPaths()` — all use `__PROJECT_ROOT__` in dev, `resolveResource('_up_/...')` in prod. No `__dirname` shenanigans in the agents layer.

### Phase 3: Create Skill Sync Service (Frontend-Side)

The sync runs on the **frontend** (Tauri webview), not the agent process. This avoids the `__dirname` pathing issue entirely — the frontend already has robust dev/prod path resolution.

**Location:** `src/lib/skill-sync.ts`

```typescript
import { getBundledPluginPath, getMortDir } from './paths';
import { FilesystemClient } from './filesystem-client';
import { logger } from './logger-client';

const fs = new FilesystemClient();

/**
 * Sync managed skills from the bundled plugin to ~/.mort.
 *
 * - Copies .claude-plugin/plugin.json (always overwrites)
 * - Copies skills/* (overwrites existing managed skills, preserves user-created)
 * - Idempotent — safe to call on every startup
 */
export async function syncManagedSkills(): Promise<void> {
  const pluginSourcePath = await getBundledPluginPath();
  const mortDir = await getMortDir();

  // 1. Sync .claude-plugin/plugin.json
  const srcPluginJson = `${pluginSourcePath}/.claude-plugin/plugin.json`;
  const dstPluginJson = `${mortDir}/.claude-plugin/plugin.json`;
  await fs.ensureDir(`${mortDir}/.claude-plugin`);
  await fs.copyFile(srcPluginJson, dstPluginJson);

  // 2. Sync skills directory
  const srcSkillsDir = `${pluginSourcePath}/skills`;
  const dstSkillsDir = `${mortDir}/skills`;
  await fs.ensureDir(dstSkillsDir);

  // Read source skill directories and copy each one
  const sourceSkills = await fs.readDir(srcSkillsDir);
  for (const entry of sourceSkills) {
    if (entry.isDirectory) {
      await copySkillDirectory(
        `${srcSkillsDir}/${entry.name}`,
        `${dstSkillsDir}/${entry.name}`
      );
    }
  }

  logger.log(`[skill-sync] Synced managed skills to ${mortDir}`);
}

async function copySkillDirectory(src: string, dst: string): Promise<void> {
  await fs.ensureDir(dst);
  const entries = await fs.readDir(src);
  for (const entry of entries) {
    if (entry.isDirectory) {
      await copySkillDirectory(`${src}/${entry.name}`, `${dst}/${entry.name}`);
    } else {
      await fs.copyFile(`${src}/${entry.name}`, `${dst}/${entry.name}`);
    }
  }
}
```

**Key design choices:**
- Uses `FilesystemClient` (Tauri FS adapter) — same as the rest of the frontend
- Path resolution uses `getBundledPluginPath()` — works in dev and prod
- No Node.js `fs` module, no `__dirname` — all Tauri APIs

### Phase 4: Wire Into App Startup + Settings Re-Sync Button

**On startup — `src/entities/index.ts` `hydrateEntities()`:**

```typescript
import { syncManagedSkills } from '@/lib/skill-sync';

export async function hydrateEntities(): Promise<void> {
  // ... existing hydration ...

  // Sync managed skills from bundled plugin to ~/.mort
  // This only copies a handful of small .md files — fast and idempotent
  await syncManagedSkills();
  logger.log("[entities:hydrate] Managed skills synced");

  // ... rest of hydration ...
}
```

This fires once on app launch — not per agent invocation. Skill files only change when the app itself is updated, so startup sync is the right cadence.

**Re-sync button — `src/components/main-window/settings/skills-settings.tsx`:**

Add a "Re-sync built-in skills" button next to the existing skills list:

```tsx
import { syncManagedSkills } from '@/lib/skill-sync';

// In the component:
const [isSyncing, setIsSyncing] = useState(false);

const handleResync = async () => {
  setIsSyncing(true);
  try {
    await syncManagedSkills();
    // Re-discover to refresh the UI
    const homeDir = await fsCommands.getHomeDir();
    const discoveredSkills = await skillsService.discover(repoPath, homeDir);
    // ... hydrate store
  } finally {
    setIsSyncing(false);
  }
};

// Render button:
<button onClick={handleResync} disabled={isSyncing}>
  {isSyncing ? 'Syncing...' : 'Re-sync built-in skills'}
</button>
```

### Phase 5: Pass Plugin Reference to SDK `query()`

Update `agents/src/runners/shared.ts` to pass the plugin. The agent runner already receives `config.mortDir` (`~/.mort`), which is the plugin root after sync.

```typescript
// In query() call — agents/src/runners/shared.ts
const result = query({
  prompt,
  options: {
    plugins: [
      { type: "local", path: config.mortDir }  // ~/.mort is now a valid plugin root
    ],
    cwd: context.workingDir,
    additionalDirectories: [config.mortDir],
    // ... rest of options unchanged
  }
});
```

**No sync happens here.** The agent process trusts that the frontend already synced skills on startup. `config.mortDir` is already an absolute path passed from the Tauri process, so no path resolution needed.

### Phase 6: Ensure Skill Detection on `/` Invocation

The current `SkillsService` in `core/lib/skills/skills-service.ts` already discovers skills from:

```typescript
{ getPath: (_, home) => `${home}/.mort/skills`, source: 'mort', isLegacy: false },
```

This means skills in `~/.mort/skills/` are already detected for the UI skill picker. However, the SDK will also load them via the plugin mechanism.

**Skill invocation paths:**
1. **User invokes via UI (`/commit`)**: SkillsService finds skill, passes to SDK
2. **SDK plugin invocation (`/mort:commit`)**: SDK loads from plugin directly
3. **Model-initiated**: SDK uses skill descriptions to invoke appropriate skills

Both paths should work. The SkillsService provides UI autocomplete, while the SDK plugin provides runtime execution.

### Phase 7: Create Initial Managed Skills

**plugins/mort/skills/commit/SKILL.md:**
```yaml
---
name: commit
description: Create a well-formatted git commit with conventional commit messages
argument-hint: "[message]"
---

When creating commits:
1. Stage only relevant changes (use `git add -p` for partial staging if needed)
2. Write clear, conventional commit messages following the format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `refactor:` for code refactoring
   - `test:` for test additions/changes
   - `chore:` for maintenance tasks

3. If $ARGUMENTS is provided, use it as the commit message
4. Otherwise, analyze staged changes and generate an appropriate message
5. Always show the user the proposed commit before executing
```

**plugins/mort/skills/review-pr/SKILL.md:**
```yaml
---
name: review-pr
description: Review a pull request for code quality, bugs, and best practices
argument-hint: "[PR number or URL]"
---

When reviewing PRs:
1. Fetch PR details using `gh pr view $ARGUMENTS`
2. Analyze the diff for:
   - Code quality issues
   - Potential bugs
   - Security concerns
   - Performance implications
   - Test coverage
3. Provide constructive feedback with specific line references
4. Summarize overall assessment (approve, request changes, or comment)
```

**plugins/mort/skills/plan/SKILL.md:**
```yaml
---
name: plan
description: Create an implementation plan for a feature or task
argument-hint: "[task description]"
---

When creating plans:
1. Analyze the task requirements from $ARGUMENTS
2. Research the existing codebase to understand:
   - Relevant files and modules
   - Existing patterns and conventions
   - Dependencies and integrations
3. Create a plan file in `plans/` directory with:
   - Clear objective
   - Phased implementation steps
   - Key files to modify
   - Testing strategy
4. Use the standard plan format with phase checkboxes
```

### Phase 8: Testing

**Test scenarios:**

1. **Fresh install**:
   - Delete `~/.mort/skills/` and `~/.mort/.claude-plugin/`
   - Start app
   - Verify `~/.mort/.claude-plugin/plugin.json` exists
   - Verify `~/.mort/skills/{commit,review-pr,plan}/SKILL.md` exist

2. **Update scenario**:
   - Modify `plugins/mort/skills/commit/SKILL.md`
   - Restart app
   - Verify changes synced to `~/.mort/skills/commit/SKILL.md`

3. **User skill preservation**:
   - Create `~/.mort/skills/my-custom/SKILL.md`
   - Restart app
   - Verify custom skill still exists

4. **Skill invocation**:
   - Type `/` in UI, verify skills appear in autocomplete
   - Invoke `/commit`, verify skill executes
   - Verify SDK receives plugin via `plugins` option

5. **Production build**:
   - Build with `cargo tauri build`
   - Verify `plugins/mort/` files are in the `.app` bundle resources
   - Verify `getBundledPluginPath()` resolves correctly
   - Verify sync works from bundled resources

---

## Pathing Strategy

This is the critical piece. The codebase has an established pattern for dev vs. prod path resolution, and we follow it exactly.

### Dev Mode

`import.meta.env.DEV === true`

All paths point directly at the source tree via `__PROJECT_ROOT__` (injected by Vite as `process.cwd()` at build time):

```
__PROJECT_ROOT__/plugins/mort/          ← getBundledPluginPath()
__PROJECT_ROOT__/agents/dist/runner.js  ← getAgentPaths()  (existing)
__PROJECT_ROOT__/core/sdk/template      ← getQuickActionsTemplatePath()  (existing)
```

### Production Mode

`import.meta.env.DEV === false`

Tauri bundles files listed in `tauri.conf.json` → `bundle.resources` into the app's `Resources/` directory. The `resolveResource('_up_/...')` API resolves paths relative to `src-tauri/`, where `_up_` navigates to the project root.

```
App.app/Contents/Resources/
├── _up_/
│   ├── plugins/mort/.claude-plugin/plugin.json   ← NEW
│   ├── plugins/mort/skills/commit/SKILL.md       ← NEW
│   ├── plugins/mort/skills/review-pr/SKILL.md    ← NEW
│   ├── plugins/mort/skills/plan/SKILL.md         ← NEW
│   ├── agents/dist/runner.js                     ← existing
│   ├── agents/node_modules/...                   ← existing
│   └── ...
```

### Agent Process (No Path Resolution Needed)

The agent process (`agents/`) receives `config.mortDir` as an absolute path from the Tauri process. It never needs to resolve bundled resource paths — it just passes `config.mortDir` to the SDK as a plugin path:

```typescript
plugins: [{ type: "local", path: config.mortDir }]  // e.g. /Users/zac/.mort
```

This completely avoids the `__dirname` issue in the original plan. The agent process doesn't know or care where the skills came from — it just points the SDK at `~/.mort`.

---

## File Changes Summary

| File | Change |
|------|--------|
| `plugins/mort/.claude-plugin/plugin.json` | New: Plugin manifest |
| `plugins/mort/skills/*/SKILL.md` | New: Managed skill definitions |
| `src-tauri/tauri.conf.json` | Modify: Add plugin resources to bundle |
| `src/lib/paths.ts` | Modify: Add `getBundledPluginPath()` |
| `src/lib/skill-sync.ts` | New: Skill sync service (frontend) |
| `src/entities/index.ts` | Modify: Call `syncManagedSkills()` in hydration |
| `src/components/main-window/settings/skills-settings.tsx` | Modify: Add re-sync button |
| `agents/src/runners/shared.ts` | Modify: Pass `plugins` to SDK `query()` |
| `~/.mort/` | Runtime: Synced plugin with skills |

---

## Architecture Summary

```
Source (repo)                    Bundle (prod)                      Destination (runtime)
─────────────                    ─────────────                      ────────────────────
plugins/mort/                    App.app/Resources/_up_/            ~/.mort/
├── .claude-plugin/       ──►    plugins/mort/.claude-plugin/ ──►   ├── .claude-plugin/
│   └── plugin.json              │   └── plugin.json               │   └── plugin.json
└── skills/               ──►    plugins/mort/skills/        ──►   └── skills/
    ├── commit/                      ├── commit/                       ├── commit/
    ├── review-pr/                   ├── review-pr/                    ├── review-pr/
    ├── plan/                        ├── plan/                         ├── plan/
    └── ...                          └── ...                           └── <user skills preserved>

         Dev: __PROJECT_ROOT__/plugins/mort
         Prod: resolveResource('_up_/plugins/mort/...')
```

**Sync trigger:** App startup (in `hydrateEntities()`) + manual re-sync button in settings.

**SDK receives:**
```typescript
plugins: [{ type: "local", path: "/Users/zac/.mort" }]
```

**SkillsService discovers from:**
```typescript
`${home}/.mort/skills`  // source: 'mort'
```

Both mechanisms work together:
- Plugin provides namespaced invocation (`/mort:commit`)
- SkillsService provides UI autocomplete and discovery

---

## References

- [Anthropic SDK Plugins](https://platform.claude.com/docs/en/agent-sdk/plugins)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
