# Quick Actions SDK Implementation Plan

## Overview

Transform the hardcoded quick actions system into a user-extensible SDK that allows end users to write custom TypeScript quick actions with access to Anvil internals.

### Goals
1. Users can write TypeScript functions that execute as quick actions
2. Quick actions receive context (thread/plan info, state) and SDK services
3. User-defined quick actions are configurable via UI with hotkeys (Cmd+0-9)
4. Quick actions navigate horizontally (left/right arrows) instead of vertically
5. Actions have context awareness (show in "plan", "thread", or "empty" contexts)

## Architecture Overview

### Project-Based Quick Actions

Quick actions are organized into **user-managed projects** rather than individual scripts. Each project:
- Is a standalone directory with its own `package.json` and build configuration
- Can contain multiple quick actions
- Builds itself to vanilla JavaScript (no tsx runtime dependency)
- Exports a manifest of available actions

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri Frontend                            │
├──────────────────────────────────────────────────────────────────┤
│  Quick Actions UI (horizontal navigation, hotkey registration)   │
│                              │                                   │
│                              ▼                                   │
│  Quick Action Entity & Service (load/save/order)                 │
│                              │                                   │
│                              ▼                                   │
│  Quick Action Executor (spawn Node process on built JS)          │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Node.js Runtime (vanilla JS)                  │
├──────────────────────────────────────────────────────────────────┤
│  User's Pre-built Quick Action (dist/actions/*.js)               │
│  - Receives: QuickActionContext, AnvilSDK                         │
│  - Can call SDK methods (git, threads, plans, input)             │
│  - Returns: void or result object                                │
│                              │                                   │
│                              ▼                                   │
│  AnvilSDK (bundled with user's project or injected at runtime)    │
│  - GitService (via shell commands)                               │
│  - ThreadService (via filesystem)                                │
│  - PlanService (via filesystem)                                  │
│  - InputService (via stdout events → Tauri)                      │
└──────────────────────────────────────────────────────────────────┘
```

### Default Quick Actions Project Structure

Anvil initializes a single default project at `~/.anvil/quick-actions/` on first launch:

```
~/.anvil/quick-actions/                 # Default project (auto-initialized)
├── package.json                       # Pre-configured, ready to use
├── tsconfig.json                      # TypeScript config with SDK paths
├── build.ts                           # Build script that generates manifest
├── src/
│   └── actions/
│       ├── example.ts                 # Example action (ships with template)
│       ├── archive-and-next.ts        # User adds actions here
│       └── start-fresh.ts
├── dist/                              # Build output (created after npm run build)
│   ├── manifest.json                  # Generated manifest of actions
│   └── actions/
│       ├── example.js
│       ├── archive-and-next.js
│       └── start-fresh.js
├── node_modules/
│   └── @anvil/sdk/                     # SDK types (copied during init)
└── README.md                          # Documentation for writing actions
```

## Sub-Plans

This implementation is broken into the following sub-plans, each implementable by a single agent:

1. **[01-core-types.md](./01-core-types.md)** - Core type definitions and Zod schemas
2. **[02-sdk-types.md](./02-sdk-types.md)** - SDK type definitions for user-facing API
3. **[03-sdk-distribution.md](./03-sdk-distribution.md)** - SDK package files for distribution
4. **[04-sdk-runtime.md](./04-sdk-runtime.md)** - SDK runtime implementation and runner
5. **[05-entity-store.md](./05-entity-store.md)** - Quick actions entity, store, and service
6. **[06-executor.md](./06-executor.md)** - Quick action executor (Tauri side)
7. **[07-project-template.md](./07-project-template.md)** - Default project template files
8. **[08-bootstrap-init.md](./08-bootstrap-init.md)** - Bootstrap initialization and migrations
9. **[09-ui-components.md](./09-ui-components.md)** - UI components (panel, chips, settings)
10. **[10-hotkeys-input.md](./10-hotkeys-input.md)** - Hotkey registration and input store
11. **[11-drafts-entity.md](./11-drafts-entity.md)** - Draft persistence entity
12. **[12-default-actions.md](./12-default-actions.md)** - Default SDK-based actions

## Implementation Order

The sub-plans should be implemented in order, as later plans depend on earlier ones:

```
01-core-types ─────┐
                   ├──► 05-entity-store ──► 06-executor
02-sdk-types ──────┤
                   ├──► 03-sdk-distribution
                   │
                   └──► 04-sdk-runtime ──► 07-project-template ──► 08-bootstrap-init
                                                                          │
09-ui-components ◄────────────────────────────────────────────────────────┘
        │
        ├──► 10-hotkeys-input
        │
        └──► 11-drafts-entity

12-default-actions (can be done after 07-project-template)
```

## Parallel Execution Waves

Plans can be executed in parallel waves. Each wave must complete before the next begins:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ WAVE 1 (Foundation)                                                     │
│ ┌─────────────────┐  ┌─────────────────┐                                │
│ │ 01-core-types   │  │ 02-sdk-types    │  ← Run in parallel             │
│ └─────────────────┘  └─────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ WAVE 2 (SDK & Entity Layer)                                             │
│ ┌───────────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│ │ 03-sdk-distribution   │  │ 04-sdk-runtime  │  │ 05-entity-store │     │
│ └───────────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                                         │
│ ← All three can run in parallel                                         │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ WAVE 3 (Executor & Template)                                            │
│ ┌─────────────────┐  ┌───────────────────────┐                          │
│ │ 06-executor     │  │ 07-project-template   │  ← Run in parallel       │
│ └─────────────────┘  └───────────────────────┘                          │
│                                                                         │
│ 06 depends on 05-entity-store                                           │
│ 07 depends on 04-sdk-runtime                                            │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ WAVE 4 (Bootstrap & Default Actions)                                    │
│ ┌─────────────────────┐  ┌─────────────────────┐                        │
│ │ 08-bootstrap-init   │  │ 12-default-actions  │  ← Run in parallel     │
│ └─────────────────────┘  └─────────────────────┘                        │
│                                                                         │
│ Both depend on 07-project-template                                      │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ WAVE 5 (UI)                                                             │
│ ┌─────────────────────┐                                                 │
│ │ 09-ui-components    │  ← Depends on 08-bootstrap-init                 │
│ └─────────────────────┘                                                 │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ WAVE 6 (UI Extensions)                                                  │
│ ┌─────────────────────┐  ┌─────────────────────┐                        │
│ │ 10-hotkeys-input    │  │ 11-drafts-entity    │  ← Run in parallel     │
│ └─────────────────────┘  └─────────────────────┘                        │
│                                                                         │
│ Both depend on 09-ui-components                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Wave Summary

| Wave | Plans | Parallelism |
|------|-------|-------------|
| 1 | 01, 02 | 2 agents |
| 2 | 03, 04, 05 | 3 agents |
| 3 | 06, 07 | 2 agents |
| 4 | 08, 12 | 2 agents |
| 5 | 09 | 1 agent |
| 6 | 10, 11 | 2 agents |

**Total: 6 waves, max 3 parallel agents per wave**

## Design Decisions

See [design-decisions.md](./design-decisions.md) for the full list of architectural decisions.

## Storage Structure

```
~/.anvil/
├── quick-actions/                   # Default project (auto-initialized)
│   ├── package.json
│   ├── tsconfig.json
│   ├── build.ts
│   ├── src/
│   │   └── actions/
│   │       ├── example.ts           # Ships with template
│   │       └── my-action.ts         # User adds actions here
│   ├── dist/
│   │   ├── manifest.json            # Build output: action metadata
│   │   └── actions/
│   │       ├── example.js
│   │       └── my-action.js
│   └── node_modules/@anvil/sdk/      # SDK types
└── quick-actions-registry.json      # User overrides (hotkeys, order)
```
