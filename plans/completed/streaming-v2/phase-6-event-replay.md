# Phase 6: Event Debugger Export + Playwright Replay Tests

Parent: [readme.md](./readme.md) | Full design: [streaming-architecture-v2.md](../streaming-architecture-v2.md#phase-6-event-debugger-export--playwright-replay-tests)

## Goal

Extend the existing event debugger with export capabilities. Build a Playwright test harness that replays exported events to test the streaming UI in isolation — no live agent needed.

## Dependencies

- Can start immediately (export feature is independent)
- Full value after Phase 3 (stable event pipeline to test against)

## Phases

- [ ] Add `exportEvents` action to `event-debugger-store.ts` with `EventRecording` format
- [ ] Create dev-only event injection bridge (`__injectAgentMessage`, `__replayRecording`)
- [ ] Create Playwright test fixtures (`replayRecording`, `loadRecording`)
- [ ] Write Playwright test: no content flash during normal streaming
- [ ] Write Playwright test: no layout jump > 50px during streaming
- [ ] Write Playwright test: gap recovery restores content within 2 seconds
- [ ] Record initial set of curated event recordings for test suite

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/test-event-bridge.ts` | Dev-only injection bridge for Playwright |
| `e2e/fixtures/event-recording.ts` | Playwright fixture for loading/replaying recordings |
| `e2e/streaming-replay.spec.ts` | Playwright tests using event replay |
| `e2e/recordings/*.json` | Curated event recordings |

## Files to Modify

| File | Change |
|------|--------|
| `src/stores/event-debugger-store.ts` | Add `exportEvents` action |

## Event Recording Format

```ts
interface EventRecording {
  version: 1;
  recordedAt: string;
  threadId: string;
  events: Array<{
    timestamp: number;
    type: string;       // "state_event", "stream_delta", "event", etc.
    name?: string;
    payload: unknown;   // Raw AgentSocketMessage
  }>;
}
```

## Event Injection Design

Events inject at `eventBus.emit()` level (not Tauri `listen()` level):
- No need to mock Tauri's `listen()` API
- Event debugger still captures injected events
- Full UI pipeline exercised: event → store → component
- Works regardless of event source (Tauri, WebSocket, test harness)

## Curated Recordings to Maintain

| Recording | Scenario |
|-----------|----------|
| `normal-streaming-session.json` | Typical text streaming with thinking blocks |
| `long-streaming-response.json` | Extended response for scroll behavior testing |
| `streaming-with-gap.json` | Manually crafted or captured during network disruption |
| `tool-use-interleaved.json` | Streaming interrupted by tool calls |
| `rapid-state-deltas.json` | Fast state updates during tool execution |

## Playwright Tests

### No content flash
Track `[data-testid='streaming-content']` visibility. If it had content and then goes empty, that's a flash. Assert 0 flashes after full replay.

### No layout jump > 50px
Capture scroll positions via MutationObserver during replay. Assert no adjacent positions differ by > 50px.

### Gap recovery
Replay a recording with a gap in it. Assert streaming content is visible within 2 seconds after replay completes.

## Recording Workflow

1. Open event debugger (Cmd+Shift+D → Events tab)
2. Start capture (Record button)
3. Trigger scenario (start agent, let it stream)
4. Stop capture
5. Click "Export" → saves to `e2e/recordings/{name}.json`
6. Write Playwright test that loads and replays

## Verification

- Export produces valid JSON matching `EventRecording` schema
- Playwright can replay recordings and UI renders correctly
- All 3 test scenarios pass
- No flashes, no layout jumps, gap recovery works
