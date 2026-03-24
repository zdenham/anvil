# Extract Reusable Tool Block Components

## Overview

The `BashToolBlock` has been iterated on and polished, establishing patterns that should become the foundation for all other tool blocks. This plan outlines extracting its reusable components into a shared component library.

---

## Components to Extract

### 1. `CopyButton`

**Source:** `bash-tool-block.tsx:77-113`

**Description:** A button with copy-to-clipboard functionality, showing a checkmark on success. Supports tooltip, conditional visibility on hover, and customizable label.

**Props:**
```typescript
interface CopyButtonProps {
  /** Text to copy to clipboard */
  text: string;
  /** Tooltip label (default: "Copy") */
  label?: string;
  /** Always visible vs only on group hover (default: false) */
  alwaysVisible?: boolean;
  /** Optional className for additional styling */
  className?: string;
}
```

**Location:** `src/components/ui/copy-button.tsx`

**Usage patterns:**
- Copy command text
- Copy output text
- Copy file paths
- Copy code snippets

---

### 2. `ShimmerText`

**Source:** `index.css:253-267` (CSS) + inline usage in bash-tool-block

**Description:** Text that displays a shimmering animation effect, used to indicate loading/running states. This is currently CSS-only but should be a component for consistency.

**Props:**
```typescript
interface ShimmerTextProps {
  children: React.ReactNode;
  /** Whether to show shimmer effect (typically: isRunning) */
  isShimmering: boolean;
  /** Optional className for text styling */
  className?: string;
  /** HTML element to render as (default: "span") */
  as?: "span" | "div" | "p";
}
```

**Location:** `src/components/ui/shimmer-text.tsx`

**Notes:**
- Keep the CSS animation in `index.css` (already defined as `.animate-shimmer`)
- Component simply conditionally applies the class
- Provides semantic wrapper for the pattern

---

### 3. `CollapsibleOutputBlock`

**Source:** `bash-tool-block.tsx:124-162` (`OutputExpandCollapseOverlay`) + surrounding logic

**Description:** A container for long output that can be collapsed with a gradient overlay and expand/collapse button. Shows a gradient fade when collapsed with a centered button at the bottom.

**Props:**
```typescript
interface CollapsibleOutputBlockProps {
  children: React.ReactNode;
  /** Current expand state */
  isExpanded: boolean;
  /** Callback when toggle is clicked */
  onToggle: () => void;
  /** Whether content exceeds threshold (controls overlay visibility) */
  isLongContent: boolean;
  /** Max height when collapsed in pixels (default: 300) */
  maxCollapsedHeight?: number;
  /** Border color variant */
  variant?: "default" | "error";
  /** Optional className for the container */
  className?: string;
}
```

**Location:** `src/components/ui/collapsible-output-block.tsx`

**Subcomponents:**
- Internal: `OutputExpandCollapseOverlay` (the gradient + button)

**Usage patterns:**
- Bash command output
- File contents (Read tool)
- Search results (Grep tool)
- Any long text output

---

### 4. `ExpandChevron`

**Source:** Inline in bash-tool-block (multiple locations)

**Description:** A chevron icon that rotates based on expanded state. Currently the bash block uses specific spacing (`-ml-1 -mr-1.5` or `-ml-1 -mr-1`) which varies based on context.

**Props:**
```typescript
interface ExpandChevronProps {
  /** Whether the associated content is expanded */
  isExpanded: boolean;
  /** Size variant affecting both icon size and margins */
  size?: "sm" | "md";
  /** Custom className to override default spacing */
  className?: string;
}
```

**Location:** `src/components/ui/expand-chevron.tsx`

**Size variants:**
- `sm`: `h-4 w-4 -ml-1 -mr-1` (for inline command display)
- `md`: `h-4 w-4 -ml-1 -mr-1.5` (for description headers)

**Notes:**
- Uses `ChevronRight` when collapsed, `ChevronDown` when expanded
- The negative margins are intentional to align with surrounding content
- Color is configurable but defaults to white

---

### 5. `StatusIcon`

**Source:** `bash-tool-block.tsx:115-121`

**Description:** Simple success/failure icon indicator.

**Props:**
```typescript
interface StatusIconProps {
  /** Whether to show success (check) or failure (x) */
  isSuccess: boolean;
  /** Size of the icon (default: "md") */
  size?: "sm" | "md" | "lg";
}
```

**Location:** `src/components/ui/status-icon.tsx`

**Notes:**
- Different from `ToolStatusIcon` which handles running/pending states
- This is specifically for binary success/failure after completion
- Size variants: `sm` (h-3 w-3), `md` (h-4 w-4), `lg` (h-5 w-5)

---

### 6. `CollapsibleBlock` (Wrapper Pattern)

**Source:** The overall expand/collapse pattern in bash-tool-block

**Description:** A clickable header that expands/collapses content below. This is a compound component pattern.

**Props:**
```typescript
interface CollapsibleBlockProps {
  /** Whether block is expanded */
  isExpanded: boolean;
  /** Callback when header is clicked */
  onToggle: () => void;
  /** Content for the always-visible header */
  header: React.ReactNode;
  /** Content shown when expanded */
  children: React.ReactNode;
  /** Optional testId for the container */
  testId?: string;
  /** Accessible label for the block */
  ariaLabel?: string;
}
```

**Location:** `src/components/ui/collapsible-block.tsx`

**Notes:**
- Handles keyboard interaction (Enter/Space)
- Sets proper ARIA attributes
- The header should include the `ExpandChevron`
- This is a lower-level primitive than `<details>` with more control

---

## Directory Structure After Extraction

```
src/components/ui/
├── copy-button.tsx           # NEW
├── shimmer-text.tsx          # NEW
├── collapsible-output-block.tsx  # NEW
├── expand-chevron.tsx        # NEW
├── status-icon.tsx           # NEW
├── collapsible-block.tsx     # NEW
├── tooltip.tsx               # Existing
├── status-dot.tsx            # Existing
├── status-legend.tsx         # Existing
├── anvil-logo.tsx             # Existing
└── BuildModeIndicator.tsx    # Existing
```

---

## Implementation Steps

### Step 1: Create `CopyButton` component
1. Create `src/components/ui/copy-button.tsx`
2. Move `CopyButton` from bash-tool-block
3. Add size variants if needed
4. Export from ui index (if one exists) or add barrel file

### Step 2: Create `ShimmerText` component
1. Create `src/components/ui/shimmer-text.tsx`
2. Create simple wrapper that applies `animate-shimmer` class conditionally
3. Keep CSS animation in `index.css` (already exists)

### Step 3: Create `ExpandChevron` component
1. Create `src/components/ui/expand-chevron.tsx`
2. Implement size variants with appropriate spacing
3. Handle icon swap between ChevronRight/ChevronDown

### Step 4: Create `StatusIcon` component
1. Create `src/components/ui/status-icon.tsx`
2. Move `StatusIcon` from bash-tool-block
3. Add size variants

### Step 5: Create `CollapsibleOutputBlock` component
1. Create `src/components/ui/collapsible-output-block.tsx`
2. Move `OutputExpandCollapseOverlay` as internal component
3. Add the container logic (max-height, overflow, gradient)
4. Support error variant styling

### Step 6: Create `CollapsibleBlock` component
1. Create `src/components/ui/collapsible-block.tsx`
2. Extract the click handler, keyboard navigation, ARIA patterns
3. Make it a flexible wrapper for any expand/collapse UI

### Step 7: Refactor `BashToolBlock` to use new components
1. Import all new components
2. Replace inline implementations with component usage
3. Verify no visual regression
4. Remove now-unused local definitions

### Step 8: Create barrel export (optional)
1. Create `src/components/ui/index.ts` if it doesn't exist
2. Export all UI components for easier imports

---

## Usage Examples After Extraction

### BashToolBlock (simplified)
```tsx
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";

// In the component:
<div className="flex items-center gap-2">
  <ExpandChevron isExpanded={isExpanded} size="md" />
  <ShimmerText isShimmering={isRunning} className="text-sm text-zinc-200 truncate">
    {description}
  </ShimmerText>
  <CopyButton text={command} label="Copy command" alwaysVisible />
  {!isRunning && exitCode !== 0 && <StatusIcon isSuccess={false} />}
</div>

{isExpanded && hasOutput && (
  <CollapsibleOutputBlock
    isExpanded={isOutputExpanded}
    onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
    isLongContent={isLongOutput}
    variant={hasStderr ? "error" : "default"}
  >
    <pre className="text-xs font-mono p-2">
      <code>{combinedOutput}</code>
    </pre>
  </CollapsibleOutputBlock>
)}
```

### Future GrepToolBlock (example usage)
```tsx
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";

// Search results can use the same patterns
<CollapsibleOutputBlock
  isExpanded={isResultsExpanded}
  onToggle={toggleResults}
  isLongContent={results.length > 20}
>
  {results.map(result => (
    <SearchResult key={result.id} {...result} />
  ))}
</CollapsibleOutputBlock>
```

---

## Testing

1. **Visual regression tests** - Bash block should look identical after refactor
2. **Unit tests for each new component**
   - CopyButton: clipboard interaction, tooltip, visibility states
   - ShimmerText: class application based on prop
   - ExpandChevron: icon swap, size variants
   - StatusIcon: success/error rendering, sizes
   - CollapsibleOutputBlock: height constraints, gradient, button behavior
   - CollapsibleBlock: keyboard interaction, ARIA attributes

---

## Future Considerations

1. **Theme support** - Components should respect theme variables when we add light mode
2. **Animation customization** - Consider making shimmer speed/colors configurable
3. **Compound component patterns** - `CollapsibleBlock.Header` / `CollapsibleBlock.Content` API
4. **Additional copy targets** - Could add "Copy as markdown", "Copy as JSON" variants
5. **Storybook documentation** - Document all variants for design system reference
