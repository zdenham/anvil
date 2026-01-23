import React, {
  forwardRef,
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
} from "react";
import { cn } from "../../lib/utils";

export type SearchInputVariant = "spotlight" | "compact";

const VARIANT_STYLES = {
  spotlight: {
    fontSize: "text-3xl",
    expandedFontSize: "text-xl",
    padding: "px-4 py-3",
    background: "bg-surface-900/80 backdrop-blur-xl",
    measureFontSize: "text-3xl",
    rows: { collapsed: 1, expanded: 6 },
    borderRadius: "rounded-xl",
    borderRadiusTop: "rounded-t-xl",
  },
  compact: {
    fontSize: "text-sm",
    expandedFontSize: "text-sm",
    padding: "px-3 py-2",
    background: "bg-surface-900",
    measureFontSize: "text-sm",
    rows: { collapsed: 1, expanded: 4 },
    borderRadius: "rounded-lg",
    borderRadiusTop: "rounded-t-lg",
  },
} as const;

export interface SearchInputProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  /** Visual variant: "spotlight" (large, frosted) or "compact" (thread input) */
  variant?: SearchInputVariant;
  /** Whether there's content below this input (affects border radius when not expanded) */
  hasContentBelow?: boolean;
  /** Width fill ratio (0-1) at which to expand. Default 0.85 */
  expandThreshold?: number;
  /** Callback when expansion state changes */
  onExpandedChange?: (expanded: boolean) => void;
}

/**
 * Shared search input component for spotlight-style panels.
 * Expands to a taller height when content approaches horizontal overflow.
 */
export const SearchInput = forwardRef<HTMLTextAreaElement, SearchInputProps>(
  (
    {
      className,
      variant = "spotlight",
      hasContentBelow = false,
      expandThreshold = 0.85,
      onExpandedChange,
      onChange,
      value,
      ...props
    },
    ref
  ) => {
    const styles = VARIANT_STYLES[variant];
    const internalRef = useRef<HTMLTextAreaElement>(null);
    const measureRef = useRef<HTMLSpanElement>(null);
    const [isExpanded, setIsExpanded] = useState(false);

    const checkExpansion = useCallback((): boolean => {
      const textarea = internalRef.current;
      const measure = measureRef.current;
      if (!textarea || !measure) return false;

      const lines = textarea.value.split("\n");
      const lastLine = lines[lines.length - 1] || "";

      measure.textContent = lastLine || "\u00A0";
      const textWidth = measure.offsetWidth;
      const containerWidth = textarea.clientWidth - 32; // Account for px-4 padding

      const shouldExpand =
        lines.length > 1 || textWidth / containerWidth > expandThreshold;

      // Immediately update DOM classes for font size change.
      // This is critical for programmatic value changes (history cycling, auto-complete).
      // When typing, checkExpansion runs synchronously in handleChange before React renders.
      // But for programmatic changes, React renders first, then useEffect calls checkExpansion.
      // Without direct DOM manipulation, font size changes after resize, causing cursor glitch.
      // By updating classList directly, font size changes synchronously before any resize.
      if (shouldExpand) {
        textarea.classList.remove(styles.fontSize);
        textarea.classList.add(styles.expandedFontSize);
      } else {
        textarea.classList.remove(styles.expandedFontSize);
        textarea.classList.add(styles.fontSize);
      }

      setIsExpanded((prev) => {
        // Schedule callback outside render cycle to avoid setState-in-render warning
        if (prev !== shouldExpand) {
          queueMicrotask(() => onExpandedChange?.(shouldExpand));
        }
        return shouldExpand;
      });

      return shouldExpand;
    }, [expandThreshold, onExpandedChange, styles.fontSize, styles.expandedFontSize]);

    useImperativeHandle(
      ref,
      () =>
        Object.assign(internalRef.current!, {
          checkExpansion,
        }),
      [checkExpansion]
    );

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      checkExpansion();
      onChange?.(e);
    };

    useEffect(() => {
      checkExpansion();
    }, [value, checkExpansion]);

    return (
      <div className="search-input">
        {/* Hidden span mirrors textarea styling for text measurement */}
        <span
          ref={measureRef}
          className={cn(
            "fixed -top-[9999px] -left-[9999px] whitespace-pre font-light pointer-events-none",
            styles.measureFontSize
          )}
          aria-hidden="true"
        />
        <textarea
          ref={internalRef}
          rows={isExpanded ? styles.rows.expanded : styles.rows.collapsed}
          className={cn(
            "block w-full resize-none",
            styles.padding,
            styles.background,
            "text-white font-light",
            isExpanded ? styles.expandedFontSize : styles.fontSize,
            "focus:outline-none",
            "border border-surface-700/50",
            // When content below, use top-only rounded corners; otherwise full rounded
            hasContentBelow
              ? `${styles.borderRadiusTop} border-b-0`
              : styles.borderRadius,
            className
          )}
          spellCheck={false}
          onChange={handleChange}
          value={value}
          {...props}
        />
      </div>
    );
  }
);

SearchInput.displayName = "SearchInput";
