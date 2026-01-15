# Permission UI Implementation - Sub-Plans

This directory contains sub-plans for implementing the Permission UI feature, broken down for parallel execution.

## Overview

The Permission UI allows users to approve or deny tool uses when Claude requests permission. It supports two display modes:
- **Modal**: Centered dialog with backdrop (interrupts workflow)
- **Inline**: Embedded in thread view (non-blocking, vim-style navigation)

## Sub-Plan Dependency Graph

```
01-core-types
    |
    +---> 02-zustand-store
    |         |
    |         +---> 05-permission-service ---> 06-event-listeners
    |         |            |
    |         +------------+---> 08-ui-keyboard-hook
    |                      |
    +---> 03-agent-handler |
    |                      |
    +---> 04-agent-service-stdin
                           |
07-ui-input-display -------+
                           |
                           +---> 09-ui-modal-component
                           |
                           +---> 10-ui-inline-component
                           |
                           +---> 11-ui-main-component
                                        |
                                        v
                                 12-integration
```

## Dependency Table

| Sub-Plan | Depends On | Provides |
|----------|------------|----------|
| **01-core-types** | None | `PermissionRequest`, `PermissionStatus`, `PermissionMode`, `PermissionDisplayMode`, `isDangerousTool`, `isWriteTool`, event types |
| **02-zustand-store** | 01 | `usePermissionStore` |
| **03-agent-handler** | 01 | `initPermissionHandler`, `shouldRequestPermission`, `requestPermission`, `cleanupPermissionHandler` |
| **04-agent-service-stdin** | 01 | `sendPermissionResponse`, `hasAgentProcess` |
| **05-permission-service** | 02, 04 | `permissionService` |
| **06-event-listeners** | 01, 02 | `setupPermissionListeners` |
| **07-ui-input-display** | None | `PermissionInputDisplay` |
| **08-ui-keyboard-hook** | 02, 05 | `usePermissionKeyboard` |
| **09-ui-modal-component** | 01, 02, 05, 07 | `PermissionModal` |
| **10-ui-inline-component** | 01, 05, 07 | `PermissionInline` |
| **11-ui-main-component** | 02, 08, 09, 10 | `PermissionUI` |
| **12-integration** | All | Settings integration, SimpleTaskWindow integration |

## Parallel Execution Groups

### Group 1 (Can start immediately, in parallel)
- **01-core-types.md** - Foundation types and events
- **07-ui-input-display.md** - Pure presentational component

### Group 2 (After Group 1, in parallel)
- **02-zustand-store.md** - Depends on 01
- **03-agent-handler.md** - Depends on 01
- **04-agent-service-stdin.md** - Depends on 01

### Group 3 (After Group 2, in parallel)
- **05-permission-service.md** - Depends on 02, 04
- **06-event-listeners.md** - Depends on 01, 02

### Group 4 (After Group 3, in parallel)
- **08-ui-keyboard-hook.md** - Depends on 02, 05
- **09-ui-modal-component.md** - Depends on 02, 05, 07
- **10-ui-inline-component.md** - Depends on 05, 07

### Group 5 (After Group 4)
- **11-ui-main-component.md** - Depends on 02, 08, 09, 10

### Group 6 (Final)
- **12-integration.md** - Depends on all previous

## Estimated Total Time

| Sub-Plan | Time Estimate |
|----------|---------------|
| 01-core-types | 15-20 min |
| 02-zustand-store | 30-40 min |
| 03-agent-handler | 45-60 min |
| 04-agent-service-stdin | 20-30 min |
| 05-permission-service | 20-30 min |
| 06-event-listeners | 25-35 min |
| 07-ui-input-display | 15-20 min |
| 08-ui-keyboard-hook | 30-40 min |
| 09-ui-modal-component | 30-40 min |
| 10-ui-inline-component | 35-45 min |
| 11-ui-main-component | 15-20 min |
| 12-integration | 30-45 min |
| **Total (sequential)** | **5-7 hours** |
| **Total (parallel)** | **~3 hours** |

## Verification Commands

### After each sub-plan:
```bash
pnpm tsc --noEmit
```

### After store/service/listener plans:
```bash
pnpm test -- src/entities/permissions/
```

### After UI component plans:
```bash
pnpm test:ui -- src/components/permission/
```

### After agent handler:
```bash
pnpm --filter agents typecheck
pnpm --filter agents test -- permission
```

### Final verification:
```bash
pnpm tauri dev
# Manual testing per 12-integration.md checklist
```

## Quick Reference: Files by Sub-Plan

| Sub-Plan | New Files | Modified Files |
|----------|-----------|----------------|
| 01 | core/types/permissions.ts | core/types/events.ts |
| 02 | src/entities/permissions/store.ts, types.ts | - |
| 03 | agents/src/permissions/*.ts | agents/src/runners/shared.ts, types.ts |
| 04 | - | src/lib/agent-service.ts |
| 05 | src/entities/permissions/service.ts | - |
| 06 | src/entities/permissions/listeners.ts, index.ts | src/lib/event-bridge.ts, src/entities/index.ts |
| 07 | src/components/permission/permission-input-display.tsx | - |
| 08 | src/components/permission/use-permission-keyboard.ts | - |
| 09 | src/components/permission/permission-modal.tsx | - |
| 10 | src/components/permission/permission-inline.tsx | - |
| 11 | src/components/permission/permission-ui.tsx, index.ts | - |
| 12 | - | src/components/simple-task/simple-task-window.tsx, src/entities/settings/types.ts, store.ts |
