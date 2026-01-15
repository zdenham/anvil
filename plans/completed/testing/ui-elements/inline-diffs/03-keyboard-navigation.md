# Sub-Plan 03: Keyboard Navigation Hook

## Overview

Create a keyboard navigation hook for inline diff blocks that handles collapse/expand, navigation between pending edits, and accept/reject actions.

## Dependencies

- **None** - This is a standalone hook (uses only React primitives)

## Depends On This

- `02-inline-diff-components.md` - Wires this hook into InlineDiffBlock

---

## Scope

### Files to Create

1. `src/components/thread/use-inline-diff-keyboard.ts` (~80 lines)
2. `src/components/thread/use-inline-diff-keyboard.test.ts` (~150 lines)

### Pattern Reference

- Follow `src/components/diff-viewer/use-diff-keyboard.ts` exactly

---

## Implementation Details

### 3.1 Hook Interface

**File:** `src/components/thread/use-inline-diff-keyboard.ts`

```typescript
interface UseInlineDiffKeyboardOptions {
  /** Collapse/expand controls */
  expandAllRegions: () => void;
  collapseAllRegions: () => void;
  /** Full viewer expansion */
  openFullViewer?: () => void;
  /** Scroll within diff content (j/k keys) */
  scrollDiffContent?: (direction: "up" | "down") => void;
  /** Pending edit navigation (only when pending edits exist) */
  focusedIndex?: number;
  pendingCount?: number;
  onFocusChange?: (index: number) => void;
  /** Accept/reject actions (only for pending mode) */
  onAccept?: () => void;
  onReject?: () => void;
  onAcceptAll?: () => void;
  /** Whether keyboard shortcuts are enabled */
  enabled?: boolean;
}

export function useInlineDiffKeyboard(options: UseInlineDiffKeyboardOptions): void;
```

### 3.2 Keyboard Mappings

| Key | Action | Mode |
|-----|--------|------|
| `e` | Expand all collapsed regions | All |
| `c` | Collapse unchanged regions | All |
| `Enter` | Open full diff viewer | All |
| `n` | Focus next pending edit | Pending only |
| `p` | Focus previous pending edit | Pending only |
| `j` | Scroll down within diff content | All |
| `k` | Scroll up within diff content | All |
| `y` | Accept focused edit | Pending only |
| `r` / `Escape` | Reject focused edit | Pending only |
| `a` | Accept all pending edits | Pending only |

**Key Conflict Resolution:**
- `n` and `p` are reserved for pending edit navigation (next/previous)
- Reject uses `r` key (and `Escape` as alternative), NOT `n`
- This avoids conflict where `n` could mean both "next" and "reject"
- UI hints should show "(r)" not "(n)" for the reject button

### 3.3 Implementation

```typescript
export function useInlineDiffKeyboard({
  expandAllRegions,
  collapseAllRegions,
  openFullViewer,
  focusedIndex = 0,
  pendingCount = 0,
  onFocusChange,
  onAccept,
  onReject,
  onAcceptAll,
  enabled = true,
}: UseInlineDiffKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if in input/textarea/contentEditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "e":
          e.preventDefault();
          expandAllRegions();
          break;
        case "c":
          e.preventDefault();
          collapseAllRegions();
          break;
        case "Enter":
          e.preventDefault();
          openFullViewer?.();
          break;
        case "j":
          // Scroll down within diff content
          e.preventDefault();
          scrollDiffContent?.("down");
          break;
        case "k":
          // Scroll up within diff content
          e.preventDefault();
          scrollDiffContent?.("up");
          break;
        case "n":
          // Navigate to next pending edit (NOT reject)
          if (pendingCount > 0 && onFocusChange) {
            e.preventDefault();
            onFocusChange((focusedIndex + 1) % pendingCount);
          }
          break;
        case "p":
          // Navigate to previous pending edit
          if (pendingCount > 0 && onFocusChange) {
            e.preventDefault();
            onFocusChange((focusedIndex - 1 + pendingCount) % pendingCount);
          }
          break;
        case "y":
          if (onAccept) {
            e.preventDefault();
            onAccept();
          }
          break;
        case "r":
        case "Escape":
          // Reject uses 'r' key (not 'n' which is for navigation)
          if (onReject) {
            e.preventDefault();
            onReject();
          }
          break;
        case "a":
          if (onAcceptAll) {
            e.preventDefault();
            onAcceptAll();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [/* all dependencies */]);
}
```

### 3.4 Unit Tests

**File:** `src/components/thread/use-inline-diff-keyboard.test.ts`

Test Categories:

1. **Collapse/Expand**
   - Calls `expandAllRegions` when 'e' pressed
   - Calls `collapseAllRegions` when 'c' pressed

2. **Full Viewer**
   - Calls `openFullViewer` when Enter pressed

3. **Pending Edit Navigation**
   - Calls `onFocusChange` with next index when 'n' pressed
   - Calls `onFocusChange` with previous index when 'p' pressed
   - Wraps focus index at boundaries
   - Does nothing when `pendingCount` is 0

4. **Accept/Reject**
   - Calls `onAccept` when 'y' pressed
   - Calls `onReject` when 'r' pressed
   - Calls `onReject` when Escape pressed
   - Calls `onAcceptAll` when 'a' pressed
   - Does NOT call onReject when 'n' pressed (n is for navigation)

5. **Scroll Navigation**
   - Calls `scrollDiffContent("down")` when 'j' pressed
   - Calls `scrollDiffContent("up")` when 'k' pressed

6. **Input Exclusion**
   - Does not trigger when typing in input element
   - Does not trigger when typing in textarea
   - Does not trigger when typing in contentEditable

7. **Enabled State**
   - Does nothing when `enabled=false`

---

## Verification

```bash
# Run hook tests
pnpm test src/components/thread/use-inline-diff-keyboard.test.ts

# Type check
pnpm tsc --noEmit
```

---

## Acceptance Criteria

- [ ] All keyboard mappings work as documented
- [ ] Input/textarea/contentEditable exclusion works
- [ ] Focus wrapping at boundaries works correctly
- [ ] Hook is no-op when `enabled=false`
- [ ] All unit tests pass
- [ ] No TypeScript errors
- [ ] File stays under 250 lines
