import { memo, useMemo, useRef, type MutableRefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { InlineCode } from "./inline-code";
import { navigationService } from "@/stores/navigation-service";
import { logger } from "@/lib/logger-client";
import { looksLikeFilePath, resolvePath, autoLinkFilePaths } from "./file-path-utils";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
  /** Working directory for resolving relative file paths */
  workingDirectory?: string;
  /** Callback when a file link is clicked (defaults to navigationService.navigateToFile) */
  onFileClick?: (absolutePath: string) => void;
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
  workingDirectory,
  onFileClick,
}: MarkdownRendererProps) {
  const resolvedWorkingDirectory = workingDirectory;

  // Use ref for isStreaming so the components useMemo stays stable across streaming toggles.
  // CodeBlock already ignores this prop, but we keep it for API compat.
  const isStreamingRef = useRef(isStreaming) as MutableRefObject<boolean | undefined>;
  isStreamingRef.current = isStreaming;

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
        // If inline code looks like a file path and we have a working directory, make it clickable
        if (resolvedWorkingDirectory && looksLikeFilePath(codeString)) {
          const handleFileClick = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const absolutePath = resolvePath(codeString, resolvedWorkingDirectory);
            if (onFileClick) {
              onFileClick(absolutePath);
            } else {
              navigationService.navigateToFile(absolutePath);
            }
          };
          return (
            <InlineCode
              {...props}
              className="cursor-pointer hover:text-amber-300 hover:underline"
              onClick={handleFileClick}
            >
              {children}
            </InlineCode>
          );
        }
        return <InlineCode {...props}>{children}</InlineCode>;
      }

      // Generate stable key from content hash + language
      const stableKey = `cb-${hashCode(codeString)}-${language || "plain"}`;

      return (
        <CodeBlock
          key={stableKey}
          code={codeString}
          language={language}
          isStreaming={isStreamingRef.current}
        />
      );
    },
    // Remove default pre wrapper since CodeBlock handles its own container
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,

    // Custom link component to open external links in system browser
    a: ({ href, children, ...props }: {
      href?: string;
      children?: React.ReactNode;
    }) => {
      const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (href) {
          openUrl(href).catch((err) => {
            logger.error("[MarkdownRenderer] Failed to open URL:", err);
          });
        }
      };

      // Only intercept http/https links
      const isExternal = href?.startsWith("http://") || href?.startsWith("https://");

      if (isExternal) {
        return (
          <a
            href={href}
            onClick={handleClick}
            className="text-zinc-200 hover:text-white underline cursor-pointer"
            {...props}
          >
            {children}
          </a>
        );
      }

      // File-like links → open in content pane
      if (href && resolvedWorkingDirectory && looksLikeFilePath(href)) {
        const handleFileClick = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const absolutePath = resolvePath(href, resolvedWorkingDirectory);
          if (onFileClick) {
            onFileClick(absolutePath);
          } else {
            navigationService.navigateToFile(absolutePath);
          }
        };
        return (
          <a
            href={href}
            onClick={handleFileClick}
            className="text-zinc-200 hover:text-white underline cursor-pointer"
            {...props}
          >
            {children}
          </a>
        );
      }

      // For non-external links, render normally
      return <a href={href} {...props}>{children}</a>;
    },

    // Table components for GFM tables
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto my-2">
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
      <th className="px-2 py-1.5 text-left font-medium text-zinc-300">
        {children}
      </th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-2 py-1.5 text-zinc-400">{children}</td>
    ),
  }), [resolvedWorkingDirectory, onFileClick]);

  // Pre-process content to auto-link bare file paths in text
  const processedContent = useMemo(
    () => resolvedWorkingDirectory ? autoLinkFilePaths(content) : content,
    [content, resolvedWorkingDirectory]
  );

  return (
    <div className={cn("prose prose-invert prose-sm prose-p:leading-relaxed max-w-none", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});
