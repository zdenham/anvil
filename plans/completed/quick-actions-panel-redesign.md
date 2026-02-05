# Quick Actions Panel Redesign

## Current Issues
- Horizontally scrolling buttons with variable widths feel overwhelming
- Loading state shifts all buttons, causing jarring visual jumps
- Takes up vertical space inefficiently
- "Quick Actions" label and "Configure" button waste space once configured

## Design Direction

### Text-Based Selector with Underline Selection

**Inspiration:** Terminal/CLI interfaces, minimal text UIs

A single row of fixed-width, monospace text items. Selection indicated by underline only.

**Visual:**
```
archive   mark-read   next   close
────────
```

**Key Properties:**
- **Fixed-width items:** Each action takes the same horizontal space (pad shorter labels)
- **Monospace font:** Consistent character widths, technical aesthetic
- **Underline selection:** No background, border, or button styling - just an underline on the active/hovered item
- **Minimal padding:** Should feel like native terminal text, not buttons
- **No horizontal scroll:** If actions don't fit, truncate or use overflow menu
- **Single row:** Remove "Quick Actions" label and "Configure" once actions exist - just show the actions inline

**Layout:**
- When no actions configured: Show setup prompt
- When actions exist: Just the action labels in a row, nothing else

---

## Loading State

- Replace the triggered action's text with a subtle indicator (e.g., `...` or spinner character)
- Or: underline animates/pulses during execution
- No layout shift - the space is fixed

---

## Implementation Notes

1. ~~Calculate max label width across all actions, use that as fixed width for all~~ → Using fixed 12-char max with truncation
2. Use CSS `font-family: monospace` and `text-decoration: underline` for selection
3. Remove wrapper chrome (labels, configure button) when actions are present
4. Keyboard navigation: arrow keys move underline, enter executes
5. Consider dim/muted color for non-selected items, brighter for selected

---

## Next Steps

- [x] Update `quick-actions-panel.tsx` to use new text-based design
- [x] Remove "Quick Actions" header and "Configure" button when actions exist
- [x] Implement fixed-width with 12-char max and truncation (simpler than dynamic calculation)
- [x] Style with monospace font and underline selection
- [ ] Test with various action counts to ensure no overflow/scroll
