# Bash Tool Block UI Refinements

## Overview

This plan addresses specific feedback to improve the Bash tool block display. The goal is to make it more inline, visually polished, and usable.

---

## Feedback Items

### 1. Remove Left Border (Blockquote Style)

**Current:** Left border (`border-l-2`) creates a blockquote-style visual separator.

**Desired:** More inline appearance without the vertical border accent.

**Implementation:**
- Remove `border-l-2` and `pl-3` classes from the container
- Add subtle top/bottom padding or margin for separation between blocks
- Rely on the chevron and content layout for visual structure

```tsx
// Before
<div className={cn("group border-l-2 pl-3 py-1", borderColor)}>

// After
<div className="group py-1.5">
```

---

### 2. Shimmer Effect on Running Text

**Current:** Static "Running" text with a spinning loader icon.

**Desired:** Shimmer/glow animation on the gerund text (e.g., "Installing dependencies") while running.

**Implementation:**
- Create a shimmer animation keyframe
- Apply shimmer effect to the description/command text during running state
- Keep the spinner on the "Running" badge

```css
/* Add to CSS or use Tailwind animation */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.animate-shimmer {
  background: linear-gradient(
    90deg,
    currentColor 0%,
    rgba(255,255,255,0.4) 50%,
    currentColor 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: shimmer 2s infinite;
}
```

```tsx
// In component
<span className={cn(
  "text-sm text-zinc-200",
  isRunning && "animate-shimmer"
)}>
  {description}
</span>
```

Alternative approach using Tailwind's built-in utilities:
```tsx
// Add to tailwind.config.js
animation: {
  shimmer: 'shimmer 2s linear infinite',
}
keyframes: {
  shimmer: {
    '0%': { opacity: 0.7 },
    '50%': { opacity: 1 },
    '100%': { opacity: 0.7 },
  }
}

// Usage
<span className={cn("text-sm", isRunning && "animate-shimmer")}>
```

---

### 3. Remove "Exit X" Text, Keep Icon Only

**Current:** Badge shows icon + "Exit 0" or "Exit 1" text.

**Desired:** Just the checkmark (success) or X (error) icon, no text.

**Implementation:**
- Simplify `ExitCodeBadge` to render icon only
- Rename to `StatusIcon` for clarity
- Remove the badge background styling, use just the icon

```tsx
// Before
function ExitCodeBadge({ code }: { code: number }) {
  const isSuccess = code === 0;
  return (
    <span className={cn(
      "text-xs font-mono px-1.5 py-0.5 rounded inline-flex items-center gap-1",
      isSuccess ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
    )}>
      {isSuccess ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      Exit {code}
    </span>
  );
}

// After
function StatusIcon({ isSuccess }: { isSuccess: boolean }) {
  return isSuccess ? (
    <CheckCircle2 className="h-4 w-4 text-green-400" />
  ) : (
    <XCircle className="h-4 w-4 text-red-400" />
  );
}
```

---

### 4. Vertical Scrolling for Output (Fix Horizontal Overflow)

**Current:** Output uses `overflow-x-auto` and can produce very wide horizontal scroll on JSON/long lines.

**Desired:** Primarily vertical scrolling. Long lines should wrap or be handled gracefully.

**Implementation:**
- Change from `overflow-x-auto` to `overflow-x-hidden` or use `whitespace-pre-wrap`
- Keep `overflow-y-auto` for vertical scrolling
- Set a reasonable `max-h` (already has `max-h-96`)
- Use `whitespace-pre-wrap` and `break-all` or `break-words` for long lines

```tsx
// Before
<pre className={cn(
  "text-xs font-mono p-2 rounded overflow-x-auto max-h-96 overflow-y-auto",
  // ...
)}>

// After
<pre className={cn(
  "text-xs font-mono p-2 rounded max-h-96 overflow-y-auto",
  "whitespace-pre-wrap break-words",
  // ...
)}>
```

If preserving horizontal scroll is preferred for certain content (like tables), consider:
- Making max-width constrained
- Adding a toggle or detecting content type

---

### 5. Separate Copy Buttons for Input and Output

**Current:** Single copy button that copies the output, positioned in header area.

**Desired:** Two distinct copy buttons - one for the command (input), one for the output. Clear visual association.

**Implementation:**

#### A. Command Copy Button
- Place inline with the command text
- Tooltip: "Copy command"
- Only visible on hover

#### B. Output Copy Button
- Place at top-right of the output area
- Tooltip: "Copy output"
- Only visible on hover or when expanded

```tsx
// Command area (collapsed view)
<div className="flex items-center gap-1">
  <code className="text-sm font-mono">
    <span className="text-green-400">$</span>{" "}
    <span className="text-zinc-200">{command}</span>
  </code>
  <CopyButton text={command} label="Copy command" />
</div>

// Output area (expanded view)
<div className="relative mt-2 ml-6">
  <div className="absolute top-1 right-1">
    <CopyButton text={result} label="Copy output" />
  </div>
  <pre className="...">
    {displayedOutput}
  </pre>
</div>
```

Update `CopyButton` to accept a label prop:
```tsx
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  // ...
  return (
    <button
      onClick={handleCopy}
      className="p-1 hover:bg-zinc-700 rounded opacity-0 group-hover:opacity-100"
      title={label}
      aria-label={label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-400" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-zinc-400" />
      )}
    </button>
  );
}
```

Visual layout:
```
▶ Install dependencies               1.2s  ✓
  $ npm install  [copy icon]

▼ Install dependencies               1.2s  ✓
  $ npm install  [copy icon]
                                    [copy icon - output]
  ┌────────────────────────────────────────┐
  │ added 1234 packages in 12s             │
  │ ...                                    │
  └────────────────────────────────────────┘
```

---

## Implementation Checklist

- [ ] Remove left border styling, adjust padding for inline feel
- [ ] Add shimmer animation keyframes to Tailwind config
- [ ] Apply shimmer class to description/command text when running
- [ ] Simplify exit code display to icon-only
- [ ] Change output pre to use `whitespace-pre-wrap` and `break-words`
- [ ] Remove or constrain horizontal scroll on output
- [ ] Add copy button next to command text
- [ ] Position output copy button in top-right of output area
- [ ] Update CopyButton to accept configurable label/tooltip
- [ ] Test with various output types (JSON, long lines, tables)
- [ ] Verify accessibility (tooltips, aria-labels)

---

## File Changes

| File | Change |
|------|--------|
| `src/components/thread/tool-blocks/bash-tool-block.tsx` | All component changes |
| `tailwind.config.js` | Add shimmer animation (if using custom keyframes) |

---

## Visual Reference

### Running State (with shimmer)
```
▶ Installing dependencies              ⏳ Running
  $ npm install  📋
```
The "Installing dependencies" text has a subtle shimmer animation.

### Complete State
```
▶ Install dependencies               1.2s  ✓
  $ npm install  📋
```
No "Exit 0" text, just the green checkmark.

### Expanded with Output
```
▼ Install dependencies               1.2s  ✓
  $ npm install  📋
                                          📋
┌──────────────────────────────────────────┐
│ added 847 packages in 8s                 │
│                                          │
│ 127 packages are looking for funding     │
│   run `npm fund` for details             │
└──────────────────────────────────────────┘
```
Output scrolls vertically, wraps long lines instead of horizontal scroll.
