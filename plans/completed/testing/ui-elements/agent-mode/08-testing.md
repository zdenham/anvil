# Sub-Plan 08: Testing

## Overview
Comprehensive testing plan covering unit tests, UI tests, and manual testing for the entire agent mode feature.

## Dependencies
- All other sub-plans (01-07) must be complete for full test coverage

## Can Run In Parallel With
- Individual test files can be written in parallel with their corresponding implementation sub-plans
- Manual testing requires all sub-plans complete

## Scope
- Unit tests for types and store
- UI isolation tests for components
- Integration tests for agent argument parsing
- Manual testing checklist
- Edge case testing

## Test Files Summary

| File | Type | Lines | Covers |
|------|------|-------|--------|
| `src/entities/agent-mode/types.test.ts` | Unit | ~30 | getNextMode, AGENT_MODE_ORDER |
| `src/entities/agent-mode/store.test.ts` | Unit | ~100 | All store methods |
| `src/components/simple-task/mode-indicator.ui.test.tsx` | UI | ~100 | ModeIndicator variants, interactions, a11y |
| `src/components/simple-task/use-mode-keyboard.ui.test.tsx` | UI | ~100 | Keyboard hook behavior |
| `src/components/simple-task/simple-task-header.ui.test.tsx` | UI | ~60 | Header integration |
| `src/components/reusable/thread-input.ui.test.tsx` | UI | ~120 | Input integration |

## Edge Cases to Test

### Store Edge Cases
- [ ] Thread ID with special characters (ensure no key issues)
- [ ] Calling `clearThreadMode` multiple times on same thread
- [ ] Calling `cycleMode` immediately after `setDefaultMode`
- [ ] Store behavior with empty string threadId

### UI Edge Cases
- [ ] Rapid repeated Shift+Tab (debounce behavior if needed)
- [ ] Shift+Tab while trigger dropdown is open (should not conflict)
- [ ] Mode indicator with very long custom labels (layout)
- [ ] Screen reader announcement when mode changes

### Integration Edge Cases
- [ ] Mode state when thread is deleted
- [ ] Mode state when switching between windows
- [ ] Mode indication when agent is streaming (disabled state)
- [ ] Mode change during streaming (should be disabled)

## Manual Testing Checklist

### Basic Functionality
- [ ] Open simple task window
- [ ] Verify indicator shows "Normal" by default (gray)
- [ ] Press Shift+Tab in input - should cycle to "Plan" (blue)
- [ ] Press Shift+Tab again - should cycle to "Auto" (green)
- [ ] Press Shift+Tab again - should cycle back to "Normal"

### Header Indicator
- [ ] Click indicator in header - should also cycle modes
- [ ] Verify clicking while streaming is disabled
- [ ] Verify header shows same mode as input indicator

### Agent Integration
- [ ] Submit a prompt with "Normal" mode - verify agent behavior
- [ ] Submit a prompt with "Plan" mode - verify agent plans only
- [ ] Submit a prompt with "Auto-Accept" mode - verify auto-approval

### Multi-Thread
- [ ] Open different thread - verify mode is independent
- [ ] Switch back to first thread - verify mode is remembered
- [ ] Close and reopen window - verify mode resets (not persisted)

## Verification Commands

```bash
# Type checking
pnpm tsc --noEmit

# Unit tests
pnpm test src/entities/agent-mode

# UI tests
pnpm test:ui src/components/simple-task/mode-indicator
pnpm test:ui src/components/simple-task/use-mode-keyboard
pnpm test:ui src/components/simple-task/simple-task-header
pnpm test:ui src/components/reusable/thread-input

# All tests
pnpm test
pnpm test:ui
```

## Estimated Time
- Writing tests: ~2-3 hours (can be done in parallel with implementation)
- Running tests: ~5 minutes
- Manual testing: ~15 minutes
