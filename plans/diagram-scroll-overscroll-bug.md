# Diagram: Scroll-Past-Top Overscroll Bug

## How the transform correction system works (normal case)

When scrolling up, items above the viewport get measured and turn out taller than estimated. To prevent jitter, instead of modifying `scrollTop` mid-momentum, we apply a CSS `translateY(-correction)` to shift content and absorb the difference after scrolling stops (150ms idle).

## The bug: what happens during fast upward scroll

### State 1: Mid-scroll, correction accumulating

```
                    Browser viewport
                    ┌─────────────────────┐
                    │                     │
  scrollTop = 400   │   Message 5         │  ← user sees this
                    │   Message 6         │
                    │   Message 7         │
                    └─────────────────────┘
                          │
  correctionRef = 0       │  transform: none
                          ▼
                    Content sits at normal position
```

### State 2: Scrolling up, items above measured taller → correction grows

```
  Items above measured 120px taller than estimated
  correctionRef = 120

                    Browser viewport
                    ┌─────────────────────┐
  scrollTop = 200   │   Message 3         │  ← user sees this
                    │   Message 4         │     (correct, no jitter!)
                    │   Message 5         │
                    └─────────────────────┘

  Content wrapper has: transform: translateY(-120px)
  Effective scroll pos = scrollTop + correction = 200 + 120 = 320

  This works because:
  - Browser thinks we're at 200
  - Transform shifts content up 120px
  - Net effect: user sees position 320 worth of content
  - No scrollTop modification → no compositor fight → no jitter ✓
```

### State 3: scrollTop hits 0 — THE BUG

```
  correctionRef = 120    (still accumulated from measurements)

  ══════════════════════════════════════════════
  TRUE TOP OF CONTENT (position 0)
  ══════════════════════════════════════════════

       ↑↑↑  120px of content shifted ABOVE the viewport  ↑↑↑
       (Messages 0-1 are up here, invisible, unreachable)

                    Browser viewport (scrollTop = 0)
                    ┌─────────────────────┐
                    │                     │
                    │                     │  ← BLANK / partial content
                    │   ...maybe bottom   │     User sees emptiness or
                    │   of Message 1      │     cut-off messages
                    │                     │
                    └─────────────────────┘

  transform: translateY(-120px)  ← content pushed 120px above viewport

  What happened:
  - Browser reached scrollTop = 0, momentum DIES at boundary
  - But transform already shifted content 120px above viewport
  - Positions 0–119 are unreachable: scrollTop can't go negative
  - User sees blank space or partial content at top
```

### State 4: 150ms later — snap back (jarring)

```
  Idle timer fires → absorbs correction:
    el.scrollTop += 120    (scrollTop: 0 → 120)
    transform: ""          (remove the shift)
    correctionRef = 0

                    Browser viewport
                    ┌─────────────────────┐
  scrollTop = 120   │   Message 0 (top!)  │  ← content snaps into view
                    │   Message 1         │
                    │   Message 2         │
                    └─────────────────────┘

  User perceives: blank screen → sudden jump to correct position
```

## Timeline from user's perspective

```
Time ──────────────────────────────────────────────────────►

  [scrolling up fast]
       │
       │  Items above get measured, correction accumulates
       │  Content stays visually stable (good!)
       │
       ▼
  [scrollTop hits 0]
       │
       │  Browser stops scrolling (can't go negative)
       │  But transform has content shifted 120px above viewport
       │  ═══════════════════════════════════════════
       │  USER SEES: blank/empty area at top of list
       │  ═══════════════════════════════════════════
       │
       │  ... 150ms pass ...
       │
       ▼
  [idle timer fires]
       │
       │  Correction absorbed: scrollTop jumps to 120, transform cleared
       │  ═══════════════════════════════════════════
       │  USER SEES: content suddenly snaps into place
       │  ═══════════════════════════════════════════
```

## The fix: cap correction to scrollTop

Instead of waiting for scrollTop to hit 0 and absorbing all at once, **cap correction so it never exceeds scrollTop**. In the onScroll handler, when `scrollTop < correction`, clamp correction down to match. This never modifies scrollTop — zero compositor risk.

### State 3 (fixed): scrollTop drops below correction → cap kicks in

```
  scrollTop = 80, correctionRef was 120 → capped to 80

                    Browser viewport (scrollTop = 80)
                    ┌─────────────────────┐
                    │   Message 0 (top!)  │  ← content pinned at visual top
                    │   Message 1         │
                    │   Message 2         │
                    └─────────────────────┘

  transform: translateY(-80px)   ← reduced from -120 to match scrollTop
  effective pos = 80 + 80 = 160

  What happened:
  - scrollTop dropped below correction (80 < 120)
  - correction capped to scrollTop (120 → 80)
  - Content can't shift above viewport — visual top stays at position 0
  - 40px of correction absorbed invisibly (user was at the boundary)
```

### State 4 (fixed): scrollTop reaches 0 — nothing to absorb

```
  scrollTop = 0, correctionRef = 0   (already capped down to 0)

                    Browser viewport (scrollTop = 0)
                    ┌─────────────────────┐
                    │   Message 0 (top!)  │  ← already here, no snap!
                    │   Message 1         │
                    │   Message 2         │
                    └─────────────────────┘

  transform: ""   ← already cleared when correction hit 0
  No idle timer absorption needed — correction is already 0
```

### Fixed timeline

```
Time ──────────────────────────────────────────────────────►

  [scrolling up fast]
       │
       │  Items above get measured, correction accumulates
       │  Content stays visually stable (good!)
       │
       ▼
  [scrollTop drops below correction]
       │
       │  Cap fires: correction = scrollTop each frame
       │  Content "sticks" at visual top — no blank space
       │  Correction clamped to scrollTop each frame as scrollTop → 0
       │  (content scrolls slightly faster — imperceptible during momentum)
       │
       ▼
  [scrollTop = 0, correction = 0]
       │
       │  Nothing to absorb. Content already at correct position.
       │  No snap, no blank space, no compositor fight.
       │  ═══════════════════════════════════════════
       │  USER SEES: smooth stop at top of list ✓
       │  ═══════════════════════════════════════════
```

### Why this is better than absorb-at-boundary

```
  Absorb approach:          Cap approach:
  ─────────────────         ─────────────────
  scrollTop hits 0          scrollTop < correction
  correction still > 0      correction capped each frame
  modify scrollTop ←risk    never touch scrollTop ←safe
  single frame fix          clamped each frame
  brief blank possible      no blank ever
```