# Claude Code Skills Integration for Mort

## Overview

This document outlines how to integrate Claude Code skills and commands into mort, enabling users to define custom skills that extend agent capabilities.

## What Are Claude Code Skills?

Skills are modular, filesystem-based resources that extend Claude's capabilities. They follow the [Agent Skills open standard](https://agentskills.io) and package instructions, scripts, templates, and reference materials into organized directories.

**Key characteristics:**
- **Model-invoked**: Claude automatically uses them based on context
- **User-invoked**: Users can explicitly trigger them with `/skill-name`
- **Progressive disclosure**: Only metadata loads at startup; full content loads when triggered
- **Support bundled files**: Can include scripts, templates, examples, and reference documentation

### Skills vs Commands (Legacy)

| Feature | Skills | Commands (Legacy) |
|---------|--------|-------------------|
| Location | `.claude/skills/<name>/SKILL.md` | `.claude/commands/<name>.md` |
| Bundled files | Yes (full directory) | No (single file) |
| Model invocation | Configurable | Always available |
| Format | YAML frontmatter + Markdown | YAML frontmatter + Markdown |

Both create slash commands (e.g., `/review`). Skills are the modern, recommended approach.

---

## Directory Configuration

### Standard Skill Locations (Priority Order)

| Priority | Location | Path | Scope |
|----------|----------|------|-------|
| 1 | Enterprise | Managed settings | Organization-wide |
| 2 | Personal | `~/.claude/skills/<skill-name>/SKILL.md` | All user projects |
| 3 | Project | `.claude/skills/<skill-name>/SKILL.md` | Single project |
| 4 | Plugin | `<plugin>/skills/<skill-name>/SKILL.md` | Where plugin enabled |

### Command Locations

| Location | Path | Scope |
|----------|------|-------|
| Personal | `~/.claude/commands/` | All user projects |
| Project | `.claude/commands/` | Single project |

---

## SKILL.md Format

Every skill requires a `SKILL.md` file with YAML frontmatter + Markdown content:

```yaml
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
argument-hint: [optional-argument-hint]
disable-model-invocation: false  # Set true to prevent auto-invocation
user-invocable: true             # Set false to hide from / menu
allowed-tools: Read, Grep, Glob  # Tools Claude can use without permission
model: claude-sonnet-4-20250514  # Optional model override
---

# My Skill Name

Instructions for Claude to follow when this skill is invoked.

## Additional Resources

- For API details, see [reference.md](reference.md)
- For examples, see [examples/](examples/)
```

### Frontmatter Fields Reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name (defaults to directory name). Lowercase, hyphens, max 64 chars. |
| `description` | Recommended | What the skill does and when to use it. Max 1024 chars. Used for discovery. |
| `argument-hint` | No | Hint shown during autocomplete, e.g., `[issue-number]` |
| `disable-model-invocation` | No | `true` = user must invoke manually with `/name`. Default: `false` |
| `user-invocable` | No | `false` = hidden from `/` menu. For background knowledge. Default: `true` |
| `allowed-tools` | No | Tools Claude can use without asking permission |
| `model` | No | Model to use when skill is active |
| `context` | No | `fork` to run in a forked subagent context |
| `agent` | No | Subagent type when `context: fork` (`Explore`, `Plan`, `general-purpose`) |

### String Substitutions

| Variable | Description |
|----------|-------------|
| `$ARGUMENTS` | Arguments passed when invoking the skill |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `` !`command` `` | Dynamic context injection - shell command output |

---

## Integration Strategy for Mort

### Current State

Mort already uses the Claude Agent SDK with the `claude_code` preset:

```typescript
// agents/src/agent-types/simple.ts
export const simple: AgentConfig = {
  name: "simple",
  tools: { type: "preset", preset: "claude_code" },
  // ...
};
```

The SDK **already supports skills** when configured correctly.

### Implementation Approach

**Option 1: SDK-Native Integration (Recommended)**

The Claude Agent SDK (currently using `^0.1.0`) automatically loads skills when `settingSources` is configured:

```typescript
// agents/src/runners/shared.ts - modify the query() call (around line 512)
query({
  prompt,
  options: {
    cwd: context.workingDir,
    settingSources: ["user", "project"],  // <-- Enable skill loading
    // ... existing options
  }
})
```

This approach:
- ✅ Zero custom code for skill discovery/parsing
- ✅ Automatic skill metadata loading
- ✅ Claude handles `/skill` invocation natively
- ✅ Skills appear in system prompt automatically
- ✅ Follows the standard exactly

**Note**: The `Skill` tool is already included with the `claude_code` preset, so no additional tool configuration is needed.

**Option 2: Custom Skill Loading**

If we need more control (e.g., mort-specific skill locations):

1. **Skill Discovery** - Scan directories for `SKILL.md` files:
   ```typescript
   const skillPaths = [
     path.join(os.homedir(), '.claude/skills'),
     path.join(repoPath, '.claude/skills'),
   ];
   ```

2. **Parse SKILL.md** - Extract frontmatter and content:
   ```typescript
   import matter from 'gray-matter';
   const { data: frontmatter, content } = matter(skillMd);
   ```

3. **Inject into System Prompt** - Add skill descriptions to agent context

4. **Handle Invocation** - Detect `/skill-name` in user input, load full skill content

### Recommended Implementation Steps

#### Phase 1: Enable SDK-Native Skills (Minimal Effort)

1. **Modify `agents/src/runners/shared.ts`** (line ~514, inside `query()` options):
   ```typescript
   // Current code (around line 512-531):
   query({
     prompt,
     options: {
       cwd: context.workingDir,
       additionalDirectories: [config.mortDir],
       // ... other options

       // ADD THIS LINE:
       settingSources: ["user", "project"],
     },
   });
   ```

2. **That's it!** The `claude_code` preset already includes the `Skill` tool.

3. **Test**: Create a test skill in `~/.claude/skills/test-skill/SKILL.md` and verify it's available in agent conversations.

#### Phase 2: Slash Command UI (User Experience)

This phase adds the `/` trigger dropdown for discovering and selecting skills/commands, following the existing `@` file trigger pattern.

##### 2.1 Create Command/Skill Trigger Handler

Create `src/lib/triggers/handlers/command-handler.ts`:

```typescript
import type { TriggerConfig, TriggerHandler, TriggerResult, TriggerContext } from "../types";
import { invoke } from "@tauri-apps/api/core";

interface SkillMetadata {
  name: string;
  description: string;
  argumentHint?: string;
  source: "personal" | "project" | "command";
  path: string;
}

class CommandTriggerHandler implements TriggerHandler {
  readonly config: TriggerConfig = {
    char: "/",
    name: "Command",
    placeholder: "Search skills and commands...",
    minQueryLength: 0, // Show all skills immediately on "/"
  };

  private cachedSkills: Map<string, SkillMetadata[]> = new Map();

  async search(
    query: string,
    context: TriggerContext,
    signal?: AbortSignal
  ): Promise<TriggerResult[]> {
    // Get skills for this repository (with caching)
    const skills = await this.getSkills(context.rootPath, signal);

    // Filter by query
    const filtered = query
      ? skills.filter(s =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.description?.toLowerCase().includes(query.toLowerCase())
        )
      : skills;

    // Convert to TriggerResult format
    return filtered.map(skill => ({
      id: `${skill.source}:${skill.name}`,
      label: `/${skill.name}`,
      description: skill.description || "",
      icon: this.getIconForSource(skill.source),
      insertText: `/${skill.name}${skill.argumentHint ? " " : ""}`,
      metadata: { argumentHint: skill.argumentHint },
    }));
  }

  private async getSkills(rootPath: string, signal?: AbortSignal): Promise<SkillMetadata[]> {
    const cacheKey = rootPath || "__global__";

    // Return cached if available (invalidate periodically or on focus)
    if (this.cachedSkills.has(cacheKey)) {
      return this.cachedSkills.get(cacheKey)!;
    }

    const skills = await invoke<SkillMetadata[]>("discover_skills", {
      repoPath: rootPath
    });

    this.cachedSkills.set(cacheKey, skills);
    return skills;
  }

  private getIconForSource(source: string): string {
    switch (source) {
      case "personal": return "user";
      case "project": return "folder";
      case "command": return "terminal";
      default: return "command";
    }
  }

  // Clear cache when skills might have changed
  invalidateCache(rootPath?: string) {
    if (rootPath) {
      this.cachedSkills.delete(rootPath);
    } else {
      this.cachedSkills.clear();
    }
  }
}

export const commandTriggerHandler = new CommandTriggerHandler();
```

##### 2.2 Register the Handler

Update `src/lib/triggers/index.ts`:

```typescript
import { triggerRegistry } from "./registry";
import { fileTriggerHandler } from "./handlers/file-handler";
import { commandTriggerHandler } from "./handlers/command-handler";

let initialized = false;

export function initializeTriggers(): void {
  if (initialized) return;
  initialized = true;

  triggerRegistry.register(fileTriggerHandler);
  triggerRegistry.register(commandTriggerHandler); // NEW
}
```

##### 2.3 Add Rust Backend Command

Add to `src-tauri/src/lib.rs` (or a new `skills.rs` module):

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    pub argument_hint: Option<String>,
    pub source: String,  // "personal", "project", or "command"
    pub path: String,
}

#[tauri::command]
pub async fn discover_skills(repo_path: String) -> Result<Vec<SkillMetadata>, String> {
    let mut skills = Vec::new();

    // 1. Personal skills: ~/.claude/skills/
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let personal_skills = home.join(".claude/skills");
    if personal_skills.exists() {
        skills.extend(scan_skills_directory(&personal_skills, "personal")?);
    }

    // 2. Personal commands: ~/.claude/commands/
    let personal_commands = home.join(".claude/commands");
    if personal_commands.exists() {
        skills.extend(scan_commands_directory(&personal_commands, "personal")?);
    }

    // 3. Project skills: <repo>/.claude/skills/
    if !repo_path.is_empty() {
        let project_skills = Path::new(&repo_path).join(".claude/skills");
        if project_skills.exists() {
            skills.extend(scan_skills_directory(&project_skills, "project")?);
        }

        // 4. Project commands: <repo>/.claude/commands/
        let project_commands = Path::new(&repo_path).join(".claude/commands");
        if project_commands.exists() {
            skills.extend(scan_commands_directory(&project_commands, "project")?);
        }
    }

    // Sort: project first, then personal, then alphabetically
    skills.sort_by(|a, b| {
        let source_order = |s: &str| match s {
            "project" => 0,
            "personal" => 1,
            _ => 2,
        };
        source_order(&a.source)
            .cmp(&source_order(&b.source))
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(skills)
}

fn scan_skills_directory(dir: &Path, source: &str) -> Result<Vec<SkillMetadata>, String> {
    let mut skills = Vec::new();

    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skill_file = path.join("SKILL.md");
            if skill_file.exists() {
                if let Ok(metadata) = parse_skill_frontmatter(&skill_file, source) {
                    // Only include user-invocable skills
                    skills.push(metadata);
                }
            }
        }
    }

    Ok(skills)
}

fn scan_commands_directory(dir: &Path, source: &str) -> Result<Vec<SkillMetadata>, String> {
    let mut commands = Vec::new();

    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "md") {
            if let Ok(metadata) = parse_command_frontmatter(&path, source) {
                commands.push(metadata);
            }
        }
    }

    Ok(commands)
}

fn parse_skill_frontmatter(path: &Path, source: &str) -> Result<SkillMetadata, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Extract YAML frontmatter between --- markers
    let frontmatter = extract_frontmatter(&content)?;

    // Parse frontmatter (simple key: value parsing)
    let name = frontmatter.get("name")
        .cloned()
        .unwrap_or_else(|| {
            path.parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string()
        });

    // Skip if user-invocable is explicitly false
    if frontmatter.get("user-invocable").map_or(false, |v| v == "false") {
        return Err("Skill is not user-invocable".into());
    }

    Ok(SkillMetadata {
        name,
        description: frontmatter.get("description").cloned().unwrap_or_default(),
        argument_hint: frontmatter.get("argument-hint").cloned(),
        source: source.to_string(),
        path: path.to_string_lossy().to_string(),
    })
}

fn parse_command_frontmatter(path: &Path, source: &str) -> Result<SkillMetadata, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let frontmatter = extract_frontmatter(&content)?;

    let name = frontmatter.get("name")
        .cloned()
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string()
        });

    Ok(SkillMetadata {
        name,
        description: frontmatter.get("description").cloned().unwrap_or_default(),
        argument_hint: frontmatter.get("argument-hint").cloned(),
        source: "command".to_string(),
        path: path.to_string_lossy().to_string(),
    })
}

fn extract_frontmatter(content: &str) -> Result<std::collections::HashMap<String, String>, String> {
    let mut map = std::collections::HashMap::new();

    if !content.starts_with("---") {
        return Ok(map);
    }

    let end = content[3..].find("---").map(|i| i + 3);
    let yaml = match end {
        Some(i) => &content[3..i],
        None => return Ok(map),
    };

    for line in yaml.lines() {
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim().to_string();
            let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
            if !key.is_empty() && !value.is_empty() {
                map.insert(key, value);
            }
        }
    }

    Ok(map)
}
```

##### 2.4 Update Dropdown Icons

The `TriggerDropdown` component already supports icons. Add skill-specific icons to the icon mapping:

```typescript
// In trigger-dropdown.tsx or a shared icon utility
const getIconForType = (icon: string) => {
  switch (icon) {
    case "user": return <UserIcon />;      // Personal skill
    case "folder": return <FolderIcon />;  // Project skill
    case "terminal": return <TerminalIcon />; // Command
    case "command": return <CommandIcon />; // Generic
    default: return getFileIcon(icon);     // Fall back to file extension icons
  }
};
```

##### 2.5 User Experience Flow

When user types `/` in the input:

1. **Immediate dropdown** appears (minQueryLength: 0)
2. **Shows all available skills/commands** grouped by source:
   - Project skills first (from `.claude/skills/`)
   - Personal skills (from `~/.claude/skills/`)
   - Commands (from `.claude/commands/`)
3. **Filter as user types** - `/rev` filters to `/review`, `/review-changes`, etc.
4. **Arrow key navigation** with visual highlighting
5. **Enter/Tab selection** inserts `/skill-name ` with trailing space for arguments
6. **Argument hint** shown in description (e.g., "[issue-number]")
7. **Escape** closes dropdown

##### 2.6 Visual Design

```
┌─────────────────────────────────────────┐
│ /                                       │
├─────────────────────────────────────────┤
│ 📁 /review-changes                      │  ← Project skill
│    Review staged git changes            │
│                                         │
│ 👤 /quick-commit                        │  ← Personal skill
│    Create commit with auto message      │
│                                         │
│ 💻 /test                                │  ← Command
│    Run project tests                    │
└─────────────────────────────────────────┘
```

##### 2.7 Caching Strategy

- Cache skill metadata per repository path
- Invalidate cache on:
  - Window focus (user may have edited files externally)
  - Settings panel changes
  - Manual refresh action
- Keep cache for 5 minutes max to avoid stale data

#### Phase 3: Mort-Specific Skills (Future)

1. **Custom skill location**: `~/.mort/skills/` for mort-specific skills

2. **Built-in skills**: Ship default skills with mort (e.g., `/mort-commit`, `/mort-review`)

3. **Skill management UI**: Install/enable/disable skills from settings

---

## Example: Creating a Skill

### Project-Level Skill

Create `.claude/skills/review-changes/SKILL.md` in a repository:

```yaml
---
name: review-changes
description: Reviews staged git changes and provides feedback on code quality, potential bugs, and improvements
argument-hint: [optional-focus-area]
allowed-tools: Bash, Read, Grep
---

# Review Changes

Review the currently staged git changes and provide constructive feedback.

## Steps

1. Run `git diff --staged` to see what's staged
2. Analyze each change for:
   - Code quality issues
   - Potential bugs
   - Security concerns
   - Performance implications
3. Provide specific, actionable feedback

## Focus Area

If specified, focus primarily on: $ARGUMENTS

## Output Format

For each file with issues:
- **File**: path/to/file.ts
- **Issue**: Description
- **Suggestion**: How to improve
```

### Personal Skill

Create `~/.claude/skills/quick-commit/SKILL.md`:

```yaml
---
name: quick-commit
description: Creates a commit with an auto-generated message based on staged changes
disable-model-invocation: true
allowed-tools: Bash
---

# Quick Commit

Generate a commit message and create a commit for staged changes.

1. Run `git diff --staged` to see changes
2. Generate a concise commit message following conventional commits format
3. Run `git commit -m "generated message"`
4. Report the commit hash
```

---

## Key Files to Modify

### Phase 1 (Backend Integration)

| File | Purpose | Changes |
|------|---------|---------|
| `agents/src/runners/shared.ts` | Agent execution loop | Add `settingSources: ["user", "project"]` to query options |

**Minimal backend: 1 line change** in `shared.ts`.

### Phase 2 (UI Integration)

| File | Purpose | Changes |
|------|---------|---------|
| `src/lib/triggers/handlers/command-handler.ts` | **NEW** | Skill/command trigger handler for `/` |
| `src/lib/triggers/index.ts` | Trigger initialization | Register command handler |
| `src/lib/triggers/types.ts` | Type definitions | Add `SkillMetadata` type if needed |
| `src-tauri/src/lib.rs` | Tauri commands | Add `discover_skills` command |
| `src-tauri/src/skills.rs` | **NEW** (optional) | Skill discovery logic (can be in lib.rs) |
| `src/components/reusable/trigger-dropdown.tsx` | Dropdown UI | Add icons for skill sources |

### Architecture Overview

```
User types "/"
     │
     ▼
TriggerSearchInput.handleChange()
     │
     ▼
useTriggerAutocomplete.analyzeInput()
     │  Detects "/" trigger character
     ▼
triggerRegistry.getHandler("/")
     │  Returns CommandTriggerHandler
     ▼
CommandTriggerHandler.search(query, context)
     │  Calls Rust backend via invoke()
     ▼
Tauri: discover_skills(repo_path)
     │  Scans ~/.claude/skills/, .claude/skills/, .claude/commands/
     │  Parses SKILL.md frontmatter
     ▼
Returns SkillMetadata[]
     │
     ▼
TriggerDropdown renders results
     │  User navigates with ↑↓, selects with Enter/Tab
     ▼
selectResult() inserts "/skill-name "
```

---

## Testing Plan

### Phase 1: Backend Integration

1. **Create test skill** at `~/.claude/skills/test/SKILL.md`
2. **Run mort agent** and type `/test` in a message
3. **Verify Claude receives skill** - check that the agent recognizes and executes the skill

### Phase 2: UI Integration

1. **Test dropdown appearance**
   - Type `/` in thread input
   - Verify dropdown appears immediately
   - Verify skills are listed with correct grouping (project first, then personal)

2. **Test filtering**
   - Type `/rev` and verify only matching skills appear
   - Verify fuzzy matching works on both name and description

3. **Test keyboard navigation**
   - Arrow up/down moves selection
   - Enter/Tab inserts selected skill
   - Escape closes dropdown

4. **Test insertion behavior**
   - Selected skill inserts as `/skill-name `
   - Cursor positioned after trailing space
   - Argument hint shown for skills that accept arguments

5. **Test caching**
   - Second `/` press returns results faster (cached)
   - Window focus invalidates cache
   - New skills appear after cache invalidation

6. **Test project vs personal**
   - Create skill with same name in both locations
   - Verify project skill appears first
   - Verify both are shown (not deduplicated)

7. **Test edge cases**
   - Empty skills directory (no errors)
   - Malformed SKILL.md (graceful skip)
   - `user-invocable: false` skills are hidden
   - Very long descriptions are truncated

---

## References

- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Agent Skills API Documentation](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Agent Skills in SDK](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Agent Skills Open Standard](https://agentskills.io)
