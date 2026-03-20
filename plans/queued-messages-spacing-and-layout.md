# Fix queued messages spacing and scroll position

Two issues with pinned queued messages in the message list:

1. **Too much vertical space between queued messages** — each `PinnedUserMessage` has `my-3` (12px top + 12px bottom = 24px gap between siblings), plus `py-2` on the wrapper div
2. **Streamed content renders below queued messages** — the sticky container sits at `bottom: 0` but doesn't reserve space, so new streaming content scrolls underneath the queued messages instead of staying visible above them

## Phases

- [ ] Fix spacing between queued messages
- [ ] Make queued messages push streamed content up

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix spacing between queued messages

**File:** `src/components/thread/message-list.tsx`

The sticky container maps each pending message into a wrapper with `py-2`, and each `PinnedUserMessage` has `my-3`. Together that's excessive.

**Changes:**

1. On the sticky container's inner map (line 130), remove `py-2` from the wrapper div or reduce it to `py-0.5`
2. In `PinnedUserMessage` (line 167), change `my-3` → `my-1` so queued messages stack tightly

This gives a compact cluster that looks intentionally grouped rather than spaced like independent messages.

## Phase 2: Make queued messages push streamed content up

**File:** `src/components/thread/message-list.tsx`

The sticky container (line 128) is a sibling after `contentWrapperRef`. It uses `position: sticky; bottom: 0` which visually pins it but doesn't affect scroll layout — streaming content grows into the space behind it.

**Approach:** Add dynamic bottom padding to the content wrapper that matches the height of the queued messages container. This ensures the virtual list's content area accounts for the sticky overlay, keeping streamed text visible above it.

**Changes:**

1. Add a `ref` to the sticky queued-messages container
2. Use a `ResizeObserver` (or a simple height calculation based on `pendingMessages.length`) to track the container's height
3. Apply that height as `paddingBottom` on the content wrapper div (line 98), so the virtual list reserves space at the bottom
4. When `pendingMessages` is empty, padding is 0 — no effect on normal scrolling

**Simpler alternative** (if ResizeObserver feels heavy): estimate height per queued message (~60px per message including wrapper padding) and set `paddingBottom: pendingMessages.length * 60` on the content wrapper. This is less precise but avoids an extra observer and queued messages are uniform height.

The virtual list's `autoScrollOnGrowth` and sticky mode should naturally keep the scroll pinned to the bottom, so increasing `paddingBottom` while streaming will push content up as desired.
