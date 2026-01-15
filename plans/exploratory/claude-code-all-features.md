# Claude Code Feature Parity Reference

Comprehensive list of all Claude Code CLI features for building a wrapper with UI/UX parity.

**Legend:** Mark `[x]` to support, `[ ]` to skip, `[?]` for undecided

---

## 1. Input Features

### File & Directory References

| Support? | Feature                    | Description                                                                |
| :------: | -------------------------- | -------------------------------------------------------------------------- |
|   [x]    | @ mentions                 | Quick file path autocomplete and reference (`@file.js`, `@path/to/file`)   |
|   [x]    | Directory references       | Reference directories with file listing (`@src/components`)                |
|   [ ]    | MCP resource references    | Reference external resources from MCP servers (`@github:issue://123`)      |
|   [ ]    | Line number specifications | Reference specific lines (`@file.js#L1-50`)                                |
|   [x]    | Multi-file references      | Reference multiple files in single prompt                                  |
|   [ ]    | Relative & absolute paths  | Support both path types                                                    |
|   [ ]    | Custom file suggestion     | Configure custom command for `@` autocomplete via `fileSuggestion` setting |

### Image Support

| Support? | Feature              | Description                                          |
| :------: | -------------------- | ---------------------------------------------------- |
|   [ ]    | Drag and drop images | Drop images directly into CLI                        |
|   [ ]    | Clipboard paste      | Paste images with Ctrl+V or Cmd+V                    |
|   [ ]    | Image file paths     | Reference image paths directly in prompts            |
|   [ ]    | Multiple images      | Work with multiple images in single conversation     |
|   [ ]    | Image analysis       | Ask Claude to analyze screenshots, diagrams, mockups |

### Message Input

| Support? | Feature                      | Description                                          |
| :------: | ---------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
|   [x]    | Multiline input              | `\` + Enter, `Option+Enter`, `Shift+Enter`, `Ctrl+J` | NOTE: we don't want the back slashes             |
|   [x]    | Paste mode                   | Direct paste for code blocks and logs                | NOTE: the summary of the paste is important here |
|   [x]    | @ file autocomplete          | Autocomplete works anywhere in input                 |
|   [ ]    | / slash command autocomplete | Autocomplete works anywhere in input                 |
|   [ ]    | Bash mode with `!` prefix    | Execute bash directly without Claude interpretation  |

### Piping & Stream Input

| Support? | Feature                   | Description                                         |
| :------: | ------------------------- | --------------------------------------------------- |
|   [ ]    | Stdin piping              | `cat file \| claude -p "query"`                     |
|   [ ]    | Stream JSON input         | `--input-format stream-json` for programmatic input |
|   [ ]    | Structured output formats | Text, JSON, or stream-JSON output                   |

---

## 2. Message Queue / Conversation Features

### Session Management

| Support? | Feature                 | Description                                           |
| :------: | ----------------------- | ----------------------------------------------------- |
|   [ ]    | Session persistence     | Automatic saving of all conversations locally         |
|   [ ]    | Session resumption      | `/resume [session]` or `claude --resume [name]`       |
|   [ ]    | Named sessions          | `/rename <name>` to give memorable names              |
|   [ ]    | Session continuation    | `claude --continue` for most recent session           |
|   [ ]    | Session forking         | `--fork-session` to create new branch from existing   |
|   [ ]    | Session picker          | Interactive picker with keyboard shortcuts            |
|   [ ]    | Session metadata        | Display name, elapsed time, message count, git branch |
|   [ ]    | Per-directory storage   | Sessions stored per working directory                 |
|   [ ]    | Cross-worktree sessions | Resume sessions across git worktrees                  |

### Message History

| Support? | Feature               | Description                               |
| :------: | --------------------- | ----------------------------------------- |
|   [ ]    | Command history       | Navigate with Up/Down arrows              |
|   [ ]    | Reverse search        | `Ctrl+R` for interactive history search   |
|   [ ]    | Per-directory history | History stored per working directory      |
|   [ ]    | Export conversations  | `/export [filename]` to file or clipboard |
|   [ ]    | Clear history         | `/clear` to clear conversation history    |

### Message Context

| Support? | Feature                    | Description                                            |
| :------: | -------------------------- | ------------------------------------------------------ |
|   [ ]    | Context visualization      | `/context` shows current context usage as colored grid |
|   [ ]    | Token usage tracking       | `/cost` shows token statistics                         |
|   [ ]    | Background task management | `/bashes` to list and manage background tasks          |

---

## 3. Multi-Agent / Task Display Features

### Subagent System

| Support? | Feature                   | Description                                        |
| :------: | ------------------------- | -------------------------------------------------- |
|   [ ]    | Automatic delegation      | Claude automatically invokes specialized subagents |
|   [ ]    | Explicit invocation       | Request specific subagent by name                  |
|   [ ]    | Built-in subagents        | General-purpose, Plan, Explore agents              |
|   [ ]    | Custom subagents          | `/agents` command to create/manage                 |
|   [ ]    | Project subagents         | `.claude/agents/` for team sharing                 |
|   [ ]    | User subagents            | `~/.claude/agents/` for personal use               |
|   [ ]    | Subagent tools control    | Restrict tool access per subagent                  |
|   [ ]    | Subagent model selection  | Specify model per subagent (sonnet, opus, haiku)   |
|   [ ]    | Subagent permission modes | Control approval prompts per subagent              |
|   [ ]    | Subagent resumption       | Resume previous subagent work with context         |

### Task & Agent Display

| Support? | Feature                   | Description                                 |
| :------: | ------------------------- | ------------------------------------------- |
|   [ ]    | Task tool                 | Run sub-agents for multi-step tasks         |
|   [x]    | Agent status              | View active agents and their state          |
|   [ ]    | Task completion display   | Shows when tasks/agents complete            |
|   [ ]    | Verbose output            | `Ctrl+O` to toggle verbose display          |
|   [ ]    | Extended thinking display | Gray italic text showing Claude's reasoning |

### Background Tasks

| Support? | Feature                   | Description                                    |
| :------: | ------------------------- | ---------------------------------------------- |
|   [ ]    | Background bash execution | `Ctrl+B` to background long-running commands   |
|   [ ]    | Background task IDs       | Unique IDs for tracking                        |
|   [ ]    | Task output retrieval     | `BashOutput` tool to fetch buffered output     |
|   [ ]    | Background task listing   | `/bashes` command to view all background tasks |

---

## 4. Interactive UI Elements

### Permission & Approval System

| Support? | Feature             | Description                                                                |
| :------: | ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
|   [x]    | Permission dialogs  | Ask/approve for tool use                                                   |
|   [x]    | Permission modes    | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan`, `ignore` | NOTE: we may want to make our modes a bit different, we want more permissive defaults |
|   [x]    | Mode switching      | `Shift+Tab` to cycle through modes                                         |
|   [x]    | Auto-accept mode    | `⏵⏵ accept edits on` indicator                                             |
|   [ ]    | Plan mode indicator | `⏸ plan mode on` indicator                                                 | NOTE: for plan mode we want output to a specific file                                 |
|   [ ]    | CLI mode override   | `--permission-mode` flag                                                   |

### Multiple Choice & Selection

| Support? | Feature               | Description                                        |
| :------: | --------------------- | -------------------------------------------------- |
|   [x]    | AskUserQuestion tool  | Multiple choice questions to user                  |
|   [ ]    | Interactive menus     | Session picker, command selection, agent selection |
|   [ ]    | Tab navigation        | `Left/Right` arrows to cycle between tabs          |
|   [ ]    | Search within pickers | Filter options during selection                    |
|   [x]    | Multi-select          | Allow selecting multiple options                   |

### Confirmations & Alerts

| Support? | Feature                      | Description                                  |
| :------: | ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
|   [x]    | Permission prompts           | Confirm before executing tools               |
|   [x]    | Edit diffs                   | Show changes before applying                 | NOTE: ours will be different, as we have an explicit diff tool     |
|   [x]    | Tool execution notifications | Visual feedback for tool use                 | NOTE: we sort of already have this                                 |
|   [ ]    | Status indicators            | Mode and state display at bottom of terminal |
|   [x]    | Warnings                     | Cost warnings, MCP output warnings, etc.     | NOTE: especially context, we want to show live context on a thread |

### Visual Display

| Support? | Feature               | Description                                     |
| :------: | --------------------- | ----------------------------------------------- |
|   [ ]    | Syntax highlighting   | `Ctrl+T` to toggle in theme picker              |
|   [x]    | Code block formatting | Markdown rendering in terminal                  |
|   [x]    | Diff viewing          | Inline diffs with context                       |
|   [ ]    | IDE diff integration  | Integration with VS Code/JetBrains diff viewers |
|   [ ]    | Color themes          | `/theme` command to change color theme          |
|   [ ]    | Status line           | Custom status line UI via `/statusline`         |
|   [ ]    | Terminal clearing     | `Ctrl+L` to clear screen                        |

---

## 5. Slash Commands

### Built-in Commands

| Support? | Command                   | Description                              |
| :------: | ------------------------- | ---------------------------------------- |
|   [ ]    | `/add-dir`                | Add additional working directories       |
|   [ ]    | `/agents`                 | Manage custom AI subagents               |
|   [ ]    | `/bashes`                 | List and manage background tasks         |
|   [ ]    | `/bug`                    | Report bugs to Anthropic                 |
|   [ ]    | `/clear`                  | Clear conversation history               |
|   [ ]    | `/compact [instructions]` | Compact conversation with optional focus |
|   [ ]    | `/config`                 | Open Settings interface                  |
|   [ ]    | `/context`                | Visualize context usage as colored grid  |
|   [ ]    | `/cost`                   | Show token usage statistics              |
|   [ ]    | `/doctor`                 | Check health of Claude Code installation |
|   [ ]    | `/exit`                   | Exit the REPL                            |
|   [ ]    | `/export [filename]`      | Export conversation to file or clipboard |
|   [ ]    | `/help`                   | Get usage help                           |
|   [ ]    | `/hooks`                  | Manage hook configurations               |
|   [ ]    | `/ide`                    | Manage IDE integrations                  |
|   [ ]    | `/init`                   | Initialize project with CLAUDE.md guide  |
|   [ ]    | `/install-github-app`     | Set up Claude GitHub Actions             |
|   [ ]    | `/login`                  | Switch Anthropic accounts                |
|   [ ]    | `/logout`                 | Sign out from account                    |
|   [ ]    | `/mcp`                    | Manage MCP server connections            |
|   [ ]    | `/memory`                 | Edit CLAUDE.md memory files              |
|   [ ]    | `/model`                  | Select or change AI model                |
|   [ ]    | `/output-style [style]`   | Set output style                         |
|   [ ]    | `/permissions`            | View or update permissions               |
|   [ ]    | `/plan`                   | Enter plan mode directly                 |
|   [ ]    | `/plugin`                 | Manage Claude Code plugins               |
|   [ ]    | `/pr-comments`            | View pull request comments               |
|   [ ]    | `/privacy-settings`       | View and update privacy settings         |
|   [ ]    | `/release-notes`          | View release notes                       |
|   [ ]    | `/rename <name>`          | Rename current session                   |
|   [ ]    | `/resume [session]`       | Resume a conversation                    |
|   [ ]    | `/review`                 | Request code review                      |
|   [ ]    | `/rewind`                 | Rewind conversation and/or code          |
|   [ ]    | `/sandbox`                | Enable sandboxed bash execution          |
|   [ ]    | `/security-review`        | Security review of pending changes       |
|   [ ]    | `/stats`                  | Visualize daily usage and streaks        |
|   [ ]    | `/status`                 | Open Settings interface (Status tab)     |
|   [ ]    | `/statusline`             | Set up status line UI                    |
|   [ ]    | `/terminal-setup`         | Install Shift+Enter key binding          |
|   [ ]    | `/theme`                  | Change color theme                       |
|   [ ]    | `/todos`                  | List current TODO items                  |
|   [ ]    | `/usage`                  | Show plan usage and rate limit status    |
|   [ ]    | `/vim`                    | Enter vim mode                           |

### Custom Slash Commands

| Support? | Feature          | Description                                                |
| :------: | ---------------- | ---------------------------------------------------------- |
|   [ ]    | Project commands | `.claude/commands/` for team sharing                       |
|   [ ]    | User commands    | `~/.claude/commands/` for personal use                     |
|   [ ]    | Namespacing      | Subdirectories create grouped descriptions                 |
|   [ ]    | Arguments        | `$ARGUMENTS` for all args, `$1/$2/etc` for individual      |
|   [ ]    | Bash execution   | `!` prefix for command execution                           |
|   [ ]    | File references  | `@` prefix to include file contents                        |
|   [ ]    | Frontmatter      | Define metadata (allowed-tools, description, model, hooks) |

### MCP Slash Commands

| Support? | Feature           | Description                                      |
| :------: | ----------------- | ------------------------------------------------ |
|   [ ]    | Dynamic discovery | Auto-discovered from connected MCP servers       |
|   [ ]    | Format            | `/mcp__<server-name>__<prompt-name> [arguments]` |
|   [ ]    | Arguments         | Server-defined parameters                        |

---

## 6. Keyboard Shortcuts

### General Controls

| Support? | Shortcut              | Description                        |
| :------: | --------------------- | ---------------------------------- | --------------------------------- |
|   [x]    | `Ctrl+C`              | Cancel current input or generation |
|   [ ]    | `Ctrl+D`              | Exit Claude Code session           |
|   [ ]    | `Ctrl+L`              | Clear terminal screen              |
|   [ ]    | `Ctrl+O`              | Toggle verbose output              |
|   [ ]    | `Ctrl+R`              | Reverse search command history     |
|   [ ]    | `Ctrl+V` / `Cmd+V`    | Paste image from clipboard         |
|   [ ]    | `Ctrl+B`              | Background running tasks/agents    |
|   [x]    | `Left/Right arrows`   | Cycle through dialog tabs          |
|   [x]    | `Up/Down arrows`      | Navigate command history           | NOTE: this will be prompt history |
|   [ ]    | `Esc + Esc`           | Rewind code/conversation           |
|   [x]    | `Shift+Tab` / `Alt+M` | Toggle permission modes            |
|   [ ]    | `Option+P` / `Alt+P`  | Switch model                       |
|   [ ]    | `Option+T` / `Alt+T`  | Toggle extended thinking           |

### Text Editing

| Support? | Shortcut | Description                  |
| :------: | -------- | ---------------------------- |
|   [ ]    | `Ctrl+K` | Delete to end of line        |
|   [ ]    | `Ctrl+U` | Delete entire line           |
|   [ ]    | `Ctrl+Y` | Paste deleted text           |
|   [ ]    | `Alt+Y`  | Cycle paste history          |
|   [ ]    | `Alt+B`  | Move cursor back one word    |
|   [ ]    | `Alt+F`  | Move cursor forward one word |

### Multiline Input

| Support? | Shortcut       | Description                     |
| :------: | -------------- | ------------------------------- | -------------------------------------- |
|   [ ]    | `\ + Enter`    | Works in all terminals          |
|   [x]    | `Option+Enter` | macOS default                   | NOTE: "shift + enter" should also work |
|   [ ]    | `Shift+Enter`  | iTerm2, WezTerm, Ghostty, Kitty |
|   [ ]    | `Ctrl+J`       | Line feed character             |

### Vim Mode

| Support? | Shortcut      | Description        |
| :------: | ------------- | ------------------ |
|   [ ]    | `Esc`         | Enter NORMAL mode  |
|   [ ]    | `i/I/a/A/o/O` | Insert modes       |
|   [ ]    | `h/j/k/l`     | Navigation         |
|   [ ]    | `w/e/b`       | Word navigation    |
|   [ ]    | `0/$`         | Line start/end     |
|   [ ]    | `dd/cc/yy`    | Line operations    |
|   [ ]    | `p/P`         | Paste              |
|   [ ]    | `.`           | Repeat last change |

---

## 7. Settings / Configuration

### Settings Files

| Support? | Scope            | Location                            |
| :------: | ---------------- | ----------------------------------- |
|   [ ]    | User settings    | `~/.claude/settings.json`           |
|   [ ]    | Project settings | `.claude/settings.json`             |
|   [ ]    | Local settings   | `.claude/settings.local.json`       |
|   [ ]    | Managed settings | System-wide `managed-settings.json` |

### Key Settings

| Support? | Setting                   | Description                            |
| :------: | ------------------------- | -------------------------------------- |
|   [ ]    | `apiKeyHelper`            | Script to generate auth values         |
|   [ ]    | `cleanupPeriodDays`       | Session retention (default: 30 days)   |
|   [ ]    | `env`                     | Environment variables for all sessions |
|   [ ]    | `attribution`             | Customize git commit/PR attribution    |
|   [ ]    | `permissions.allow`       | Allowed tools/commands                 |
|   [ ]    | `permissions.ask`         | Tools requiring confirmation           |
|   [ ]    | `permissions.deny`        | Blocked tools/files                    |
|   [ ]    | `permissions.defaultMode` | Default permission mode                |
|   [ ]    | `hooks`                   | Event handlers for tool execution      |
|   [ ]    | `model`                   | Default AI model                       |
|   [ ]    | `statusLine`              | Custom status line configuration       |
|   [ ]    | `fileSuggestion`          | Custom `@` autocomplete script         |
|   [ ]    | `respectGitignore`        | Exclude .gitignore patterns            |
|   [ ]    | `outputStyle`             | Customize system prompt                |
|   [ ]    | `sandbox.enabled`         | Enable bash sandboxing                 |
|   [ ]    | `enabledPlugins`          | Which plugins to enable                |

### Key Environment Variables

| Support? | Variable                        | Description                    |
| :------: | ------------------------------- | ------------------------------ |
|   [ ]    | `ANTHROPIC_API_KEY`             | API key for Claude SDK         |
|   [ ]    | `ANTHROPIC_MODEL`               | Model setting name             |
|   [ ]    | `BASH_DEFAULT_TIMEOUT_MS`       | Default bash timeout           |
|   [ ]    | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Max output tokens              |
|   [ ]    | `CLAUDE_CODE_USE_BEDROCK`       | Use AWS Bedrock                |
|   [ ]    | `CLAUDE_CODE_USE_VERTEX`        | Use Google Vertex              |
|   [ ]    | `DISABLE_TELEMETRY`             | Opt out of telemetry           |
|   [ ]    | `MAX_THINKING_TOKENS`           | Extended thinking token budget |

---

## 8. MCP Server Integration

### MCP Management

| Support? | Feature             | Description                                                |
| :------: | ------------------- | ---------------------------------------------------------- |
|   [ ]    | HTTP servers        | `claude mcp add --transport http <name> <url>`             |
|   [ ]    | SSE servers         | `claude mcp add --transport sse <name> <url>` (deprecated) |
|   [ ]    | Stdio servers       | `claude mcp add --transport stdio <name> -- <command>`     |
|   [ ]    | Environment vars    | `claude mcp add --env KEY=value`                           |
|   [ ]    | HTTP headers        | `claude mcp add --header "Auth: Bearer token"`             |
|   [ ]    | List servers        | `claude mcp list`                                          |
|   [ ]    | Remove servers      | `claude mcp remove <name>`                                 |
|   [ ]    | Import from Desktop | `claude mcp add-from-claude-desktop`                       |
|   [ ]    | Run as server       | `claude mcp serve`                                         |

### MCP Scopes

| Support? | Scope   | Description                                   |
| :------: | ------- | --------------------------------------------- |
|   [ ]    | Local   | Personal, project-specific (`~/.claude.json`) |
|   [ ]    | Project | Team-shared (`.mcp.json` in git)              |
|   [ ]    | User    | Personal, cross-project (`~/.claude.json`)    |
|   [ ]    | Managed | Organization-wide (`managed-mcp.json`)        |

### MCP Features

| Support? | Feature                        | Description                    |
| :------: | ------------------------------ | ------------------------------ |
|   [ ]    | Dynamic tool updates           | `list_changed` notifications   |
|   [ ]    | OAuth 2.0 authentication       | `/mcp` command for secure auth |
|   [ ]    | Environment variable expansion | `${VAR}` in `.mcp.json`        |
|   [ ]    | Resource references            | `@server:resource/path` syntax |
|   [ ]    | Prompts as slash commands      | `/mcp__server__prompt_name`    |
|   [ ]    | Tool access control            | Permission rules for MCP tools |

---

## 9. Hooks System

### Hook Events

| Support? | Event             | Description                         |
| :------: | ----------------- | ----------------------------------- |
|   [ ]    | PreToolUse        | Before tool calls (can block them)  |
|   [ ]    | PermissionRequest | When permission dialog shown        |
|   [ ]    | PostToolUse       | After tool calls complete           |
|   [ ]    | UserPromptSubmit  | Before Claude processes user prompt |
|   [ ]    | Notification      | When Claude sends notifications     |
|   [ ]    | Stop              | When Claude finishes responding     |
|   [ ]    | SubagentStop      | When subagent tasks complete        |
|   [ ]    | PreCompact        | Before compact operation            |
|   [ ]    | SessionStart      | On session start/resume             |
|   [ ]    | SessionEnd        | On session end                      |

### Hook Configuration

| Support? | Feature              | Description                           |
| :------: | -------------------- | ------------------------------------- |
|   [ ]    | Matchers             | Tool name matching or `*` for all     |
|   [ ]    | Bash commands        | Execute shell scripts on events       |
|   [ ]    | Prompt-based hooks   | LLM-powered decision making           |
|   [ ]    | JSON output          | Control Claude behavior via JSON      |
|   [ ]    | Exit codes           | Simple approval/denial via exit codes |
|   [ ]    | Command-scoped hooks | Hooks in slash command frontmatter    |
|   [ ]    | Subagent hooks       | Hooks in subagent definitions         |

---

## 10. IDE Integrations

### VS Code Extension

| Support? | Feature                    | Description                                         |
| :------: | -------------------------- | --------------------------------------------------- |
|   [ ]    | Panel positioning          | Drag to right sidebar, left sidebar, or editor tabs |
|   [ ]    | Editor toolbar icon        | Quick access (spark icon)                           |
|   [ ]    | Status bar                 | `✱ Claude Code` indicator                           |
|   [ ]    | Command palette            | `Cmd+Shift+P` integration                           |
|   [ ]    | @-mention with line ranges | `Alt+K` to insert file reference                    |
|   [ ]    | Multiple conversations     | Tabs or separate windows                            |
|   [ ]    | Diff viewing               | Inline diffs in VS Code                             |
|   [ ]    | Auto-save                  | Auto-save files before Claude reads                 |
|   [ ]    | Terminal mode              | Optional CLI-style interface                        |

### JetBrains IDE Integration

| Support? | Feature            | Description                                       |
| :------: | ------------------ | ------------------------------------------------- |
|   [ ]    | Supported IDEs     | IntelliJ, PyCharm, Android Studio, WebStorm, etc. |
|   [ ]    | Quick launch       | `Cmd+Esc` (Mac) or `Ctrl+Esc` (Win/Linux)         |
|   [ ]    | Diff viewer        | IDE native diff viewer integration                |
|   [ ]    | Selection sharing  | Current selection/tab auto-shared                 |
|   [ ]    | File references    | `Cmd+Option+K` to insert references               |
|   [ ]    | Diagnostic sharing | Lint errors auto-shared with Claude               |

---

## 11. Output / Display Features

### Output Formats

| Support? | Format             | Description                                        |
| :------: | ------------------ | -------------------------------------------------- |
|   [ ]    | Default text       | Plain text response                                |
|   [ ]    | JSON format        | `--output-format json` for full conversation log   |
|   [ ]    | Stream JSON        | `--output-format stream-json` for real-time output |
|   [ ]    | Structured outputs | `--json-schema` for validated JSON responses       |

### Display Elements

| Support? | Element             | Description                                   |
| :------: | ------------------- | --------------------------------------------- |
|   [x]    | Code blocks         | Markdown-formatted with language highlighting |
|   [x]    | Diffs               | Side-by-side or unified diff format           |
|   [x]    | Error messages      | Clear error reporting with context            |
|   [x]    | Status messages     | Real-time status during execution             |
|   [x]    | Token counters      | Show token usage                              |
|   [x]    | Cost indicators     | Display approximate costs                     |
|   [x]    | Progress indicators | Spinners for long operations                  |
|   [x]    | Thinking blocks     | Extended thinking reasoning (verbose mode)    |

### Verbosity Control

| Support? | Mode          | Description                        |
| :------: | ------------- | ---------------------------------- |
|   [ ]    | Normal output | Concise responses                  |
|   [ ]    | Verbose mode  | `Ctrl+O` shows detailed tool usage |
|   [ ]    | Debug output  | `--debug` with optional categories |

---

## 12. Other UI/UX Features

### Memory & Context Management

| Support? | Feature              | Description                                   |
| :------: | -------------------- | --------------------------------------------- |
|   [ ]    | CLAUDE.md files      | Project and user memory files                 |
|   [ ]    | Memory organization  | `.claude/CLAUDE.md` and `~/.claude/CLAUDE.md` |
|   [ ]    | Memory imports       | `# imports` section for including other files |
|   [ ]    | Quick memory editing | `/memory` command                             |
|   [ ]    | Memory lookup        | `#` shortcut to add memories                  |

### Workspace Management

| Support? | Feature                      | Description                                        |
| :------: | ---------------------------- | -------------------------------------------------- |
|   [ ]    | Multiple working directories | `--add-dir` or `permissions.additionalDirectories` |
|   [ ]    | Directory switching          | `cd` within session or `/add-dir`                  |
|   [ ]    | Git integration              | Git operations, branch awareness                   |
|   [ ]    | Git worktrees                | Run parallel sessions with complete isolation      |
|   [ ]    | Project detection            | Automatic codebase analysis                        |

### Advanced Features

| Support? | Feature              | Description                                |
| :------: | -------------------- | ------------------------------------------ |
|   [ ]    | Extended thinking    | `/plan` mode or `--permission-mode plan`   |
|   [ ]    | Plan mode            | Read-only analysis before making changes   |
|   [ ]    | Checkpointing        | `Esc+Esc` to rewind to previous state      |
|   [ ]    | Output styles        | `/output-style` to customize system prompt |
|   [ ]    | Model switching      | `Option+P` to switch models mid-session    |
|   [ ]    | Headless mode        | `-p` flag for non-interactive scripting    |
|   [ ]    | Piping compatibility | Works with Unix pipes and streams          |

### Developer Tools

| Support? | Feature           | Description                             |
| :------: | ----------------- | --------------------------------------- |
|   [ ]    | Health check      | `/doctor` to verify installation        |
|   [ ]    | Status display    | `/status` shows version, model, account |
|   [ ]    | Version info      | `claude --version` for current version  |
|   [ ]    | Release notes     | `/release-notes` for latest updates     |
|   [ ]    | Plugin management | `/plugin` to manage installed plugins   |
|   [ ]    | Analytics         | `/stats` for usage visualization        |

---

## Summary

**200+ user-facing features** documented across:

- **50+ slash commands** (built-in, custom, MCP)
- **40+ keyboard shortcuts** (general, text editing, vim mode)
- **70+ configuration settings**
- **30+ environment variables**
- **9+ hook event types**
- **25+ MCP capabilities**
- **12+ IDE integration features**
- **10+ subagent features**
- **15+ session management features**
- **20+ input features**
- **25+ interactive UI elements**
- **10+ output/display features**

---

## Decision Tracking

| Category             | Total   | Supported | Skipped | Undecided |
| -------------------- | ------- | --------- | ------- | --------- |
| Input Features       | 20      | 0         | 0       | 0         |
| Session/Conversation | 17      | 0         | 0       | 0         |
| Multi-Agent/Tasks    | 19      | 0         | 0       | 0         |
| Interactive UI       | 23      | 0         | 0       | 0         |
| Slash Commands       | 53      | 0         | 0       | 0         |
| Keyboard Shortcuts   | 26      | 0         | 0       | 0         |
| Settings/Config      | 28      | 0         | 0       | 0         |
| MCP Integration      | 19      | 0         | 0       | 0         |
| Hooks System         | 17      | 0         | 0       | 0         |
| IDE Integrations     | 15      | 0         | 0       | 0         |
| Output/Display       | 15      | 0         | 0       | 0         |
| Other UI/UX          | 17      | 0         | 0       | 0         |
| **Total**            | **269** | **0**     | **0**   | **0**     |
