# Managed Skills Implementation Plan

Write Mort-provided skills to the `~/.mort` directory at runtime, allowing easy updates while preserving user-defined skills.

## Background

The Claude Agent SDK supports loading skills from various locations including plugins. This plan outlines a **managed skills** approach where:

1. Mort-provided skills are stored in `plugins/mort/skills/` in the repo
2. Skills are synced to `~/.mort/skills/` on app startup (idempotent)
3. User-defined skills in `~/.mort/skills/` are preserved
4. A plugin at `~/.mort/` is passed to the SDK via the `plugins` option
5. Skills are invoked as `/mort:skill-name` (namespaced by plugin)

## Phases

- [ ] Create Mort plugin structure at `plugins/mort/`
- [ ] Create skill sync service to copy skills to `~/.mort/` on startup
- [ ] Pass plugin reference to SDK `query()` in agent runner
- [ ] Ensure `~/.mort/skills/` is detected for `/` invocation
- [ ] Create initial managed skills
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

### Phase 2: Create Skill Sync Service

Create a service that syncs the plugin to the user's `.mort` directory:

**Location:** `agents/src/services/skill-sync.ts`

```typescript
import * as fs from "fs/promises";
import * as path from "path";
import { existsSync } from "fs";

const PLUGIN_SOURCE = path.join(__dirname, "../../..", "plugins", "mort");
const MORT_DIR = path.join(os.homedir(), ".mort");

/**
 * Sync managed skills from plugins/mort to ~/.mort
 * - Copies plugin.json (always overwrites)
 * - Copies skills/* (overwrites existing, preserves user-created)
 *
 * Idempotent - safe to call on every startup.
 */
export async function syncManagedSkills(): Promise<void> {
  // Ensure ~/.mort exists
  await fs.mkdir(MORT_DIR, { recursive: true });

  // Sync .claude-plugin directory
  const pluginJsonSrc = path.join(PLUGIN_SOURCE, ".claude-plugin", "plugin.json");
  const pluginJsonDst = path.join(MORT_DIR, ".claude-plugin", "plugin.json");
  await fs.mkdir(path.dirname(pluginJsonDst), { recursive: true });
  await fs.copyFile(pluginJsonSrc, pluginJsonDst);

  // Sync skills directory
  const skillsSrc = path.join(PLUGIN_SOURCE, "skills");
  const skillsDst = path.join(MORT_DIR, "skills");
  await fs.mkdir(skillsDst, { recursive: true });

  // Copy each skill directory from source
  const sourceSkills = await fs.readdir(skillsSrc, { withFileTypes: true });
  for (const entry of sourceSkills) {
    if (entry.isDirectory()) {
      await copySkillDirectory(
        path.join(skillsSrc, entry.name),
        path.join(skillsDst, entry.name)
      );
    }
  }

  console.log(`[skill-sync] Synced managed skills to ${MORT_DIR}`);
}

async function copySkillDirectory(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      await copySkillDirectory(srcPath, dstPath);
    } else {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}
```

**Key behaviors:**
- Creates `~/.mort/` if it doesn't exist
- Copies `plugin.json` to `~/.mort/.claude-plugin/plugin.json`
- Copies each skill directory from source to destination
- User-created skills (not in source) are preserved
- Managed skills are always overwritten with latest version

### Phase 3: Pass Plugin Reference to SDK `query()`

Update `agents/src/runners/shared.ts` to pass the plugin:

```typescript
import { syncManagedSkills } from "../services/skill-sync.js";

// At startup (before first query)
await syncManagedSkills();

// In query() call
const result = query({
  prompt,
  options: {
    plugins: [
      { type: "local", path: config.mortDir }  // ~/.mort is the plugin root
    ],
    cwd: context.workingDir,
    additionalDirectories: [config.mortDir],
    // ... rest of options
  }
});
```

**Note:** `config.mortDir` is already `~/.mort`, which is now both:
1. The plugin root (contains `.claude-plugin/plugin.json`)
2. The additional directory for skill discovery

### Phase 4: Ensure Skill Detection on `/` Invocation

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

### Phase 5: Create Initial Managed Skills

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

### Phase 6: Testing

**Test scenarios:**

1. **Fresh install**:
   - Delete `~/.mort/skills/`
   - Start app
   - Verify `~/.mort/.claude-plugin/plugin.json` exists
   - Verify `~/.mort/skills/{commit,review-pr,plan}/SKILL.md` exist

2. **Update scenario**:
   - Modify `plugins/mort/skills/commit/SKILL.md`
   - Start app
   - Verify changes synced to `~/.mort/skills/commit/SKILL.md`

3. **User skill preservation**:
   - Create `~/.mort/skills/my-custom/SKILL.md`
   - Start app
   - Verify custom skill still exists

4. **Skill invocation**:
   - Type `/` in UI, verify skills appear in autocomplete
   - Invoke `/commit`, verify skill executes
   - Verify SDK receives plugin via `plugins` option

---

## File Changes Summary

| File | Change |
|------|--------|
| `plugins/mort/.claude-plugin/plugin.json` | New: Plugin manifest |
| `plugins/mort/skills/*/SKILL.md` | New: Managed skill definitions |
| `agents/src/services/skill-sync.ts` | New: Skill sync service |
| `agents/src/runners/shared.ts` | Modify: Call sync, pass plugins to query() |
| `~/.mort/` | Runtime: Synced plugin with skills |

---

## Architecture Summary

```
Source (repo)                    Destination (runtime)
─────────────                    ────────────────────
plugins/mort/                    ~/.mort/
├── .claude-plugin/              ├── .claude-plugin/
│   └── plugin.json      ──►     │   └── plugin.json
└── skills/                      └── skills/
    ├── commit/          ──►         ├── commit/
    ├── review-pr/       ──►         ├── review-pr/
    ├── plan/            ──►         ├── plan/
    └── ...                          └── <user skills preserved>
```

**SDK receives:**
```typescript
plugins: [{ type: "local", path: "~/.mort" }]
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
