# Pill-Style Tab Redesign

Replace the current bordered/lined tab bar with a minimal pill-style design: rounded tab shapes, no borders or lines, selected tab distinguished by a lighter background.

## Current Design

- Tab bar: flat `bg-surface-900`, bottom border line (`border-b border-surface-700`) spans full width
- Tabs: fixed `w-[160px]`, right border separators, bottom border trick to show active state
- Active vs inactive: same background, active hides its bottom border to "connect" to content

## New Design

- **Tab bar**: `bg-surface-950` (or `surface-900`), no bottom border, slight vertical padding so pills float
- **Inactive tabs**: transparent background (blends into bar), `text-surface-500`, no border, rounded (`rounded-md`)
- **Active tab**: `bg-surface-800` (lighter), `text-surface-200`, rounded (`rounded-md`), no border
- **Tab width**: remove fixed `w-[160px]`, use `max-w-[200px]` + natural content sizing
- **Separators**: remove all `border-r` between tabs
- **Bottom line**: remove the spacer `border-b` and per-tab `border-b`
- **New-tab button**: remove its `border-b`, keep icon-only style, apply similar rounded hover

## Phases

- [x] Update `tab-bar.tsx` — remove bottom border spacer, add vertical padding to bar container, adjust bar background

- [x] Update `tab-item.tsx` — remove all borders, add border-radius, change active/inactive colors, switch to max-width sizing

- [x] Update new-tab button in `tab-bar.tsx` — remove border-b, align with new rounded style

- [x] Update `tab-drag-preview.tsx` — match new pill style for drag ghost

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Files to Change

| File | What changes |
| --- | --- |
| `src/components/split-layout/tab-bar.tsx` | Remove spacer div's `border-b`, add `py-1 px-1 gap-0.5` to bar, update bar bg to `surface-950`, remove new-tab button border |
| `src/components/split-layout/tab-item.tsx` | Remove `border-r`, `border-b`, fixed `w-[160px]`; add `rounded-md`, `max-w-[200px]`; active = `bg-surface-800 text-surface-200`, inactive = `text-surface-500 hover:bg-surface-800/50 hover:text-surface-300` |
| `src/components/split-layout/tab-drag-preview.tsx` | Update to match new pill style (already close, minor tweaks) |

## Specific Class Changes

### `tab-bar.tsx` — bar container (line 82)

```
// Before
"flex items-stretch bg-surface-900 overflow-x-auto scrollbar-none"

// After
"flex items-center bg-surface-950 overflow-x-auto scrollbar-none py-1 px-1 gap-0.5"
```

### `tab-bar.tsx` — new-tab button (line 96)

```
// Before
"flex items-center justify-center w-7 flex-shrink-0 border-b border-surface-700 ..."

// After
"flex items-center justify-center w-7 h-7 flex-shrink-0 rounded-md ..."
```

### `tab-bar.tsx` — spacer div (line 102)

```
// Before
<div className="flex-1 border-b border-surface-700" />

// After
<div className="flex-1" />
```

### `tab-item.tsx` — tab button (lines 134-140)

```
// Before
"group relative flex items-center gap-1.5 px-2.5 pt-[10px] pb-[10px] w-[160px] flex-shrink-0 text-xs font-medium transition-[color] duration-150",
"border-r border-surface-700",
isActive
  ? "bg-surface-900 text-surface-300 border-b border-b-surface-900"
  : "bg-surface-900 text-surface-400 hover:text-surface-200 border-b border-b-surface-700",

// After
"group relative flex items-center gap-1.5 px-2.5 py-1.5 max-w-[200px] flex-shrink-0 text-xs font-medium transition-colors duration-150 rounded-md",
isActive
  ? "bg-surface-800 text-surface-200"
  : "text-surface-500 hover:bg-surface-800/50 hover:text-surface-300",
```