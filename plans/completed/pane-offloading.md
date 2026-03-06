# Content Pane Offloading

## Problem

Heavy content panes (thread views with Shiki highlighting, diff viewers, xterm terminals, file viewers with syntax highlighting) stay fully mounted and retain all their DOM nodes, React component trees, and JS state even when they're in background tabs or not visible. With multiple panes open across split layouts, this accumulates significant memory pressure.

## Current Architecture

- **Split layout**: `SplitLayoutContainer` → `SplitNodeRenderer` → `PaneGroup` → `ContentPane`
- **Tab model**: Each `PaneGroup` has up to 5 tabs, but **only the active tab is rendered** (`activeView` is passed to a single `ContentPane`). Switching tabs fully unmounts/remounts the content.
- **Across pane groups**: All visible pane groups in the split tree render their active tab simultaneously — this is where the real memory cost lives (2-4 visible panes, each with a heavy thread view).
- **Heavy components**: `ThreadView` (message list with Shiki-highlighted code blocks, markdown), `FileContent` (Shiki), `TerminalContent` (xterm.js + WebGL), `ChangesView` (diff viewer with Shiki), `PullRequestContent`.

## Strategy: "Freeze & Snapshot" for Offscreen Panes

Replace live React trees with static bitmap snapshots when a pane group loses focus or goes offscreen. This has two tiers:

### Tier 1 — CSS `content-visibility: auto` (Quick Win)

Use the browser's built-in `content-visibility: auto` on offscreen regions of long content (message list items, diff blocks, code blocks). This tells the browser to skip layout/paint for offscreen subtrees while keeping the DOM alive.

- Apply to each message turn row in `MessageList`
- Apply to each diff file section in `ChangesView`
- Apply to code blocks in `CodeBlock`
- Set `contain-intrinsic-size` to avoid layout jumps

**Benefit**: Zero code complexity, browser-native, works within the existing React tree. Can reclaim ~30-60% of rendering cost for long threads.

### Tier 2 — Bitmap Snapshot + Unmount for Background Pane Groups

When a pane group is **not the active group** (user clicked away to work in a different split pane), capture a bitmap of the pane's DOM, replace the live content with a static `<img>`, and unmount the React subtree. Restore when the user clicks back.

#### Capture approach: `html2canvas` or native Tauri screenshot

**Option A — `html2canvas` (recommended first)**
- Pure JS, no native dependency
- Captures the current DOM as a canvas, convert to data URL
- Works well for text-heavy content (our primary case)
- Limitation: won't capture xterm WebGL canvas (but those are rare background panes)

**Option B — Tauri `window.captureVisibleRegion` / native screenshot**
- Pixel-perfect capture including WebGL
- Requires Rust-side command
- More complex, save for later if Option A isn't sufficient

#### Implementation

1. **New hook: `usePaneOffload`**
   - Input: `groupId`, `isActiveGroup`
   - When `isActiveGroup` transitions `true → false`:
     - Wait ~500ms debounce (user might click back)
     - Capture snapshot of the pane group's DOM via `html2canvas`
     - Store the data URL in a `Map<groupId, string>` (Zustand or module-level)
     - Set a flag `offloaded: true`
   - When `isActiveGroup` transitions `false → true`:
     - Clear the snapshot
     - Set `offloaded: false` (React tree remounts naturally)

2. **Modify `PaneGroup`** to conditionally render:
   ```tsx
   {offloaded ? (
     <img src={snapshotUrl} className="w-full h-full object-cover" alt="Frozen pane" />
   ) : (
     <ContentPane ... />
   )}
   ```

3. **Cleanup**: Revoke snapshot data URLs on pane close or group removal.

#### Memory savings estimate
- Each thread view with 50+ messages can hold 5-20MB of DOM + React fiber tree
- Replacing with a single `<img>` (50-200KB data URL) saves ~95% per offloaded pane
- With 3 pane groups visible, offloading 2 saves ~10-40MB

### Tier 3 (Future) — Per-Tab Offloading Within a Group

Same pattern but applied to non-active tabs within a group. Currently tabs already unmount, so this is only relevant if we later switch to keeping tabs alive (e.g., for preserving scroll position).

## Phases

- [ ] Add `content-visibility: auto` to message turns, diff blocks, and code blocks (Tier 1)
- [ ] Add `html2canvas` dependency and create `usePaneOffload` hook
- [ ] Integrate offloading into `PaneGroup` — snapshot on deactivate, restore on activate
- [ ] Handle edge cases: streaming content (skip offload while running), terminal panes (WebGL), resize events
- [ ] Measure memory improvement via `captureMemorySnapshot()` before/after

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Open Questions

1. **Should we offload immediately or only after a timeout?** A 500ms-1s debounce prevents unnecessary work when rapidly switching between panes.
2. **Terminal panes**: `html2canvas` can't capture WebGL. We could either skip offloading for terminal panes or use a simpler approach (just hide + `display:none` to free GPU memory, without a snapshot).
3. **Streaming threads**: Should never be offloaded while actively streaming. Check `entityStatus === "running"` before offloading.
4. **Data URL vs Blob URL**: Blob URLs (`URL.createObjectURL`) are more memory-efficient than data URLs for large images. Probably worth using blobs.
