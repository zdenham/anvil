# E2E Test IDs Audit & Implementation Plan

Set up `data-testid` attributes across all components and maintain an index for writing Rust-driven E2E UI tests.

## Phases

- [x] Add test IDs to high-priority components (core workflows)
- [x] Add test IDs to medium-priority components (common features)
- [x] Add test IDs to low-priority components (polish/secondary)
- [x] Create test ID index file (`src/test/test-ids.ts`) as single source of truth

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Existing Test IDs

These are already in the codebase and should be preserved as-is:

| Component | Test ID Pattern | File |
|-----------|----------------|------|
| Spotlight container | `spotlight` | spotlight.tsx |
| Spotlight input | `spotlight-input` | spotlight.tsx |
| Spotlight results | `spotlight-results` | results-tray.tsx |
| Spotlight result item | `spotlight-result-${index}` | results-tray.tsx |
| Thread panel | `thread-panel` | thread-view.tsx |
| Message list | `message-list` | message-list.tsx |
| Turn/message | `message-${turnIndex}` | turn-renderer.tsx |
| Tool use wrapper | `tool-use-${id}` | tool-use-block.tsx |
| Bash tool | `bash-tool-${id}` | bash-tool-block.tsx |
| Edit tool | `edit-tool-${id}` | edit-tool-block.tsx |
| Write tool | `write-tool-${id}` | write-tool-block.tsx |
| Glob tool | `glob-tool-${id}` | glob-tool-block.tsx |
| Grep tool | `grep-tool-${id}` | grep-tool-block.tsx |
| LSP tool | `lsp-tool-${id}` | lsp-tool-block.tsx |
| Task tool | `task-tool-${id}` | task-tool-block.tsx |
| TaskOutput tool | `taskoutput-tool-${id}` | taskoutput-tool-block.tsx |
| TaskStop tool | `taskstop-tool-${id}` | taskstop-tool-block.tsx |
| KillShell tool | `killshell-tool-${id}` | killshell-tool-block.tsx |
| Skill tool | `skill-tool-${id}` | skill-tool-block.tsx |
| ExitPlanMode tool | `exitplanmode-tool-${id}` | exitplanmode-tool-block.tsx |
| Web Search tool | `web-search-tool-${id}` | web-search-tool-block.tsx |
| Web Fetch tool | `webfetch-tool-${id}` | web-fetch-tool-block.tsx |
| Notebook Edit tool | `notebook-edit-tool-${id}` | notebook-edit-tool-block.tsx |
| Sub-agent ref | `sub-agent-reference-${childThreadId}` | sub-agent-reference-block.tsx |
| Ask user question | `ask-user-question-${id}` | ask-user-question-block.tsx |
| Question carousel | `question-carousel-${id}` | question-carousel.tsx |
| Option item | `option-item-${index}` | option-item.tsx |
| Permission prompt | `permission-prompt-${requestId}` | permission-inline.tsx |
| Plan tab states | `plan-empty-state`, `plan-loading-state`, `plan-error-state`, `plan-not-found-state`, `plan-content` | plan-tab.tsx |
| Hotkey recorder | `hotkey-recorder`, `hotkey-recorder-overlay`, `modifier-${mod}`, `hotkey-key`, `hotkey-recorder-status` | HotkeyRecorder.tsx |
| Loading spinner | `loading-spinner` | loading-state.tsx |
| Error message | `error-message` | error-state.tsx |
| Empty state | `empty-state` | empty-state.tsx, diff-empty-state.tsx |
| Inline diff block | `${testId}` (passed in) | inline-diff-block.tsx |
| Collapsible block | `${testId}` (passed in) | collapsible-block.tsx |

---

## Test IDs To Add (Prioritized)

### Priority 1 — Core Workflows (High)

These cover the primary user journeys: submitting prompts, navigating threads, using spotlight, and handling permissions.

| # | Test ID | Element | Component File | Why |
|---|---------|---------|---------------|-----|
| 1 | `thread-input` | Prompt textarea | `thread-input.tsx` | Core: where users type prompts |
| 2 | `submit-prompt-button` | Submit/send button | `thread-input.tsx` | Core: submitting prompts |
| 3 | `tree-menu` | Left sidebar tree container | `tree-menu.tsx` | Core: primary navigation |
| 4 | `tree-section-threads` | Threads section | `tree-menu.tsx` | Core: thread list section |
| 5 | `tree-section-plans` | Plans section | `tree-menu.tsx` | Core: plan list section |
| 6 | `tree-section-terminals` | Terminals section | `tree-menu.tsx` | Core: terminal list section |
| 7 | `tree-section-prs` | PRs section | `tree-menu.tsx` | Core: PR list section |
| 8 | `thread-item-${threadId}` | Individual thread row | `thread-item.tsx` | Core: selecting threads |
| 9 | `plan-item-${planId}` | Individual plan row | `plan-item.tsx` | Core: selecting plans |
| 10 | `terminal-item-${sessionId}` | Individual terminal row | `terminal-item.tsx` | Core: selecting terminals |
| 11 | `permission-approve-button` | Approve button | `permission-inline.tsx` | Core: permission flow |
| 12 | `permission-deny-button` | Deny button | `permission-inline.tsx` | Core: permission flow |
| 13 | `control-panel` | Control panel container | `control-panel-window.tsx` | Core: floating panel |
| 14 | `control-panel-header` | Panel header (tabs/status) | `control-panel-header.tsx` | Core: panel navigation |
| 15 | `control-panel-tab-thread` | Thread tab button | `control-panel-header.tsx` | Core: switching views |
| 16 | `control-panel-tab-changes` | Changes tab button | `control-panel-header.tsx` | Core: switching views |
| 17 | `control-panel-tab-plan` | Plan tab button | `control-panel-header.tsx` | Core: switching views |
| 18 | `agent-status` | Agent running/idle/error status | `control-panel-header.tsx` or status display | Core: knowing agent state |
| 19 | `content-pane` | Active content pane | `content-pane.tsx` | Core: main content area |
| 20 | `main-layout` | Top-level three-panel layout | `main-window-layout.tsx` | Core: app structure |

### Priority 2 — Thread Interaction (High)

These cover interacting with thread content: reading messages, viewing tool outputs, handling questions.

| # | Test ID | Element | Component File | Why |
|---|---------|---------|---------------|-----|
| 21 | `assistant-message-${turnIndex}` | Assistant message text block | `assistant-message.tsx` | Reading AI responses |
| 22 | `user-message-${turnIndex}` | User message block | `turn-renderer.tsx` | Verifying user input display |
| 23 | `code-block` | Code block container | `code-block.tsx` | Code output display |
| 24 | `copy-button` | Copy-to-clipboard button | `copy-button.tsx` | Copying code/text |
| 25 | `inline-diff-header` | Diff header (file path, accept/reject) | `inline-diff-header.tsx` | Diff navigation |
| 26 | `inline-diff-accept` | Accept diff button | `inline-diff-header.tsx` | Accepting changes |
| 27 | `inline-diff-reject` | Reject diff button | `inline-diff-header.tsx` | Rejecting changes |
| 28 | `bash-output-${id}` | Bash command output area | `bash-tool-block.tsx` | Viewing command results |
| 29 | `bash-kill-button-${id}` | Kill running bash button | `bash-tool-block.tsx` | Stopping commands |
| 30 | `status-announcement` | Thread status banner (running/idle/error) | `status-announcement.tsx` | Thread state feedback |

### Priority 3 — Changes & Diff Viewer (Medium-High)

These cover the PR/changes review workflow.

| # | Test ID | Element | Component File | Why |
|---|---------|---------|---------------|-----|
| 31 | `changes-view` | Changes view container | `changes-view.tsx` | Reviewing changes |
| 32 | `changes-diff-content` | Diff content area | `changes-diff-content.tsx` | Viewing file diffs |
| 33 | `diff-file-card-${filePath}` | Individual file diff card | `diff-file-card.tsx` | Per-file review |
| 34 | `diff-file-header-${filePath}` | File header (name + status) | `file-header.tsx` | File identification |
| 35 | `comment-gutter-button-${line}` | Add comment on line button | `comment-gutter-button.tsx` | Adding inline comments |
| 36 | `inline-comment-form` | Comment input form | `inline-comment-form.tsx` | Writing comments |
| 37 | `inline-comment-${commentId}` | Displayed comment | `inline-comment-display.tsx` | Reading comments |
| 38 | `address-comments-button` | Address all comments button | `address-comments-button.tsx` | Batch comment addressing |
| 39 | `floating-address-button` | Floating address button | `floating-address-button.tsx` | Quick comment addressing |
| 40 | `find-bar` | Search within diff/file | `find-bar.tsx` | In-file search |
| 41 | `find-bar-input` | Find bar text input | `find-bar.tsx` | Search input |
| 42 | `find-bar-next` | Find next match | `find-bar.tsx` | Search navigation |
| 43 | `find-bar-prev` | Find previous match | `find-bar.tsx` | Search navigation |

### Priority 4 — Search & Command Palette (Medium)

| # | Test ID | Element | Component File | Why |
|---|---------|---------|---------------|-----|
| 44 | `search-panel` | Search panel container | `search-panel.tsx` | Global search |
| 45 | `search-input` | Search text input | `search-controls.tsx` | Typing search queries |
| 46 | `search-results` | Search results list | `search-panel.tsx` | Viewing results |
| 47 | `search-result-${index}` | Individual result | `search-panel.tsx` | Selecting results |
| 48 | `command-palette` | Command palette overlay | `command-palette.tsx` | Cmd+P palette |
| 49 | `command-palette-input` | Command palette input | `command-palette.tsx` | Typing commands |
| 50 | `command-palette-item-${index}` | Command palette item | `command-palette.tsx` | Selecting commands |

### Priority 5 — Content Pane Details (Medium)

| # | Test ID | Element | Component File | Why |
|---|---------|---------|---------------|-----|
| 51 | `content-pane-header` | Pane header bar | `content-pane-header.tsx` | Pane controls |
| 52 | `close-pane-button` | Close pane X button | `content-pane-header.tsx` | Closing panes |
| 53 | `pop-out-button` | Pop-out to control panel button | `content-pane-header.tsx` | Popping out threads |
| 54 | `file-content` | File viewer content area | `file-content.tsx` | Viewing files |
| 55 | `terminal-content` | Terminal emulator area | `terminal-content.tsx` | Terminal interaction |
| 56 | `plan-content-pane` | Plan markdown view (main window) | `plan-content.tsx` | Viewing plans |
| 57 | `pr-content` | PR view container | `pull-request-header.tsx` | PR display |
| 58 | `pr-checks-section` | PR checks status | `pr-checks-section.tsx` | CI status |
| 59 | `context-meter` | Token usage meter | `context-meter.tsx` | Context tracking |
| 60 | `breadcrumb` | Navigation breadcrumb | `breadcrumb.tsx` | Location display |

### Priority 6 — Tree Menu Details (Medium)

| # | Test ID | Element | Component File | Why |
|---|---------|---------|---------------|-----|
| 61 | `tree-panel-header` | Header with settings/logs/archive buttons | `tree-panel-header.tsx` | Top-level nav |
| 62 | `settings-button` | Settings gear button | `tree-panel-header.tsx` | Opening settings |
| 63 | `logs-button` | Logs button | `tree-panel-header.tsx` | Opening logs |
| 64 | `archive-button` | Archive button | `tree-panel-header.tsx` | Opening archive |
| 65 | `pr-item-${prId}` | Individual PR row | `pull-request-item.tsx` | Selecting PRs |
| 66 | `commit-item-${sha}` | Individual commit row | `commit-item.tsx` | Viewing commits |
| 67 | `uncommitted-item` | Uncommitted changes item | `uncommitted-item.tsx` | Viewing working changes |
| 68 | `repo-worktree-section-${repo}` | Repo/worktree section header | `repo-worktree-section.tsx` | Multi-repo nav |
| 69 | `menu-dropdown` | Context dropdown menu | `menu-dropdown.tsx` | Section actions |
| 70 | `status-legend` | Thread status legend | `status-legend.tsx` | Status reference |

### Priority 7 — Settings (Medium-Low)

| # | Test ID | Element | Component File | Why |
|---|---------|---------|---------------|-----|
| 71 | `settings-view` | Settings page container | `settings-page.tsx` | Settings root |
| 72 | `settings-section-${name}` | Settings section | `settings-section.tsx` | Section grouping |
| 73 | `hotkey-settings` | Hotkey configuration area | `hotkey-settings.tsx` | Hotkey config |
| 74 | `hotkey-input-${action}` | Individual hotkey input | `hotkey-settings.tsx` | Per-action hotkey |
| 75 | `repository-settings` | Repository list | `repository-settings.tsx` | Repo management |
| 76 | `add-repository-button` | Add repo button | `repository-settings.tsx` | Adding repos |
| 77 | `repo-item-${path}` | Individual repo row | `repository-settings.tsx` | Repo identification |
| 78 | `skills-settings` | Skills list | `skills-settings.tsx` | Skill management |
| 79 | `skill-item-${name}` | Individual skill row | `skill-list-item.tsx` | Skill toggling |
| 80 | `about-settings` | About section | `about-settings.tsx` | Version info |
| 81 | `quick-actions-settings` | Quick actions config | `quick-actions-settings.tsx` | Action management |
| 82 | `quick-action-item-${key}` | Individual quick action | `quick-action-list-item.tsx` | Action editing |
| 83 | `quick-action-edit-modal` | Action edit modal | `quick-action-edit-modal.tsx` | Modal interaction |

### Priority 8 — Onboarding (Low)

| # | Test ID | Element | Component File | Why |
|---|---------|---------|---------------|-----|
| 84 | `onboarding-flow` | Onboarding container | `OnboardingFlow.tsx` | First-run flow |
| 85 | `onboarding-step-welcome` | Welcome step | `WelcomeStep.tsx` | Welcome screen |
| 86 | `onboarding-step-repository` | Repository step | `RepositoryStep.tsx` | Repo selection |
| 87 | `onboarding-step-hotkey` | Hotkey step | `HotkeyStep.tsx` | Hotkey setup |
| 88 | `onboarding-step-spotlight` | Spotlight step | `SpotlightStep.tsx` | Spotlight intro |
| 89 | `onboarding-step-permissions` | Permissions step | `PermissionsStep.tsx` | Permissions grant |
| 90 | `onboarding-next-button` | Next/continue button | various steps | Step progression |
| 91 | `permissions-prompt` | Accessibility permissions dialog | `PermissionsPrompt.tsx` | Permission grant |

### Priority 9 — Secondary UI (Low)

| # | Test ID | Element | Component File | Why |
|---|---------|---------|---------------|-----|
| 92 | `debug-panel` | Debug panel container | `debug-panel.tsx` | Debug info |
| 93 | `event-list` | Debug event list | `event-list.tsx` | Event inspection |
| 94 | `event-detail` | Debug event detail | `event-detail.tsx` | Event detail view |
| 95 | `logs-toolbar` | Log filter toolbar | `logs-toolbar.tsx` | Log filtering |
| 96 | `logs-level-filter-${level}` | Log level filter button | `logs-toolbar.tsx` | Level filtering |
| 97 | `clipboard-manager` | Clipboard manager overlay | `clipboard-manager.tsx` | Clipboard history |
| 98 | `error-panel` | Error panel | `error-panel.tsx` | Error display |
| 99 | `global-toast` | Toast notification | `global-toast.tsx` | Notifications |
| 100 | `build-mode-indicator` | Dev/prod mode badge | `BuildModeIndicator.tsx` | Build mode |
| 101 | `resize-handle-horizontal` | Horizontal panel resize | `resizable-panel.tsx` | Panel resizing |
| 102 | `resize-handle-vertical` | Vertical panel resize | `resizable-panel-vertical.tsx` | Panel resizing |
| 103 | `network-debugger` | Network debugger panel | `network-debugger.tsx` | Network inspection |
| 104 | `archive-view` | Archived items list | `archive-view.tsx` | Archive browsing |

---

## Naming Conventions

All test IDs should follow these rules:

1. **Static IDs**: `kebab-case` — e.g. `tree-menu`, `submit-prompt-button`
2. **Dynamic IDs**: `kebab-case-${identifier}` — e.g. `thread-item-${threadId}`, `diff-file-card-${filePath}`
3. **Prefix by area**: group related IDs with a shared prefix:
   - `tree-*` — tree menu elements
   - `control-panel-*` — control panel elements
   - `diff-*` — diff viewer elements
   - `search-*` — search panel elements
   - `settings-*` — settings elements
   - `onboarding-*` — onboarding elements
4. **No test IDs on purely decorative elements** (icons, dividers, spacers)
5. **Prefer stable identifiers** in dynamic IDs (thread IDs, file paths) over array indices

## Test ID Index File

Create `src/test/test-ids.ts` as a single source of truth:

```ts
/**
 * Central index of all data-testid values used in the app.
 * Components should import from here rather than hardcoding strings.
 * E2E tests reference these same constants.
 */
export const TEST_IDS = {
  // Layout
  mainLayout: 'main-layout',
  contentPane: 'content-pane',

  // Tree menu
  treeMenu: 'tree-menu',
  treeSection: (name: string) => `tree-section-${name}`,
  threadItem: (id: string) => `thread-item-${id}`,
  // ... etc
} as const;
```

Components import from the index, Rust E2E tests reference the same file (or a generated JSON export) so IDs stay in sync.
