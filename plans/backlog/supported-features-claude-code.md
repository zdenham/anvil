# Supported Features

Features selected for implementation from Claude Code feature parity analysis.

---

## Input Features

### File & Directory References

| Feature               | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| @ mentions            | Quick file path autocomplete and reference (`@file.js`, `@path/to/file`) |
| Directory references  | Reference directories with file listing (`@src/components`)              |
| Multi-file references | Reference multiple files in single prompt                                |

### Message Input

| Feature             | Description                           | Notes                         |
| ------------------- | ------------------------------------- | ----------------------------- |
| Multiline input     | `Option+Enter`, `Shift+Enter`         | No backslash escaping needed  |
| Paste mode          | Direct paste for code blocks and logs | Summary of paste is important |
| @ file autocomplete | Autocomplete works anywhere in input  |                               |

---

## Multi-Agent / Task Display

| Feature      | Description                        |
| ------------ | ---------------------------------- |
| Agent status | View active agents and their state |

---

## Interactive UI Elements

### Permission & Approval System

| Feature            | Description                                                                | Notes                             |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------- |
| Permission dialogs | Ask/approve for tool use                                                   |                                   |
| Permission modes   | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan`, `ignore` | May want more permissive defaults |
| Mode switching     | `Shift+Tab` to cycle through modes                                         |                                   |
| Auto-accept mode   | `⏵⏵ accept edits on` indicator                                             |                                   |

### Multiple Choice & Selection

| Feature              | Description                       |
| -------------------- | --------------------------------- |
| AskUserQuestion tool | Multiple choice questions to user |
| Multi-select         | Allow selecting multiple options  |

### Confirmations & Alerts

| Feature                      | Description                    | Notes                                   |
| ---------------------------- | ------------------------------ | --------------------------------------- |
| Permission prompts           | Confirm before executing tools |                                         |
| Edit diffs                   | Show changes before applying   | Different from CLI - explicit diff tool |
| Tool execution notifications | Visual feedback for tool use   | Already partially implemented           |

### Visual Display

| Feature               | Description                    |
| --------------------- | ------------------------------ |
| Code block formatting | Markdown rendering in terminal |
| Diff viewing          | Inline diffs with context      |

---

## Keyboard Shortcuts

### General Controls

| Shortcut              | Description                        | Notes                               |
| --------------------- | ---------------------------------- | ----------------------------------- |
| `Ctrl+C`              | Cancel current input or generation |                                     |
| `Left/Right arrows`   | Cycle through dialog tabs          |                                     |
| `Up/Down arrows`      | Navigate prompt history            | Prompt history, not command history |
| `Shift+Tab` / `Alt+M` | Toggle permission modes            |                                     |

### Multiline Input

| Shortcut       | Description   | Notes                          |
| -------------- | ------------- | ------------------------------ |
| `Option+Enter` | macOS default | `Shift+Enter` should also work |

---

## Output / Display Features

### Display Elements

| Element             | Description                                   |
| ------------------- | --------------------------------------------- |
| Code blocks         | Markdown-formatted with language highlighting |
| Diffs               | Side-by-side or unified diff format           |
| Error messages      | Clear error reporting with context            |
| Status messages     | Real-time status during execution             |
| Token counters      | Show token usage                              |
| Cost indicators     | Display approximate costs                     |
| Progress indicators | Spinners for long operations                  |
| Thinking blocks     | Extended thinking reasoning (verbose mode)    |

---

## Summary

**27 features** selected for support:

- **6** Input features (@ mentions, directory refs, multi-file, multiline, paste mode, autocomplete)
- **1** Multi-agent feature (agent status)
- **12** Interactive UI elements (permissions, dialogs, diffs, warnings)
- **5** Keyboard shortcuts (cancel, navigation, mode toggle, multiline)
- **8** Output/display elements (code blocks, diffs, status, indicators)
