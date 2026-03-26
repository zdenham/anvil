import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="prose prose-invert prose-lg max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children, ...props }) => {
            // Bold tagline gets default styling; plain paragraphs get smaller/muted
            const hasBold =
              Array.isArray(children) &&
              children.some(
                (c) =>
                  typeof c === "object" &&
                  c !== null &&
                  "type" in c &&
                  c.type === "strong"
              );
            if (hasBold)
              return (
                <p className="text-xl" {...props}>
                  {children}
                </p>
              );
            return (
              <p
                className="text-sm text-surface-400 leading-relaxed font-sans"
                {...props}
              >
                {children}
              </p>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
