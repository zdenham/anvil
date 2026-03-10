# Replace Welcome Page with Guide Page

## Summary

Replace the minimal "Welcome to Mort" empty pane content with a useful guide page that shows users how to use the app — keyboard shortcuts, features, permission modes, and core concepts.

## Context

The current `EmptyPaneContent` (`src/components/content-pane/empty-pane-content.tsx`) shows:

- "Welcome to Mort" heading
- "Type a message below to get started" subtext
- A `ThreadInputSection` pinned to the bottom

This is the default view when no thread/plan/terminal is selected (the `{ type: "empty" }` content pane view). We want to replace the centered welcome text with a scrollable guide, while keeping the input section at the bottom.

## Design

The guide content should appear **above the input** in the empty pane, replacing the centered "Welcome to Mort" text. It should be scrollable and styled consistently with the app's `surface-*` color palette.

### Content Sections

**1. Getting Started**

- Brief description of Mort: orchestrate parallel Claude Code agents from your desktop
- Mention the Spotlight bar for quick access from anywhere

**2. Keyboard Shortcuts**

| Shortcut | Action |
| --- | --- |
| `⌘ Space` | Open Spotlight (global, configurable) |
| `⌘ N` | New thread |
| `⌘ T` | New terminal |
| `⌘ P` | Command palette |
| `⌘ W` | Close tab |
| `⌘ ⇧ F` | Search across files |
| `⌘ F` | Find in page |
| `⌘ ⇧ D` | Toggle debug panel |
| `⌘ 0-9` | Quick actions |

**3. Permission Modes**

Explain the three modes available when creating threads:

- **Implement** — All tools auto-approved. Agent works autonomously.
- **Plan** — Read everything, write only to `plans/`. For architecture and design.
- **Approve** — Read/Bash auto-approved, file edits require your approval with diff preview.

Mention how to cycle between modes using the mode selector in the input bar.

**4. Core Concepts**

- **Threads** — Conversations with Claude Code agents that run in your repo
- **Worktrees** — Isolated git branches for parallel work without conflicts
- **Plans** — Markdown documents for designing before implementing
- **Terminals** — Integrated terminal sessions tied to worktrees
- **Quick Actions** — Scriptable automations bound to `⌘ 0-9` (configurable in Settings)

**5. Tips**

- `⌘ Click` or middle-click sidebar items to open in a new tab
- Use the command palette (`⌘ P`) to quickly find threads, plans, and files
- Quick actions appear in the bottom gutter bar

## Phases

- [x] Create guide content component with all sections

- [x] Replace welcome text in `EmptyPaneContent` with the guide component

- [x] Style the guide to be scrollable, with muted/subtle presentation that doesn't compete with the input

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Implementation Details

### Files to modify

1. `src/components/content-pane/empty-pane-content.tsx` — Replace the centered welcome `<div>` with the new guide component. Keep the `ThreadInputSection` at the bottom unchanged.

2. **New:** `src/components/content-pane/guide-content.tsx` — Extracted component for the guide content. Should be a simple, static presentational component with no state/effects. Keep it under 250 lines per codebase conventions.

### Styling approach

- Use existing Tailwind classes (`text-surface-*`, `bg-surface-*`, `border-surface-*`)
- Guide should be `overflow-y-auto` to scroll independently of the input
- Use `font-mono` for shortcut keys, styled as inline `<kbd>` elements
- Section headings in `text-surface-200`, body text in `text-surface-400`
- Keep spacing generous — this is a reference page, not a wall of text
- Subtle section dividers using `border-surface-700/50`

### What NOT to change

- The `ThreadInputSection` at the bottom stays as-is
- The `{ type: "empty" }` view type — no new ContentPaneView variant needed
- The onboarding flow (`OnboardingFlow`, `WelcomeStep`) — these are separate and untouched
- No new routes, stores, or services needed