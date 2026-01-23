# Subplan 1C: Listeners & Events

**Priority**: Tier 1 - Can run in parallel with 1A and 1B
**Estimated Files**: 1-2
**Dependencies**: Subplan 0 (Core Types & Store)

## Overview

Update event listeners and event payloads to use UUID instead of repository name.

## Files to Modify

### 1. `src/entities/repositories/listeners.ts`

Update all event handlers that reference repositories by name:

```typescript
// Before:
repositories[name] = ...

// After:
repositories[id] = ...
```

Review all event handler callbacks for:
- Direct store access patterns
- Event payload destructuring that expects `name`
- Any `_applyCreate`, `_applyUpdate`, `_applyDelete` calls

### 2. Event Payload Review

Check if events currently emit repository `name` and need to emit `id` instead:

**Potential event types to audit:**
- Repository created
- Repository updated
- Repository deleted
- Repository renamed

**Payload change pattern:**
```typescript
// Before:
emit('repo:created', { name: 'my-project', ... });

// After:
emit('repo:created', { id: 'uuid-here', name: 'my-project', ... });
```

Consider including both `id` and `name` in payloads during transition for easier debugging.

## Key Questions to Resolve

1. What events currently include repository identifiers?
2. Do any external systems (Rust backend, IPC) depend on repository name in events?
3. Should events include both `id` and `name` or just `id`?

## Verification

After completing this subplan:
- [ ] All listener handlers use UUID for store access
- [ ] Event payloads include repository UUID
- [ ] No listeners break when receiving UUID-based events
- [ ] Rust backend event integration still works (if applicable)

## Parallel With

- Subplan 1A: Service Layer
- Subplan 1B: Hooks & Utils

## Risk Notes

This subplan has the highest risk of breaking cross-system communication. Test thoroughly with:
- Frontend-only events
- Tauri IPC events
- Any external event consumers
