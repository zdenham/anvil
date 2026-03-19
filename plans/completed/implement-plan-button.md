# Implement Plan Button

Add an "implement this" action button inside the thread input when a plan is focused, in the same position as the cancel button.

## Context

- `PlanContent` (`src/components/content-pane/plan-content.tsx`) renders a `ThreadInputSection` with `contextType="plan"` at the bottom
- `ThreadInput` (`src/components/reusable/thread-input.tsx`) renders a cancel button at `absolute right-2 top-1/2` inside the input when `onCancel` is provided
- The "implement this" button should occupy that same position when viewing a plan and no agent is running

## Behavior

- **Show when**: Plan is focused, input is empty, and no cancel button is showing (agent not running)
- **Hide when**: User types anything into the input, OR the cancel button is showing (agent running)
- **On click**: Submit "implement this plan" as the message (calls `onSubmit`)
- **Style**: Small pill/chip inside the input, right-aligned, same position as cancel button. Subtle but discoverable — use `text-surface-400 hover:text-surface-200` style with a small play/arrow icon or just text

## Phases

- [x] Thread input: add `contextType` prop and render implement button conditionally
- [x] Wire contextType through ThreadInputSection to ThreadInput

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: ThreadInput — add contextType prop and implement button

In `src/components/reusable/thread-input.tsx`:

1. Add `contextType?: "empty" | "thread" | "plan"` to `ThreadInputProps`
2. Accept it in the component destructure
3. After the cancel button block (line 240-249), add a new conditional block:

```tsx
{!onCancel && contextType === "plan" && !content.trim() && (
  <button
    onClick={handleSubmit}  // reuse — but we need to set content first
    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-surface-400 hover:text-surface-200 transition-colors px-2 py-0.5 rounded border border-surface-600 hover:border-surface-500"
    aria-label="Implement this plan"
  >
    implement
  </button>
)}
```

Wait — `handleSubmit` uses `content.trim()` so if content is empty it won't fire. We need a dedicated handler:

```tsx
const handleImplementPlan = useCallback(() => {
  if (!disabled) {
    onSubmit("implement this plan");
  }
}, [disabled, onSubmit]);
```

Then the button calls `onClick={handleImplementPlan}`.

## Phase 2: Wire contextType through ThreadInputSection

In `src/components/reusable/thread-input-section.tsx`:

1. The prop `contextType` already exists on `ThreadInputSectionProps` (line 27)
2. Currently it's accepted but aliased to `_contextType` (line 46) — unused
3. Change: remove the underscore alias, pass it through to `ThreadInput`:

```tsx
<ThreadInput
  ref={ref}
  // ... existing props ...
  contextType={contextType}
/>
```

That's it — `PlanContent` already passes `contextType="plan"` (line 267), and `ThreadContent` passes `"thread"` or `"empty"` (line 417). The button will only render for plan context.
