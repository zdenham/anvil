# Disable Spotlight Shortcut via macOS Accessibility API

## Overview

Implement a Rust-native solution using the macOS Accessibility API (AXUIElement) to disable the system Spotlight shortcut (Cmd+Space) programmatically. This replaces the fragile AppleScript approach.

## Problem

The current AppleScript approach is fragile:
- SwiftUI accessibility labels are not exposed to AppleScript
- Must iterate through all sidebar rows checking right pane content
- Slow and prone to breaking with macOS updates

## Solution

Use AXUIElement API to:
1. Navigate System Settings programmatically
2. Find UI elements by their accessibility labels directly
3. Disable the Spotlight shortcut via button in onboarding + CLI

## Phase Dependencies

```
Phase 1 (Accessibility Bindings)
    │
    ▼
Phase 2 (System Settings Navigator)
    │
    ▼
Phase 3 (Spotlight Disabler)
    │
    ├──────────────────┬──────────────────┐
    ▼                  ▼                  ▼
Phase 4            Phase 5            Phase 6
(Tauri Commands)   (mort-test CLI)    (SpotlightStep UI)
    │                  │                  │
    └──────────────────┴──────────────────┘
                       │
                       ▼
                  Phase 7
            (Permission Handling)
```

## Phases

| Phase | File | Description | Can Parallelize After |
|-------|------|-------------|----------------------|
| 1 | `phase-1-accessibility-bindings.md` | AXUIElement Rust bindings | - |
| 2 | `phase-2-system-settings-navigator.md` | System Settings navigation helper | Phase 1 |
| 3 | `phase-3-spotlight-disabler.md` | Core disable logic | Phase 2 |
| 4 | `phase-4-tauri-commands.md` | Tauri command wrappers | Phase 3 |
| 5 | `phase-5-mort-test-cli.md` | CLI testing commands | Phase 3 |
| 6 | `phase-6-spotlight-step-ui.md` | Onboarding UI button | Phase 4 |
| 7 | `phase-7-permission-handling.md` | Accessibility permission flow | Phase 4, 5, 6 |

## Execution Strategy

**Sequential (safest):** Execute phases 1 → 2 → 3 → 4 → 5 → 6 → 7

**Parallel (faster):**
1. Execute phases 1 → 2 → 3 sequentially (core Rust work)
2. Then execute 4, 5, 6 in parallel (all depend only on phase 3)
3. Execute phase 7 last (polish)

## Success Criteria

- [ ] `mort-test disable-spotlight --dry-run` reports shortcut status
- [ ] `mort-test disable-spotlight` successfully disables the shortcut
- [ ] `mort-test check-accessibility` reports permission status
- [ ] SpotlightStep.tsx has working "Auto-disable" button
- [ ] Works on macOS 13, 14, 15
- [ ] Graceful fallback when permission denied
