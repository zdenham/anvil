# Claude Code Skills & Commands Integration for Mort

## Overview

This document outlines how to integrate **both Claude Code skills AND legacy commands** into mort, enabling users to define custom capabilities that extend agent functionality.

**Important**: Mort will support BOTH formats:
- **Skills** (modern) - Directory-based with `SKILL.md` and bundled files
- **Commands** (legacy) - Single `.md` files, simpler but less powerful

## Skill & Command Sources Summary

**Mort will discover and load from ALL of the following locations:**

### Skills (Modern Format)
| Priority | Location | Path | Description |
|----------|----------|------|-------------|
| 1 | Repo-level Skills | `<repo>/.claude/skills/<name>/SKILL.md` | Project-specific, shared with team |
| 2 | Mort Personal Skills | `~/.mort/skills/<name>/SKILL.md` | **Mort-specific** personal skills |
| 3 | Claude Personal Skills | `~/.claude/skills/<name>/SKILL.md` | Standard Claude Code personal skills |

### Commands (Legacy Format)
| Priority | Location | Path | Description |
|----------|----------|------|-------------|
| 4 | Repo-level Commands | `<repo>/.claude/commands/<name>.md` | Project-specific legacy commands |
| 5 | Personal Commands | `~/.claude/commands/<name>.md` | Personal legacy commands |

This means users can:
- Use standard Claude Code skills they've already created
- Use existing legacy commands without migration
- Create mort-specific skills in `~/.mort/skills/` for workflows unique to mort
- Share project skills/commands via the repo's `.claude/` directory

---

## What Are Claude Code Skills?

Skills are modular, filesystem-based resources that extend Claude's capabilities. They follow the [Agent Skills open standard](https://agentskills.io) and package instructions, scripts, templates, and reference materials into organized directories.

**Key characteristics:**
- **Model-invoked**: Claude automatically uses them based on context
- **User-invoked**: Users can explicitly trigger them with `/skill-name`
- **Progressive disclosure**: Only metadata loads at startup; full content loads when triggered
- **Support bundled files**: Can include scripts, templates, examples, and reference documentation

### Skills vs Commands (Legacy) - Both Supported!

| Feature | Skills (Modern) | Commands (Legacy) |
|---------|-----------------|-------------------|
| Location | `.claude/skills/<name>/SKILL.md` | `.claude/commands/<name>.md` |
| Structure | Directory with multiple files | Single `.md` file |
| Bundled files | Yes (scripts, templates, examples) | No |
| Model invocation | Configurable via frontmatter | Always available |
| Format | YAML frontmatter + Markdown | YAML frontmatter + Markdown |
| Invocation | `/skill-name` | `/command-name` |

**Both formats create slash commands** (e.g., `/review`). Skills are the modern, recommended approach, but **mort will fully support both** to ensure backwards compatibility and ease of migration.

#### Command Format Example

```markdown
# ~/.claude/commands/test.md
---
description: Run the test suite
---
Run all tests using the project's test runner. Report any failures.
```

#### Skill Format Example

```markdown
# ~/.claude/skills/review/SKILL.md
---
description: Review code changes
argument_hint: "[file or PR number]"
---
Review the specified code for issues, best practices, and potential bugs.
```

---

## Directory Configuration

### Standard Claude Code Skill Locations (Priority Order)

| Priority | Location | Path | Scope |
|----------|----------|------|-------|
| 1 | Enterprise | Managed settings | Organization-wide |
| 2 | Personal | `~/.claude/skills/<skill-name>/SKILL.md` | All user projects |
| 3 | Project | `.claude/skills/<skill-name>/SKILL.md` | Single project |
| 4 | Plugin | `<plugin>/skills/<skill-name>/SKILL.md` | Where plugin enabled |

### Mort-Specific Skill Locations

In addition to the standard Claude Code locations, **mort will also support its own skills directory**:

| Priority | Location | Path | Scope |
|----------|----------|------|-------|
| 1 | Mort Personal | `~/.mort/skills/<skill-name>/SKILL.md` | All mort projects |
| 2 | Repo | `<repo>/.claude/skills/<skill-name>/SKILL.md` | Single repository |

**Why both?**
- `~/.claude/skills/` - Standard Claude Code skills that work across all Claude tools
- `~/.mort/skills/` - Mort-specific skills (e.g., UI automation, mort-specific workflows)

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

**Option 2: Custom Skill Loading (Required for Mort-Specific Skills)**

Since mort has its own skills directory (`~/.mort/skills/`), we need custom skill loading in addition to SDK-native support:

1. **Skill Discovery** - Scan all skill directories for `SKILL.md` files:
   ```typescript
   const skillPaths = [
     path.join(os.homedir(), '.mort/skills'),   // Mort-specific personal skills
     path.join(os.homedir(), '.claude/skills'), // Standard Claude Code personal skills
     path.join(repoPath, '.claude/skills'),     // Repo-level skills
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

// Unified interface for both modern skills and legacy commands
interface SkillMetadata {
  name: string;
  description: string;
  argumentHint?: string;
  // Source indicates origin AND whether it's a skill or command:
  // - "mort" = Mort-specific skill (~/.mort/skills/)
  // - "personal" = Personal skill (~/.claude/skills/)
  // - "project" = Repo-level skill (<repo>/.claude/skills/)
  // - "personal_command" = Personal legacy command (~/.claude/commands/)
  // - "project_command" = Repo-level legacy command (<repo>/.claude/commands/)
  source: "mort" | "personal" | "project" | "personal_command" | "project_command";
  path: string;
  isLegacyCommand: boolean;  // true for commands, false for skills
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

    // Discovers skills from ALL locations:
    // 1. ~/.mort/skills/ (mort-specific personal skills)
    // 2. ~/.claude/skills/ (standard Claude Code personal skills)
    // 3. <repo>/.claude/skills/ (repo-level skills)
    // 4. ~/.claude/commands/ (legacy personal commands)
    // 5. <repo>/.claude/commands/ (legacy repo commands)
    const skills = await invoke<SkillMetadata[]>("discover_skills", {
      repoPath: rootPath
    });

    this.cachedSkills.set(cacheKey, skills);
    return skills;
  }

  private getIconForSource(source: string): string {
    switch (source) {
      case "mort": return "mort";                 // Mort-specific skill (~/.mort/skills/)
      case "personal": return "user";             // Claude Code personal skill (~/.claude/skills/)
      case "project": return "folder";            // Repo-level skill (.claude/skills/)
      case "personal_command": return "terminal"; // Personal legacy command (~/.claude/commands/)
      case "project_command": return "folder-terminal"; // Repo legacy command (.claude/commands/)
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

/// Unified metadata for both skills and legacy commands
/// The `source` field indicates the origin AND type:
/// - "mort" = Mort-specific skill from ~/.mort/skills/
/// - "personal" = Claude Code skill from ~/.claude/skills/
/// - "project" = Repo-level skill from <repo>/.claude/skills/
/// - "personal_command" = Legacy command from ~/.claude/commands/
/// - "project_command" = Legacy command from <repo>/.claude/commands/
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    pub argument_hint: Option<String>,
    pub source: String,
    pub path: String,
    pub is_legacy_command: bool,  // true for .claude/commands/, false for skills
}

#[tauri::command]
pub async fn discover_skills(repo_path: String) -> Result<Vec<SkillMetadata>, String> {
    let mut skills = Vec::new();
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    // 1. Mort-specific personal skills: ~/.mort/skills/
    let mort_skills = home.join(".mort/skills");
    if mort_skills.exists() {
        skills.extend(scan_skills_directory(&mort_skills, "mort")?);
    }

    // 2. Standard Claude Code personal skills: ~/.claude/skills/
    let personal_skills = home.join(".claude/skills");
    if personal_skills.exists() {
        skills.extend(scan_skills_directory(&personal_skills, "personal")?);
    }

    // 3. Personal commands (LEGACY FORMAT): ~/.claude/commands/
    // These are single .md files, NOT directories with SKILL.md
    let personal_commands = home.join(".claude/commands");
    if personal_commands.exists() {
        skills.extend(scan_commands_directory(&personal_commands, "personal_command")?);
    }

    // 4. Repo-level skills: <repo>/.claude/skills/
    if !repo_path.is_empty() {
        let project_skills = Path::new(&repo_path).join(".claude/skills");
        if project_skills.exists() {
            skills.extend(scan_skills_directory(&project_skills, "project")?);
        }

        // 5. Repo-level commands (LEGACY FORMAT): <repo>/.claude/commands/
        // These are single .md files, NOT directories with SKILL.md
        let project_commands = Path::new(&repo_path).join(".claude/commands");
        if project_commands.exists() {
            skills.extend(scan_commands_directory(&project_commands, "project_command")?);
        }
    }

    // Sort priority: repo-level > mort > personal, skills before commands, then alphabetically
    skills.sort_by(|a, b| {
        let source_order = |s: &str| match s {
            "project" => 0,           // Repo-level skills (highest priority)
            "project_command" => 1,   // Repo-level legacy commands
            "mort" => 2,              // Mort-specific personal skills
            "personal" => 3,          // Standard Claude Code personal skills
            "personal_command" => 4,  // Personal legacy commands (lowest priority)
            _ => 5,
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

/// Parse modern skill files (.claude/skills/<name>/SKILL.md)
/// These are directories containing SKILL.md and potentially other bundled files
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
        is_legacy_command: false,
    })
}

/// Parse legacy command files (.claude/commands/*.md)
/// These are single markdown files with YAML frontmatter
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
        source: source.to_string(),  // "personal_command" or "project_command"
        path: path.to_string_lossy().to_string(),
        is_legacy_command: true,
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
    case "mort": return <MortIcon />;            // Mort-specific skill (~/.mort/skills/)
    case "user": return <UserIcon />;            // Personal skill (~/.claude/skills/)
    case "folder": return <FolderIcon />;        // Repo-level skill (.claude/skills/)
    case "terminal": return <TerminalIcon />;    // Personal legacy command (~/.claude/commands/)
    case "folder-terminal": return <FolderTerminalIcon />; // Repo legacy command
    case "command": return <CommandIcon />;      // Generic fallback
    default: return getFileIcon(icon);           // Fall back to file extension icons
  }
};
```

##### 2.5 User Experience Flow

When user types `/` in the input:

1. **Immediate dropdown** appears (minQueryLength: 0)
2. **Shows all available skills AND commands** grouped by source (in priority order):
   - Repo-level skills (from `<repo>/.claude/skills/`)
   - Repo-level legacy commands (from `<repo>/.claude/commands/`)
   - Mort-specific personal skills (from `~/.mort/skills/`)
   - Standard Claude Code personal skills (from `~/.claude/skills/`)
   - Personal legacy commands (from `~/.claude/commands/`)
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
│ 📁 /review-changes                      │  ← Repo SKILL (.claude/skills/)
│    Review staged git changes            │
│                                         │
│ 📂 /build                               │  ← Repo COMMAND (.claude/commands/)
│    Run project build                    │
│                                         │
│ 🔮 /mort-workflow                       │  ← Mort skill (~/.mort/skills/)
│    Custom mort automation               │
│                                         │
│ 👤 /quick-commit                        │  ← Personal SKILL (~/.claude/skills/)
│    Create commit with auto message      │
│                                         │
│ 💻 /test                                │  ← Personal COMMAND (~/.claude/commands/)
│    Run project tests                    │
└─────────────────────────────────────────┘
```

Note: Both skills and commands appear in the same dropdown, but skills are the modern format (directory-based) while commands are the legacy format (single file).

##### 2.7 Caching Strategy

- Cache skill metadata per repository path
- Invalidate cache on:
  - Window focus (user may have edited files externally)
  - Settings panel changes
  - Manual refresh action
- Keep cache for 5 minutes max to avoid stale data

#### Phase 3: Mort-Specific Skills Enhancement (Future)

The `~/.mort/skills/` directory is already supported in Phase 2. This phase adds additional mort-specific enhancements:

1. **Built-in skills**: Ship default skills with mort (e.g., `/mort-commit`, `/mort-review`)
   - These would be bundled in the app and copied to `~/.mort/skills/` on first run

2. **Skill management UI**: Install/enable/disable skills from settings
   - Toggle visibility of skills from different sources
   - Quick-create new skills from templates

3. **Mort skill templates**: Provide starter templates for common mort workflows

---

## Examples: Creating Skills and Commands

Both formats are fully supported. Use skills (modern) for new work, but existing commands continue to work.

### Project-Level Skill (Modern Format)

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

### Personal Skill (Modern Format)

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

### Legacy Command (Still Supported!)

Create `~/.claude/commands/test.md` (single file, not a directory):

```markdown
---
description: Run the project test suite and report results
---

Run the test suite for this project. Detect the test framework being used
(jest, vitest, pytest, etc.) and run the appropriate command.

Report:
1. Total tests run
2. Passed/failed counts
3. Any error messages for failed tests
```

Or a repo-level command at `<repo>/.claude/commands/build.md`:

```markdown
---
description: Build the project for production
---

Run the production build command for this project. Handle any errors gracefully.
```

**Note**: Legacy commands work identically to skills but are simpler (single file vs directory). They cannot bundle additional files like scripts or templates.

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
     │  Scans ALL skill AND command locations:
     │  SKILLS (modern - directories with SKILL.md):
     │  - ~/.mort/skills/<name>/SKILL.md     (mort-specific personal)
     │  - ~/.claude/skills/<name>/SKILL.md   (standard personal)
     │  - <repo>/.claude/skills/<name>/SKILL.md (repo-level)
     │  COMMANDS (legacy - single .md files):
     │  - ~/.claude/commands/<name>.md       (personal legacy)
     │  - <repo>/.claude/commands/<name>.md  (repo-level legacy)
     │  Parses YAML frontmatter from both formats
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
