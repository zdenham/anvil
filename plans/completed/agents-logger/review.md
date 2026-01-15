# Agents Logger Plan - Consolidated Review

## Executive Summary

Five sub-agents reviewed each plan document in the `agents-logger/` directory. The overall assessment is that these plans are **well-designed but largely already implemented**, with one **critical bug** that needs immediate attention.

### Key Findings

| Finding | Severity | Status |
|---------|----------|--------|
| `events.ts` double-wrapping bug | Critical | Action Required |
| Plans appear already implemented | Info | Needs Status Update |
| Core package dual-context logging needs decision | Medium | Needs Clarification |
| Missing exception clauses in migration plans | Low | Documentation Gap |

---

## Critical Issue: events.ts Protocol Bug

The current `agents/src/lib/events.ts` implementation has a significant bug:

```typescript
// Current (BROKEN)
export function emitEvent(event: string, payload: Record<string, unknown> = {}): void {
  logger.info(JSON.stringify({ type: "event", event, payload }));
}
```

This produces double-wrapped JSON:
```json
{"type":"log","level":"INFO","message":"{\"type\":\"event\",\"event\":\"task:updated\",\"payload\":{...}}"}
```

The plan specifies it should be:
```typescript
// Correct
export function emitEvent(event: string, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ type: "event", event, payload }));
}
```

**Impact**: The frontend would receive events wrapped in log messages, breaking the protocol design.

---

## Plan-by-Plan Review

### 00-overview.md

**Summary**: Master document outlining the parallel execution strategy for 4 subplans to create a unified stdout protocol between agents and frontend.

**Strengths**:
- Well-structured parallel execution graph
- Clear dependency identification
- Clean three-type protocol design (`log`, `event`, `state`)

**Concerns**:
- No rollback plan for partial failures
- Verification steps are light (no unit/integration test requirements)
- The parallel execution may be overkill given the small scope

**Questions**:
- What is the timeline/urgency for this migration?
- How should non-JSON stderr be handled (e.g., third-party library warnings)?

---

### 01-logger-infrastructure.md

**Summary**: Create/update logging and event infrastructure in agents package with structured JSON output.

**Status**: Appears **already implemented**:
- `logger.ts` outputs structured JSON with `type: "log"`
- `events.ts` exists (with the bug noted above)
- `output.ts` includes `type: "state"` in `emitState()`
- `lib/index.ts` exports events module

**Concerns**:
- Critical bug in `events.ts` (uses `logger.info` instead of `console.log`)
- Missing timestamps in log messages
- No log context/correlation mechanism (threadId, taskSlug)
- No runtime validation of event names

**Suggestions**:
- Fix `events.ts` to use `console.log()` directly
- Consider adding timestamps: `{ type: "log", level, message, timestamp: Date.now() }`
- Add typed event names to catch typos at compile time

---

### 02-agent-service-protocol.md

**Summary**: Update frontend `agent-service.ts` to handle the unified stdout protocol.

**Status**: Appears **already implemented**:
- Handles `type: "log"` with proper level routing
- Handles `type: "event"` with eventBus forwarding
- Handles `type: "state"` with correct destructuring
- Simplified stderr handling

**Concerns**:
- Missing TypeScript type definitions for protocol messages
- All stderr treated as errors (may be too aggressive for git/npm warnings)
- Missing validation of parsed message structure
- Duplicated handler logic between `spawnAgentWithOrchestration` and `resumeAgent`

**Suggestions**:
- Mark this plan as completed and move to `plans/completed/`
- Add protocol type definitions to a shared location
- Consider extracting shared stdout handler logic

---

### 03-console-migration-agents.md

**Summary**: Replace all direct `console.*` calls in agents package with `logger.*`.

**Status**: Appears **~95% complete**. Only remaining `console.log` calls are:
- `agents/src/lib/logger.ts:11` (expected - the logger itself)
- `agents/src/output.ts:78` (`emitState()` - legitimate protocol usage)

**Concerns**:
- Plan only exempts `logger.ts`, but `output.ts` and `events.ts` also need `console.log` for protocol
- No guidance on choosing between `logger.info` vs `logger.debug`
- `events.ts` inconsistency (uses `logger.info` but should use `console.log`)

**Suggestions**:
- Add explicit exceptions for `output.ts` and `events.ts`
- Add log level selection guidelines
- Consider ESLint rule to prevent `console.*` regression

---

### 04-console-migration-core.md

**Summary**: Migrate console calls in core package to logger abstraction.

**Status**: **Scope may be zero** - the only `console.*` calls in core are inside `core/lib/logger.ts` itself.

**Concerns**:
- The "Considerations" section lists options but doesn't commit to a decision
- No guidance on handling the dual-context problem (agents = JSON, frontend = plain text)
- Core logger already wraps console methods
- Potential circular dependency if core imports from agents

**Suggestions**:
- Audit actual console usage before proceeding
- Make a definitive architectural decision:
  - Recommend: Dependency injection with `ILogger` interface
  - Alternative: Environment detection (`process.env.MORT_AGENT_PROCESS`)
- Define what "works correctly in frontend context" means

---

## Recommended Actions

### Immediate (Before Marking Plans Complete)

1. **Fix `events.ts` bug** - Change `logger.info(...)` to `console.log(...)`
2. **Update plan status** - Most work appears done; mark checkboxes or move to `completed/`
3. **Decide core logger approach** - Pick one of the three options and document it

### Short-term Improvements

4. **Add protocol type definitions** - Create shared types for `LogMessage`, `EventMessage`, `StateMessage`
5. **Update exception lists** - Add `output.ts` and `events.ts` to allowed `console.log` files
6. **Add runtime validation** - Consider zod schemas for protocol messages

### Optional Enhancements

7. **Add timestamps to logs** - Useful for debugging timing issues
8. **Extract shared handler logic** - DRY up the duplicated stdout handling in agent-service.ts
9. **Add ESLint rule** - Prevent `console.*` regression in agents package
10. **Document the protocol** - Create `docs/agent-protocol.md` for future maintainers

---

## Overall Assessment

The agents-logger refactoring plan is **fundamentally sound** with a clean protocol design and well-organized execution strategy. The main issues are:

1. **The `events.ts` implementation bug is critical** and must be fixed before the protocol can work correctly
2. **Most plans appear already implemented** - the documentation should be updated to reflect this
3. **The core package dual-context problem needs a concrete decision**, not just options listed

The parallel execution strategy (Subplans 1+2 then 3+4) is overkill given the actual scope of changes, but it demonstrates good planning discipline.

**Recommendation**: Fix the `events.ts` bug, update plan completion status, then archive these plans to `plans/completed/agents-logger/`.
