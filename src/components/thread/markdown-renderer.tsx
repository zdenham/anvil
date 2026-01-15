import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { InlineCode } from "./inline-code";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * Custom react-markdown wrapper that integrates CodeBlock and InlineCode
 * components for proper code rendering with syntax highlighting.
 */
export function MarkdownRenderer({
  content,
  isStreaming,
  className,
}: MarkdownRendererProps) {
  return (
    <div className={cn("prose prose-invert prose-sm max-w-none", className)}>
      <ReactMarkdown
        components={{
          code: ({ node, className: codeClassName, children, ...props }) => {
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

            return (
              <CodeBlock
                code={codeString}
                language={language}
                isStreaming={isStreaming}
              />
            );
          },
          // Remove default pre wrapper since CodeBlock handles its own container
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
