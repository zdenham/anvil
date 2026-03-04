/**
 * FileContent
 *
 * Displays a file from disk with syntax highlighting or media preview.
 * Reads fresh from disk on every mount (no caching).
 *
 * - Media files (images, video, audio, PDF): rendered via asset protocol URL
 * - SVG files: rendered visually with source toggle
 * - Markdown files: rendered via MarkdownRenderer with source toggle
 * - Code/text files: line-numbered, syntax-highlighted via Shiki
 * - Binary/missing files: error message
 */

import { useState, useEffect, useRef, memo } from "react";
import { convertFileSrc } from "@/lib/browser-stubs";
import { FilesystemClient } from "@/lib/filesystem-client";
import { getLanguageFromPath } from "@/lib/language-detection";
import { getFileCategory, type FileCategory } from "@/lib/file-categories";
import { useCodeHighlight } from "@/hooks/use-code-highlight";
import { MarkdownRenderer } from "@/components/thread/markdown-renderer";
import { MediaPreview } from "./media-preview";
import { logger } from "@/lib/logger-client";
import type { ThemedToken } from "@/lib/syntax-highlighter";

const filesystemClient = new FilesystemClient();

interface FileContentProps {
  filePath: string;
  lineNumber?: number;
}

type FileState =
  | { status: "loading" }
  | { status: "loaded"; content: string; language: string }
  | { status: "media"; category: FileCategory; assetUrl: string }
  | { status: "error"; message: string };

/** Detect binary content by checking for null bytes */
function isBinaryContent(content: string): boolean {
  return content.includes("\0");
}

export function FileContent({ filePath, lineNumber }: FileContentProps) {
  const [fileState, setFileState] = useState<FileState>({ status: "loading" });
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFileState({ status: "loading" });
    setViewMode("rendered");

    const category = getFileCategory(filePath);

    // Non-text media files skip readFile entirely — use asset protocol
    if (category !== "text" && category !== "svg") {
      const assetUrl = convertFileSrc(filePath);
      setFileState({ status: "media", category, assetUrl });
      return;
    }

    // SVG: prepare asset URL for rendered mode, but also load text for source mode
    const assetUrl = category === "svg" ? convertFileSrc(filePath) : null;
    let cancelled = false;

    async function loadFile() {
      try {
        const content = await filesystemClient.readFile(filePath);
        if (cancelled) return;

        if (isBinaryContent(content)) {
          setFileState({ status: "error", message: "Binary file — cannot display" });
          return;
        }

        if (assetUrl) {
          setFileState({ status: "media", category: "svg", assetUrl });
        } else {
          const language = getLanguageFromPath(filePath);
          setFileState({ status: "loaded", content, language });
        }
      } catch (err) {
        if (cancelled) return;
        logger.error("[FileContent] Failed to read file:", err);

        // SVG can still render visually even if text read fails
        if (assetUrl) {
          setFileState({ status: "media", category: "svg", assetUrl });
        } else {
          setFileState({ status: "error", message: "File not found or cannot be read" });
        }
      }
    }

    loadFile();
    return () => { cancelled = true; };
  }, [filePath]);

  // Scroll to the target line after content renders
  useEffect(() => {
    if (!lineNumber || fileState.status !== "loaded") return;

    // Allow a frame for the DOM to render before scrolling
    const frameId = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const targetEl = container.querySelector(
        `[data-line-number="${lineNumber}"]`
      ) as HTMLElement | null;

      if (targetEl) {
        targetEl.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [lineNumber, fileState.status]);

  if (fileState.status === "loading") {
    return <CenteredMessage>Loading...</CenteredMessage>;
  }

  if (fileState.status === "error") {
    return <CenteredMessage>{fileState.message}</CenteredMessage>;
  }

  if (fileState.status === "media") {
    return (
      <MediaPreview
        category={fileState.category}
        assetUrl={fileState.assetUrl}
        filePath={filePath}
        viewMode={viewMode}
        renderToggle={() => <ViewModeToggle viewMode={viewMode} onToggle={setViewMode} />}
        renderHighlighted={(content, lang) => (
          <HighlightedFileView content={content} language={lang} />
        )}
      />
    );
  }

  const { content, language } = fileState;
  const isMarkdown = language === "markdown" || language === "mdx";

  if (isMarkdown && viewMode === "rendered") {
    return (
      <div data-testid="file-content" className="flex flex-col h-full">
        <ViewModeToggle viewMode={viewMode} onToggle={setViewMode} />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[900px] mx-auto p-4">
            <MarkdownRenderer content={content} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="file-content" className="flex flex-col h-full">
      {isMarkdown && <ViewModeToggle viewMode={viewMode} onToggle={setViewMode} />}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-auto">
        <HighlightedFileView content={content} language={language} />
      </div>
    </div>
  );
}

// --- Shared UI components ---

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full text-surface-400 text-sm">
      {children}
    </div>
  );
}

function ViewModeToggle({
  viewMode,
  onToggle,
}: {
  viewMode: "rendered" | "source";
  onToggle: (mode: "rendered" | "source") => void;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-surface-700">
      <button
        onClick={() => onToggle("rendered")}
        className={`px-2 py-0.5 text-xs rounded transition-colors ${
          viewMode === "rendered"
            ? "bg-surface-700 text-surface-200"
            : "text-surface-400 hover:text-surface-200"
        }`}
      >
        Rendered
      </button>
      <button
        onClick={() => onToggle("source")}
        className={`px-2 py-0.5 text-xs rounded transition-colors ${
          viewMode === "source"
            ? "bg-surface-700 text-surface-200"
            : "text-surface-400 hover:text-surface-200"
        }`}
      >
        Source
      </button>
    </div>
  );
}

/** Renders syntax-highlighted file content with line numbers */
const HighlightedFileView = memo(function HighlightedFileView({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const { tokens, isLoading } = useCodeHighlight(content, language);
  const lines = content.split("\n");
  const gutterWidth = `${Math.max(String(lines.length).length * 0.6 + 0.5, 2)}rem`;

  if (isLoading || !tokens) {
    return <PlainFileView lines={lines} gutterWidth={gutterWidth} />;
  }

  return (
    <div className="font-mono text-sm leading-relaxed text-surface-300">
      {tokens.map((lineTokens, i) => (
        <FileLine key={i} lineNumber={i + 1} tokens={lineTokens} gutterWidth={gutterWidth} />
      ))}
    </div>
  );
});

/** Single highlighted line with line number gutter */
const FileLine = memo(function FileLine({
  lineNumber,
  tokens,
  gutterWidth,
}: {
  lineNumber: number;
  tokens: ThemedToken[];
  gutterWidth: string;
}) {
  return (
    <div data-line-number={lineNumber} className="flex hover:bg-surface-800/50 transition-colors duration-300">
      <span
        className="text-zinc-500 select-none text-right pr-2 font-mono text-xs shrink-0 pt-px"
        style={{ width: gutterWidth }}
      >
        {lineNumber}
      </span>
      <code className="flex-1 px-2 whitespace-pre">
        {tokens.length === 0 ? (
          <span>&nbsp;</span>
        ) : (
          tokens.map((token, j) => (
            <span key={j} style={{ color: token.color }}>
              {token.content}
            </span>
          ))
        )}
      </code>
    </div>
  );
});

/** Fallback: plain text with line numbers while highlighting loads */
function PlainFileView({ lines, gutterWidth }: { lines: string[]; gutterWidth: string }) {
  return (
    <div className="font-mono text-sm leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} data-line-number={i + 1} className="flex hover:bg-surface-800/50 transition-colors duration-300">
          <span
            className="text-zinc-500 select-none text-right pr-2 font-mono text-xs shrink-0 pt-px"
            style={{ width: gutterWidth }}
          >
            {i + 1}
          </span>
          <code className="flex-1 px-2 whitespace-pre text-zinc-300">
            {line || "\u00a0"}
          </code>
        </div>
      ))}
    </div>
  );
}
