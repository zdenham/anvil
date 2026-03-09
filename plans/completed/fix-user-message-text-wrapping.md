# Fix: User message text not wrapping for wide pasted content

## Problem

When pasting very wide text (e.g., a long single-line log entry or code snippet) into the thread input, the white user message bubble expands horizontally instead of wrapping at its max width. This causes the message list to overflow or the layout to break.

## Root Cause

The container hierarchy from the virtual list item down to the text `<p>` has two issues:

1. **Flex min-width problem**: In CSS flexbox, flex items default to `min-width: auto`, meaning they won't shrink below their content's intrinsic width. The `<article>` in `user-message.tsx` is `flex justify-end`, and its child `<div className="max-w-[80%]">` can be pushed wider than 80% by long unbreakable content because there's no `min-w-0` or `overflow-hidden` to override the default.

2. **Missing overflow constraint**: Neither the user message bubble `<div>` nor the outer `max-w-[80%]` wrapper clips or constrains overflow, so wide content can push through `max-width` in a flex context.

## Fix

**File:** `src/components/thread/user-message.tsx`

Two changes:

1. **Line 40** — Add `overflow-hidden` to the `max-w-[80%]` wrapper so content cannot push it wider:

   ```tsx
   // Before
   <div className="max-w-[80%] flex flex-col items-end gap-1">
   // After
   <div className="max-w-[80%] flex flex-col items-end gap-1 overflow-hidden">
   ```

2. **Line 63** — Strengthen the word-break strategy on the `<p>` tag. `break-words` (`overflow-wrap: break-word`) alone can fail for very long strings in `pre-wrap` contexts. Add `break-all` as a fallback and use `overflow-wrap: anywhere` for better break behavior:

   ```tsx
   // Before
   <p className="whitespace-pre-wrap break-words">{textContent}</p>
   // After
   <p className="whitespace-pre-wrap break-words overflow-wrap-anywhere">{textContent}</p>
   ```

   Since Tailwind doesn't have a built-in `overflow-wrap: anywhere` utility, use an inline style or add `[overflow-wrap:anywhere]` (Tailwind arbitrary property):

   ```tsx
   <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{textContent}</p>
   ```

The `overflow-hidden` on the wrapper is the primary fix — it ensures the flex child respects its `max-width` constraint regardless of content width. The `overflow-wrap: anywhere` on the `<p>` is a secondary improvement that gives the browser more freedom to break long strings at any point.

## Phases

- [x] Add `overflow-hidden` to the `max-w-[80%]` wrapper div in `user-message.tsx`

- [x] Add `[overflow-wrap:anywhere]` to the `<p>` tag in `user-message.tsx`

- [ ] Verify visually with a wide pasted string

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---