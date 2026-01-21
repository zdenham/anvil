import { memo, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { InlineCode } from "./inline-code";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * Simple hash function for generating stable keys from code content.
 */
function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Custom react-markdown wrapper that integrates CodeBlock and InlineCode
 * components for proper code rendering with syntax highlighting.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  isStreaming,
  className,
}: MarkdownRendererProps) {
  // Track code block index for stable keys within a render
  const codeBlockIndexRef = useRef(0);

  // Reset counter on each render
  codeBlockIndexRef.current = 0;

  const components = useMemo(() => ({
    code: ({ node, className: codeClassName, children, ...props }: {
      node?: { position?: { start: { line: number }; end: { line: number } } };
      className?: string;
      children?: React.ReactNode;
    }) => {
      // Extract language from className (e.g., "language-typescript")
      const match = /language-(\w+)/.exec(codeClassName || "");
      const language = match ? match[1] : undefined;
      const codeString = String(children).replace(/\n$/, "");

      // In react-markdown v9+, inline code is detected by checking if
      // the code is single-line and doesn't contain newlines.
      // Code blocks have a language class or contain newlines.
      const isInline =
        node?.position?.start.line === node?.position?.end.line &&
        !String(children).includes("\n");

      if (isInline) {
        return <InlineCode {...props}>{children}</InlineCode>;
      }

      // Generate stable key from content hash + language
      const stableKey = `cb-${hashCode(codeString)}-${language || "plain"}`;

      return (
        <CodeBlock
          key={stableKey}
          code={codeString}
          language={language}
          isStreaming={isStreaming}
        />
      );
    },
    // Remove default pre wrapper since CodeBlock handles its own container
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,

    // Table components for GFM tables
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="bg-zinc-800/50 border-b border-zinc-700">
        {children}
      </thead>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
      <tbody className="divide-y divide-zinc-800">{children}</tbody>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => (
      <tr className="hover:bg-zinc-800/30">{children}</tr>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="px-3 py-2 text-left font-medium text-zinc-300">
        {children}
      </th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-3 py-2 text-zinc-400">{children}</td>
    ),
  }), [isStreaming]);

  return (
    <div className={cn("prose prose-invert prose-sm max-w-none", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
