# Sub-Plan: MarkdownRenderer Component

## Overview

Create a custom react-markdown wrapper that integrates CodeBlock and InlineCode components for proper code rendering.

## Dependencies

- **Requires:** `02-inline-code-component.md` (uses InlineCode)
- **Requires:** `03-code-block-component.md` (uses CodeBlock)

## Parallel Execution Group

**Group 3** - Must wait for Groups 1 and 2 to complete

## Scope

### File to Create

`src/components/thread/markdown-renderer.tsx` (~80 lines)

### Interface

```typescript
interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}
```

### Implementation

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

### Key Responsibilities

1. Parse markdown content using react-markdown
2. Route inline code to InlineCode component
3. Route fenced code blocks to CodeBlock component
4. Extract language from className (e.g., "language-typescript" -> "typescript")
5. Remove default `<pre>` wrapper since CodeBlock handles its own

### Reference Files

- Existing react-markdown usage in the codebase (if any)
- `src/components/thread/code-block.tsx`
- `src/components/thread/inline-code.tsx`

## Tests

### File to Create

`src/components/thread/markdown-renderer.ui.test.tsx`

### Test Categories

**Inline Code:**
1. Renders inline code with InlineCode component

**Code Blocks:**
1. Renders fenced code blocks with syntax highlighting
2. Handles code blocks without language specified

**Mixed Content:**
1. Renders paragraphs, inline code, and code blocks together correctly

## Acceptance Criteria

- [ ] Component exports `MarkdownRenderer` function
- [ ] Inline code uses InlineCode component
- [ ] Fenced code blocks use CodeBlock component
- [ ] Language is correctly extracted from className
- [ ] Default `<pre>` wrapper is removed
- [ ] Prose styling is applied to container
- [ ] All UI tests pass via `pnpm test:ui`
- [ ] TypeScript compiles without errors

## react-markdown v9 Compatibility Note

In react-markdown v9+, the `inline` prop is no longer passed to the `code` component. Instead, detect inline code by checking if the parent element is NOT a `<pre>` tag:

```tsx
code: ({ node, className, children, ...props }) => {
  // In v9+, check if parent is <pre> to determine if it's a code block
  const isInline = node?.position?.start.line === node?.position?.end.line &&
    !String(children).includes('\n');

  // Alternative: check parent node type if available
  // const isInline = node?.parent?.tagName !== 'pre';

  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : undefined;
  const codeString = String(children).replace(/\n$/, "");

  if (isInline) {
    return <InlineCode {...props}>{children}</InlineCode>;
  }

  return (
    <CodeBlock
      code={codeString}
      language={language}
      isStreaming={isStreaming}
    />
  );
}
```

Check the installed react-markdown version and adjust the inline detection accordingly.

## Export Updates

After creating this component, update `src/components/thread/index.ts` to export it:

```typescript
export { MarkdownRenderer } from "./markdown-renderer";
```

## Estimated Lines

~80 lines for implementation + ~60 lines for tests
