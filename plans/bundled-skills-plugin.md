# Bundled Skills Plugin Implementation Plan

Create a Claude Agent SDK plugin that provides skills from a bundled directory in the Mort application, following Anthropic's official conventions.

## Background

The Claude Agent SDK supports loading plugins via the `plugins` option in `query()`. Plugins can include skills, agents, hooks, and MCP servers. This plan outlines creating a **bundled plugin** that ships with the Mort application, allowing us to:

1. Bundle skills with the application source code
2. Update skills with new application deployments
3. Follow Anthropic's official plugin conventions
4. Maintain our existing custom skills infrastructure alongside SDK-native skills

## Current State

- **Existing Skills System**: Custom `SkillsService` with discovery from 5 locations (`project`, `project_command`, `mort`, `personal`, `personal_command`)
- **SDK Version**: `@anthropic-ai/claude-agent-sdk@^0.2.37`
- **Agent Runner**: Located at `/agents/src/runners/shared.ts`, uses SDK's `query()` function
- **Existing Skill Locations**:
  - `<repo>/.claude/skills/` (project)
  - `<repo>/.claude/commands/` (project_command)
  - `~/.mort/skills/` (mort - our custom location)
  - `~/.claude/skills/` (personal)
  - `~/.claude/commands/` (personal_command)

## Phases

- [ ] Create plugin directory structure in source
- [ ] Create plugin manifest file
- [ ] Migrate/add bundled skills
- [ ] Update agent runner to load plugin
- [ ] Update build pipeline to include plugin
- [ ] Test plugin loading and skill invocation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture Decision

### Option A: SDK-Native Plugin (Recommended)
Use the Claude Agent SDK's official plugin system to load skills bundled with the application.

**Pros:**
- Follows Anthropic conventions exactly
- Skills are automatically namespaced (`mort:skill-name`)
- Automatic discovery by the SDK
- Future-proof as SDK evolves
- Compatible with `settingSources` and other SDK features

**Cons:**
- Skills will have `mort:` prefix (namespaced)
- Need to ensure plugin path is accessible at runtime

### Option B: Hybrid Approach
Keep existing `~/.mort/skills/` location but populate it during app install/update.

**Pros:**
- No changes to existing skills invocation
- Works with current `SkillsService`

**Cons:**
- Requires filesystem writes during deployment
- Not following SDK conventions
- Potential permission issues

**Decision: Option A** - Use SDK-native plugin system for bundled skills

---

## Implementation Details

### Phase 1: Create Plugin Directory Structure

Create a plugin at `agents/bundled-plugin/`:

```
agents/bundled-plugin/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── skills/                   # Bundled skills
│   ├── commit/
│   │   └── SKILL.md
│   ├── review-pr/
│   │   └── SKILL.md
│   └── ...
└── agents/                   # Optional: bundled agents
    └── ...
```

### Phase 2: Create Plugin Manifest

Create `agents/bundled-plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "mort",
  "description": "Bundled skills and agents for the Mort application",
  "version": "1.0.0",
  "author": {
    "name": "Mort Team"
  }
}
```

**Key points:**
- Plugin name `mort` means skills are invoked as `/mort:skill-name`
- Version should align with app version or use independent versioning
- Skills in `skills/` directory are auto-discovered

### Phase 3: Create Bundled Skills

Each skill follows the `SKILL.md` format with YAML frontmatter:

```markdown
---
name: commit
description: Create a well-formatted git commit with conventional commit messages
---

When creating commits:
1. Stage only relevant changes
2. Write clear, conventional commit messages
3. Follow the project's commit conventions
...
```

**Skill frontmatter fields:**
- `name`: Display name (optional, defaults to folder name)
- `description`: When Claude should invoke this skill (required for model invocation)
- `disable-model-invocation`: If `true`, only user can invoke (default: `false`)
- `user-invocable`: If `false`, only model can invoke (default: `true`)
- `allowed-tools`: Restrict which tools the skill can use (not supported in SDK, only CLI)
- `argument-hint`: Hint shown to user for expected arguments

### Phase 4: Update Agent Runner

Modify `/agents/src/runners/shared.ts` to load the bundled plugin:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as path from "path";

// Resolve bundled plugin path relative to agent package
const bundledPluginPath = path.resolve(__dirname, "../bundled-plugin");

for await (const message of query({
  prompt: userMessage,
  options: {
    plugins: [
      { type: "local", path: bundledPluginPath }
    ],
    // Existing options...
    settingSources: ["user", "project"], // Enable filesystem skills too
    allowedTools: ["Skill", ...otherTools], // Enable Skill tool
  }
})) {
  // Handle messages...
}
```

**Considerations:**
- Path resolution at build time vs runtime
- Include `"Skill"` in `allowedTools` to enable skill invocation
- `settingSources` enables loading skills from standard locations too

### Phase 5: Update Build Pipeline

Update `agents/tsup.config.ts` or build configuration to:

1. Copy `bundled-plugin/` to dist directory
2. Ensure `SKILL.md` files are included
3. Preserve directory structure

**Option A: Copy during build (tsup)**
```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';
import { copySync } from 'fs-extra';

export default defineConfig({
  // ... existing config
  onSuccess: async () => {
    copySync('./bundled-plugin', './dist/bundled-plugin');
  }
});
```

**Option B: Include in package.json files field**
```json
{
  "files": [
    "dist",
    "bundled-plugin"
  ]
}
```

### Phase 6: Testing

1. **Unit tests**: Verify plugin structure is valid
2. **Integration tests**: Verify skills load correctly
3. **Manual testing**: Invoke skills via `/mort:skill-name`

Test that:
- Plugin appears in init message
- Skills are discoverable (`"What skills are available?"`)
- Skills execute correctly when invoked
- Skills work alongside existing custom skills system

---

## Migration Strategy

### Immediate: Bundled Skills
Create new bundled skills for common operations:
- `/mort:commit` - Create commits
- `/mort:review-pr` - Review pull requests
- `/mort:plan` - Create implementation plans

### Future: Consolidation
Consider migrating existing `~/.mort/skills/` usage to the bundled plugin system, or keep both for user customization.

---

## File Changes Summary

| File | Change |
|------|--------|
| `agents/bundled-plugin/.claude-plugin/plugin.json` | New: Plugin manifest |
| `agents/bundled-plugin/skills/*/SKILL.md` | New: Bundled skill definitions |
| `agents/src/runners/shared.ts` | Modify: Add plugin loading |
| `agents/tsup.config.ts` or build config | Modify: Copy plugin to dist |
| `agents/package.json` | Possibly modify: Add `files` field |

---

## Alternative Considerations

### Loading Multiple Plugins
The SDK supports loading multiple plugins:
```typescript
plugins: [
  { type: "local", path: bundledPluginPath },
  { type: "local", path: userCustomPluginPath }
]
```

### Dynamic Plugin Path
If the plugin path needs to be configurable:
```typescript
const pluginPath = process.env.MORT_BUNDLED_PLUGIN_PATH ||
  path.resolve(__dirname, "../bundled-plugin");
```

### CLI-Installed Plugins
Users can also install plugins via CLI that the SDK will recognize:
- Check `~/.claude/plugins/` for CLI-installed plugins

---

## References

- [Agent Skills in the SDK](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Plugins in the SDK](https://platform.claude.com/docs/en/agent-sdk/plugins)
- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
