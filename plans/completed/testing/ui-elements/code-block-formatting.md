# Code Block Formatting Implementation Plan

## Overview

Markdown rendering in chat view with syntax-highlighted code blocks, copy buttons, and collapsible long blocks.

## Current State

- Uses `Streamdown` for basic markdown rendering with streaming
- **Shiki** already configured in `src/lib/syntax-highlighter.ts`
- Collapsible patterns in `ThinkingBlock` and `ToolUseBlock`
- Token rendering pattern in `HighlightedLine` component

## Implementation Steps

### Phase 1: Core Hook - `use-code-highlight.ts`

**File:** `src/hooks/use-code-highlight.ts` (~45 lines)

Create async highlighting hook following `use-reduced-motion.ts` pattern:

```typescript
interface UseCodeHighlightResult {
  tokens: ThemedToken[][] | null;
  isLoading: boolean;
}

export function useCodeHighlight(
  code: string,
  language: string
): UseCodeHighlightResult
```

**Implementation details:**
1. Use `useState` for tokens and loading state
2. Use `useEffect` to trigger async highlighting via `highlightCode()`
3. Debounce during streaming: 100ms delay after last code change
4. Return `null` tokens while loading (allows fallback to unstyled code)
5. Use `useRef` to track previous code+language to avoid re-highlighting unchanged code (avoid complex memoization)

**Pattern to follow:** See `src/hooks/use-reduced-motion.ts` for hook structure.

### Phase 2: InlineCode Component

**File:** `src/components/thread/inline-code.tsx` (~20 lines)

Simple styled component for inline `code` elements:

```typescript
interface InlineCodeProps {
  children: React.ReactNode;
  className?: string;
}
```

**Styling:**
- Use existing prose styles: `prose-code:text-amber-400`
- Add subtle background: `bg-zinc-800/50 px-1 py-0.5 rounded`
- Remove default backticks: `before:content-none after:content-none`

### Phase 3: CodeBlock Component

**File:** `src/components/thread/code-block.tsx` (~100 lines)

> **Note:** Keep this file under 250 lines per agents.md guidelines. Sub-components (CopyButton, HighlightedCode, CollapsedOverlay) should remain inline since they are tightly coupled and simple.

**Props interface:**
```typescript
interface CodeBlockProps {
  code: string;
  language?: string;
  isStreaming?: boolean;
  className?: string;
}
```

**Structure (follow `ToolUseBlock` pattern):**

1. **State management:**
   - `isExpanded` state (default: `code.split('\n').length <= 20`)
   - `isCopied` state for copy button feedback
   - Call `useCodeHighlight(code, language)`

2. **Render structure:**
```tsx
<div className="relative group rounded-lg border border-zinc-800 bg-zinc-900">
  {/* Header bar */}
  <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
    <span className="text-xs text-zinc-400">{language}</span>
    <CopyButton code={code} />
  </div>

  {/* Code content */}
  <div className="overflow-x-auto">
    <pre className="p-3 text-sm font-mono">
      {isLoading ? (
        <code>{code}</code>  // Unstyled fallback
      ) : (
        <HighlightedCode tokens={tokens} />
      )}
    </pre>
  </div>

  {/* Collapse toggle (if >20 lines) */}
  {lineCount > 20 && !isExpanded && (
    <CollapsedOverlay
      hiddenLines={lineCount - 10}
      onExpand={() => setIsExpanded(true)}
    />
  )}
</div>
```

3. **Sub-components (inline or extracted):**

**CopyButton** (~25 lines):
```typescript
function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity ..."
      aria-label={copied ? "Copied" : "Copy code"}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
```

**HighlightedCode** (~20 lines):
```typescript
function HighlightedCode({ tokens }: { tokens: ThemedToken[][] }) {
  return (
    <code>
      {tokens.map((line, i) => (
        <div key={i}>
          {line.length === 0 ? (
            <span>&nbsp;</span>
          ) : (
            line.map((token, j) => (
              <span key={j} style={{ color: token.color }}>
                {token.content}
              </span>
            ))
          )}
        </div>
      ))}
    </code>
  );
}
```

**Pattern to follow:** See `src/components/diff-viewer/highlighted-line.tsx` for token rendering.

**CollapsedOverlay** (~15 lines):
```typescript
function CollapsedOverlay({
  hiddenLines,
  onExpand
}: {
  hiddenLines: number;
  onExpand: () => void;
}) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-zinc-900 to-transparent flex items-end justify-center pb-2">
      <button
        type="button"
        onClick={onExpand}
        className="text-xs text-accent-400 hover:underline"
      >
        Show {hiddenLines} more lines
      </button>
    </div>
  );
}
```

### Phase 4: MarkdownRenderer Component

**File:** `src/components/thread/markdown-renderer.tsx` (~80 lines)

> **Note:** This component coordinates markdown parsing and code block rendering. Keep it focused on this single responsibility.

Custom react-markdown wrapper with code block integration:

```typescript
interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}
```

**Implementation:**
```tsx
import ReactMarkdown from "react-markdown";
import { CodeBlock } from "./code-block";
import { InlineCode } from "./inline-code";

export function MarkdownRenderer({ content, isStreaming, className }: MarkdownRendererProps) {
  return (
    <div className={cn("prose prose-invert prose-sm max-w-none", className)}>
      <ReactMarkdown
        components={{
          code: ({ node, inline, className, children, ...props }) => {
            // Extract language from className (e.g., "language-typescript")
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : undefined;
            const codeString = String(children).replace(/\n$/, "");

            if (inline) {
              return <InlineCode {...props}>{children}</InlineCode>;
            }

            return (
              <CodeBlock
                code={codeString}
                language={language}
                isStreaming={isStreaming}
              />
            );
          },
          pre: ({ children }) => <>{children}</>, // Remove default pre wrapper
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

### Phase 5: TextBlock Integration

**File:** `src/components/thread/text-block.tsx` (modify existing)

**Decision: Keep Streamdown for streaming, add MarkdownRenderer option**

The challenge is that `Streamdown` handles incomplete markdown during streaming (e.g., unclosed code fences). Options:

1. **Option A:** Use Streamdown always, enhance its code rendering with custom CSS
2. **Option B:** Use MarkdownRenderer for complete messages, Streamdown for streaming
3. **Option C:** Wrap Streamdown output and enhance code blocks post-render

**Recommended: Option B**

```tsx
export function TextBlock({ content, isStreaming = false, className }: TextBlockProps) {
  return (
    <div className={cn("...", className)}>
      {isStreaming ? (
        <>
          <Streamdown>{content}</Streamdown>
          <StreamingCursor />
        </>
      ) : (
        <MarkdownRenderer content={content} />
      )}
    </div>
  );
}
```

**Trade-off:** Code blocks won't be syntax-highlighted during streaming, only after completion. This is acceptable because:
- Streaming is fast (usually <5 seconds)
- Avoids complex streaming token management
- Reduces flicker during rapid updates

### Phase 6: Keyboard Navigation (Optional Enhancement)

**File:** `src/hooks/use-code-block-keyboard.ts` (~40 lines)

Only implement if keyboard navigation is a priority. Otherwise defer.

```typescript
export function useCodeBlockKeyboard(
  containerRef: React.RefObject<HTMLElement>
) {
  // Handle Tab to focus next code block
  // Handle Cmd+C to copy focused block
  // Handle Enter/Space to toggle collapse
}
```

---

## File Structure (Final)

```
src/
  components/thread/
    code-block.tsx           # ~100 lines (includes CopyButton, HighlightedCode, CollapsedOverlay)
    inline-code.tsx          # ~20 lines
    markdown-renderer.tsx    # ~80 lines
    text-block.tsx           # Modified (~50 lines)
  hooks/
    use-code-highlight.ts    # ~45 lines
```

> **Line Count Compliance:** All files remain under the 250-line limit per agents.md guidelines. If any file approaches this limit during implementation, extract sub-components to separate files.

---

## Testing Strategy

Tests follow the patterns in `docs/testing.md`. UI components use `.ui.test.tsx` suffix and run via `pnpm test:ui`.

### Unit Tests

**File:** `src/hooks/use-code-highlight.test.ts`

```typescript
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCodeHighlight } from "./use-code-highlight";

// Mock the syntax highlighter
vi.mock("@/lib/syntax-highlighter", () => ({
  highlightCode: vi.fn(),
  isHighlighterReady: vi.fn(() => true),
}));

describe("useCodeHighlight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns loading state initially", () => {
    const { result } = renderHook(() =>
      useCodeHighlight("const x = 1;", "typescript")
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.tokens).toBeNull();
  });

  it("returns tokens after highlighting completes", async () => {
    const mockTokens = [[{ content: "const", color: "#ff0000" }]];
    vi.mocked(highlightCode).mockResolvedValue(mockTokens);

    const { result } = renderHook(() =>
      useCodeHighlight("const x = 1;", "typescript")
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tokens).toEqual(mockTokens);
  });

  it("debounces rapid code changes", async () => {
    const { result, rerender } = renderHook(
      ({ code }) => useCodeHighlight(code, "typescript"),
      { initialProps: { code: "a" } }
    );

    // Rapid updates
    rerender({ code: "ab" });
    rerender({ code: "abc" });
    rerender({ code: "abcd" });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should only call highlightCode once after debounce
    expect(highlightCode).toHaveBeenCalledTimes(1);
    expect(highlightCode).toHaveBeenCalledWith("abcd", "typescript");
  });

  it("handles highlighting errors gracefully", async () => {
    vi.mocked(highlightCode).mockRejectedValue(new Error("Failed"));

    const { result } = renderHook(() =>
      useCodeHighlight("bad code", "typescript")
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should still return null tokens (fallback to unstyled)
    expect(result.current.tokens).toBeNull();
  });
});
```

### UI Component Tests

**File:** `src/components/thread/code-block.ui.test.tsx`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@/test/helpers";
import { CodeBlock } from "./code-block";

// Mock clipboard API
const mockWriteText = vi.fn();
Object.assign(navigator, {
  clipboard: { writeText: mockWriteText },
});

// Mock syntax highlighter
vi.mock("@/lib/syntax-highlighter", () => ({
  highlightCode: vi.fn().mockResolvedValue([
    [{ content: "const", color: "#ff0000" }, { content: " x = 1;", color: "#ffffff" }],
  ]),
  isHighlighterReady: vi.fn(() => true),
}));

describe("CodeBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders code content", async () => {
      render(<CodeBlock code="const x = 1;" language="typescript" />);

      await waitFor(() => {
        expect(screen.getByText("const")).toBeInTheDocument();
      });
    });

    it("displays language label", () => {
      render(<CodeBlock code="print('hello')" language="python" />);

      expect(screen.getByText("python")).toBeInTheDocument();
    });

    it("shows unstyled code while loading", () => {
      // Mock slow highlighting
      vi.mocked(highlightCode).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<CodeBlock code="const x = 1;" language="typescript" />);

      // Code should still be visible (unstyled)
      expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    });
  });

  describe("copy functionality", () => {
    it("copies code to clipboard on button click", async () => {
      render(<CodeBlock code="const x = 1;" language="typescript" />);

      const copyButton = screen.getByRole("button", { name: /copy/i });
      fireEvent.click(copyButton);

      expect(mockWriteText).toHaveBeenCalledWith("const x = 1;");
    });

    it("shows copied feedback after copying", async () => {
      render(<CodeBlock code="const x = 1;" language="typescript" />);

      const copyButton = screen.getByRole("button", { name: /copy/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
      });
    });

    it("resets copied state after 2 seconds", async () => {
      vi.useFakeTimers();

      render(<CodeBlock code="const x = 1;" language="typescript" />);

      fireEvent.click(screen.getByRole("button", { name: /copy/i }));

      // Fast-forward 2 seconds
      vi.advanceTimersByTime(2000);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
      });

      vi.useRealTimers();
    });
  });

  describe("collapsing", () => {
    const longCode = Array(30).fill("line").join("\n");

    it("collapses long code blocks by default", () => {
      render(<CodeBlock code={longCode} language="typescript" />);

      expect(screen.getByText(/show.*more lines/i)).toBeInTheDocument();
    });

    it("expands when clicking expand button", () => {
      render(<CodeBlock code={longCode} language="typescript" />);

      fireEvent.click(screen.getByText(/show.*more lines/i));

      expect(screen.queryByText(/show.*more lines/i)).not.toBeInTheDocument();
    });

    it("does not collapse short code blocks", () => {
      render(<CodeBlock code="const x = 1;" language="typescript" />);

      expect(screen.queryByText(/show.*more lines/i)).not.toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has accessible copy button", () => {
      render(<CodeBlock code="const x = 1;" language="typescript" />);

      const copyButton = screen.getByRole("button");
      expect(copyButton).toHaveAccessibleName();
    });

    it("uses semantic code element", async () => {
      render(<CodeBlock code="const x = 1;" language="typescript" />);

      await waitFor(() => {
        expect(screen.getByRole("code")).toBeInTheDocument();
      });
    });
  });
});
```

**File:** `src/components/thread/inline-code.ui.test.tsx`

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@/test/helpers";
import { InlineCode } from "./inline-code";

describe("InlineCode", () => {
  it("renders children as code", () => {
    render(<InlineCode>myVariable</InlineCode>);

    const code = screen.getByText("myVariable");
    expect(code.tagName).toBe("CODE");
  });

  it("applies custom className", () => {
    render(<InlineCode className="custom-class">test</InlineCode>);

    expect(screen.getByText("test")).toHaveClass("custom-class");
  });
});
```

**File:** `src/components/thread/markdown-renderer.ui.test.tsx`

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@/test/helpers";
import { MarkdownRenderer } from "./markdown-renderer";

vi.mock("@/lib/syntax-highlighter", () => ({
  highlightCode: vi.fn().mockResolvedValue([
    [{ content: "const x = 1;", color: "#ffffff" }],
  ]),
  isHighlighterReady: vi.fn(() => true),
}));

describe("MarkdownRenderer", () => {
  describe("inline code", () => {
    it("renders inline code with styling", () => {
      render(<MarkdownRenderer content="Use `myFunction()` here" />);

      const code = screen.getByText("myFunction()");
      expect(code.tagName).toBe("CODE");
    });
  });

  describe("code blocks", () => {
    it("renders fenced code blocks with syntax highlighting", async () => {
      const markdown = "```typescript\nconst x = 1;\n```";
      render(<MarkdownRenderer content={markdown} />);

      await waitFor(() => {
        expect(screen.getByText("typescript")).toBeInTheDocument();
      });
    });

    it("handles code blocks without language", async () => {
      const markdown = "```\nplain text\n```";
      render(<MarkdownRenderer content={markdown} />);

      await waitFor(() => {
        expect(screen.getByText("plain text")).toBeInTheDocument();
      });
    });
  });

  describe("mixed content", () => {
    it("renders paragraphs, inline code, and code blocks together", async () => {
      const markdown = `
# Heading

Use \`myFunction()\` like this:

\`\`\`typescript
const result = myFunction();
\`\`\`

That's it!
      `.trim();

      render(<MarkdownRenderer content={markdown} />);

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
        expect(screen.getByText("myFunction()")).toBeInTheDocument();
        expect(screen.getByText("typescript")).toBeInTheDocument();
        expect(screen.getByText(/That's it!/)).toBeInTheDocument();
      });
    });
  });
});
```

### Integration Tests

**File:** `src/components/thread/text-block.ui.test.tsx`

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@/test/helpers";
import { TextBlock } from "./text-block";

vi.mock("@/lib/syntax-highlighter", () => ({
  highlightCode: vi.fn().mockResolvedValue([]),
  isHighlighterReady: vi.fn(() => true),
}));

describe("TextBlock", () => {
  describe("streaming mode", () => {
    it("uses Streamdown during streaming", () => {
      render(<TextBlock content="Hello" isStreaming={true} />);

      // Streamdown renders content
      expect(screen.getByText("Hello")).toBeInTheDocument();
    });

    it("shows streaming cursor during streaming", () => {
      render(<TextBlock content="Hello" isStreaming={true} />);

      expect(screen.getByText("Assistant is typing")).toBeInTheDocument();
    });
  });

  describe("complete mode", () => {
    it("uses MarkdownRenderer when not streaming", async () => {
      const markdown = "```typescript\nconst x = 1;\n```";
      render(<TextBlock content={markdown} isStreaming={false} />);

      await waitFor(() => {
        // MarkdownRenderer renders with language label
        expect(screen.getByText("typescript")).toBeInTheDocument();
      });
    });

    it("does not show streaming cursor when complete", () => {
      render(<TextBlock content="Hello" isStreaming={false} />);

      expect(screen.queryByText("Assistant is typing")).not.toBeInTheDocument();
    });
  });
});
```

### Edge Case Tests

**File:** `src/components/thread/code-block-edge-cases.ui.test.tsx`

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@/test/helpers";
import { CodeBlock } from "./code-block";

vi.mock("@/lib/syntax-highlighter", () => ({
  highlightCode: vi.fn().mockResolvedValue([]),
  isHighlighterReady: vi.fn(() => true),
}));

describe("CodeBlock edge cases", () => {
  it("handles empty code", () => {
    render(<CodeBlock code="" language="typescript" />);

    // Should render without error
    expect(screen.getByText("typescript")).toBeInTheDocument();
  });

  it("handles unknown language", async () => {
    render(<CodeBlock code="some code" language="unknown-lang" />);

    await waitFor(() => {
      expect(screen.getByText("some code")).toBeInTheDocument();
    });
  });

  it("handles very long lines without breaking layout", () => {
    const longLine = "a".repeat(1000);
    render(<CodeBlock code={longLine} language="text" />);

    // Should have horizontal scroll, not overflow
    const pre = screen.getByRole("code").closest("pre");
    expect(pre).toHaveClass("overflow-x-auto");
  });

  it("handles code with special characters", async () => {
    const code = "<script>alert('xss')</script>";
    render(<CodeBlock code={code} language="html" />);

    await waitFor(() => {
      // Should be escaped, not executed
      expect(screen.getByText(/alert/)).toBeInTheDocument();
    });
  });

  it("handles code with unicode characters", async () => {
    const code = "const emoji = '🎉';";
    render(<CodeBlock code={code} language="javascript" />);

    await waitFor(() => {
      expect(screen.getByText(/🎉/)).toBeInTheDocument();
    });
  });

  it("handles rapid content updates gracefully", async () => {
    const { rerender } = render(
      <CodeBlock code="v1" language="typescript" />
    );

    // Rapid updates
    for (let i = 2; i <= 10; i++) {
      rerender(<CodeBlock code={`v${i}`} language="typescript" />);
    }

    await waitFor(() => {
      expect(screen.getByText("v10")).toBeInTheDocument();
    });
  });
});
```

---

## Test Commands

```bash
# Run all tests
pnpm test

# Run only code-block related tests
pnpm test -- --grep "CodeBlock|code-highlight|MarkdownRenderer|InlineCode"

# Run with coverage
pnpm test -- --coverage

# Type check
pnpm tsc --noEmit
```

---

## Performance Considerations

1. **Async highlighting**: Show unstyled code immediately, apply tokens when ready
2. **Debounce**: 100ms delay during streaming to batch rapid updates
3. **Skip unchanged**: Use `useRef` to track previous code+language and skip re-highlighting if unchanged
4. **Lazy loading**: Languages not in preload list are loaded on demand (already handled by `syntax-highlighter.ts`)

---

## Dependencies

**Already installed:**
- `shiki` - Syntax highlighting
- `react-markdown` - Markdown parsing
- `streamdown` - Streaming markdown

**Icons (already available via lucide-react):**
- `Copy` - Copy button icon
- `Check` - Copied confirmation icon

---

## Critical Files Reference

| File | Purpose |
|------|---------|
| `src/lib/syntax-highlighter.ts` | Shiki setup, `highlightCode()` function |
| `src/components/diff-viewer/highlighted-line.tsx` | Token rendering pattern |
| `src/components/thread/thinking-block.tsx` | Collapsible details pattern |
| `src/components/thread/tool-use-block.tsx` | Complex collapsible pattern |
| `src/components/thread/text-block.tsx` | Integration point |
| `src/components/spotlight/spotlight.tsx` | `navigator.clipboard` pattern |
| `src/test/helpers/render.tsx` | Test utilities |

---

## Implementation Order

1. `use-code-highlight.ts` + unit tests
2. `inline-code.tsx` + UI tests
3. `code-block.tsx` + UI tests + edge case tests
4. `markdown-renderer.tsx` + UI tests
5. Modify `text-block.tsx` + integration tests
6. Run `pnpm test:ui` to verify all tests pass
7. Run `pnpm tsc --noEmit` to verify type safety
8. Manual verification in running app
9. (Optional) Keyboard navigation hook

---

## Pattern Compliance Checklist

| Pattern | Status | Notes |
|---------|--------|-------|
| **Adapters** | N/A | No cross-platform code needed; components are frontend-only |
| **Disk as Truth** | N/A | No persistent state; purely UI rendering |
| **Event Bridge** | N/A | No events emitted or consumed |
| **Entity Stores** | N/A | No entity management; pure presentational components |
| **YAGNI** | Compliant | Phase 6 (keyboard navigation) marked as optional/deferred |
| **Zod at Boundaries** | Compliant | Props use plain TypeScript interfaces (compile-time safety) |
| **Type Layering** | Compliant | All code lives in `src/` (frontend layer), imports only from `@/` |
| **File Size (<250 lines)** | Compliant | All files estimated under limit |
| **Function Size (<50 lines)** | Compliant | All functions are concise |
| **Testing** | Compliant | Uses `.ui.test.tsx` pattern for UI tests; `pnpm test:ui` command |
| **Logging** | Compliant | New code should use `logger` from `@/lib/logger-client` if logging is needed |
| **kebab-case filenames** | Compliant | All new files use kebab-case |
| **Early returns** | Compliant | Hook returns early when loading; fallback patterns used |
| **Strong types** | Compliant | No `any` types; uses existing `ThemedToken` from Shiki |
