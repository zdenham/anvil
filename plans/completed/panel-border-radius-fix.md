# Panel Border Radius Investigation & Fix Plan

## Summary

Several panels in the app do not display rounded border corners. The root cause is a mismatch between Tauri window transparency settings and HTML body background colors.

## Investigation Findings

### Root Cause

On macOS, NSPanel windows require **transparent window backgrounds** to properly render CSS border-radius. When the window is non-transparent or the HTML body has an opaque background color, the rounded corners get clipped by the rectangular window frame.

### Current Panel Configuration

| Panel | Window Transparent | HTML Background | Border Radius Works? |
|-------|-------------------|-----------------|---------------------|
| Spotlight | `true` | `transparent` | ✅ Yes |
| Clipboard | `true` | `transparent` | ✅ Yes |
| Task | `false` | `#141514` (opaque) | ❌ No |
| Simple Task | `false` | `#141514` (opaque) | ❌ No |
| Tasks List | `true` | `#18181b` (opaque) | ❌ No |
| Error | `true` | `#141514` (opaque) | ❌ No |

### Key Files

1. **`src-tauri/src/panels.rs`** - Rust panel configuration with `.transparent(bool)` settings
2. **`src/index.css`** - Global CSS with body background and border-radius definitions
3. **HTML entry points:**
   - `task.html` - Has opaque background `#141514`
   - `simple-task.html` - Has opaque background `#141514`
   - `tasks-panel.html` - Has opaque background `#18181b`
   - `error.html` - Has opaque background `#141514`
   - `spotlight.html` - ✅ Already has `transparent` background
   - `clipboard.html` - ✅ Already has `transparent` background

### Working Example

The spotlight panel works correctly because:
1. Rust: `.transparent(true)` is set
2. HTML: `background: transparent` is set on the body
3. CSS in `index.css` has a special rule to force transparency:

```css
html:has(.spotlight-container),
html:has(.spotlight-container) body,
html:has(.spotlight-container) #root {
  background: transparent !important;
}
```

---

## Fix Plan

### Option A: Make All Panels Transparent (Recommended)

This approach follows the pattern already working for spotlight/clipboard.

#### Step 1: Update HTML Entry Points

For each affected HTML file, change the body background to transparent:

**`task.html`:**
```html
<!-- Before -->
<body style="background-color: #141514;">

<!-- After -->
<body style="background: transparent;">
```

**`simple-task.html`:**
```html
<!-- Before -->
<body style="background-color: #141514;">

<!-- After -->
<body style="background: transparent;">
```

**`tasks-panel.html`:**
```html
<!-- Before -->
<body class="bg-zinc-900">

<!-- After -->
<body style="background: transparent;">
```

**`error.html`:**
```html
<!-- Before -->
<body style="background-color: #141514;">

<!-- After -->
<body style="background: transparent;">
```

#### Step 2: Update Rust Panel Configuration

In `src-tauri/src/panels.rs`, ensure affected panels have `.transparent(true)`:

**Task Panel (~line 515):**
```rust
// Before
.transparent(false)

// After
.transparent(true)
```

**Simple Task Panel (~line 936):**
```rust
// Before
.transparent(false)

// After
.transparent(true)
```

#### Step 3: Add CSS Rules for Transparent Backgrounds

In `src/index.css`, add rules similar to the spotlight pattern to ensure body transparency for each panel container:

```css
/* Task panel transparency */
html:has(.task-panel-container),
html:has(.task-panel-container) body,
html:has(.task-panel-container) #root {
  background: transparent !important;
}

/* Tasks list panel transparency */
html:has(.tasks-list-container),
html:has(.tasks-list-container) body,
html:has(.tasks-list-container) #root {
  background: transparent !important;
}

/* Error panel transparency */
html:has(.error-container),
html:has(.error-container) body,
html:has(.error-container) #root {
  background: transparent !important;
}

/* Simple task panel transparency */
html:has(.simple-task-container),
html:has(.simple-task-container) body,
html:has(.simple-task-container) #root {
  background: transparent !important;
}
```

#### Step 4: Update Panel Components

Ensure each panel's root container:
1. Has the appropriate container class (e.g., `.task-panel-container`)
2. Has `rounded-xl` or appropriate border-radius class
3. Has the desired background color applied to the container (not the body)

Example for tasks panel in `src/components/tasks-panel/tasks-panel.tsx`:
```tsx
<div className="tasks-list-container h-screen w-full bg-surface-900/95 backdrop-blur-xl border border-surface-700/50 overflow-hidden flex flex-col rounded-xl">
```

#### Step 5: Handle Shadow (Optional)

With transparent windows, shadows need to be handled by the inner container. Add CSS shadow to the panel container:

```css
.task-panel-container,
.tasks-list-container,
.error-container,
.simple-task-container {
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}
```

---

### Option B: Use Vibrancy (macOS Native)

An alternative approach is to use macOS vibrancy effects which naturally support rounded corners:

```rust
.vibrancy(Some(tauri::Vibrancy::HudWindow))
```

However, this changes the visual appearance significantly and may not match the current design.

---

## Implementation Checklist

- [ ] Update `task.html` - set transparent background
- [ ] Update `simple-task.html` - set transparent background
- [ ] Update `tasks-panel.html` - set transparent background
- [ ] Update `error.html` - set transparent background
- [ ] Update `panels.rs` - set `.transparent(true)` for Task panel
- [ ] Update `panels.rs` - set `.transparent(true)` for Simple Task panel
- [ ] Add CSS transparency rules to `index.css`
- [ ] Add container classes to panel components
- [ ] Add `rounded-xl` to panel container divs
- [ ] Test all panels on macOS to verify rounded corners
- [ ] Test panels still function correctly (drag, focus, etc.)

## Potential Issues to Watch

1. **Click-through on transparent areas**: May need to handle hit testing
2. **Performance**: Transparent windows can be slightly less performant
3. **Shadow rendering**: May need CSS shadows instead of system shadows
4. **Drag regions**: Ensure draggable areas still work with transparent backgrounds

## Testing

After implementation, verify:
1. All panels display with rounded corners
2. Panels can still be dragged (if applicable)
3. Backdrop blur effects work correctly
4. No visual artifacts at corners
5. Panels behave correctly when focused/unfocused
