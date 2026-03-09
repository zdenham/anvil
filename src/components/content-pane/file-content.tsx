/**
 * FileContent
 *
 * Displays a file from disk with editing via CodeMirror 6.
 * Reads fresh from disk on every mount (no caching).
 *
 * - Media files (images, video, audio, PDF): rendered via asset protocol URL
 * - SVG files: rendered visually with source toggle (source = CM6 editor)
 * - Markdown files: rendered via MarkdownRenderer with source toggle
 * - Code/text files: editable via CodeMirror 6
 * - Binary/missing files: error message
 */

import { useState, useEffect, useCallback } from "react";
import { convertFileSrc } from "@/lib/browser-stubs";
import { FilesystemClient } from "@/lib/filesystem-client";
import { getLanguageFromPath } from "@/lib/language-detection";
import { getFileCategory, type FileCategory } from "@/lib/file-categories";
import { CodeMirrorEditor } from "./code-mirror-editor";
import { TiptapEditor } from "./tiptap-editor";
import { MediaPreview } from "./media-preview";
import { useFileDirtyStore } from "@/stores/file-dirty-store";
import { logger } from "@/lib/logger-client";

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
  const [savedContent, setSavedContent] = useState<string>("");
  const [currentContent, setCurrentContent] = useState<string>("");
  const setDirty = useFileDirtyStore((s) => s.setDirty);

  const isDirty = savedContent !== currentContent;

  // Sync dirty state to global store for tab indicator
  useEffect(() => {
    setDirty(filePath, isDirty);
    return () => setDirty(filePath, false);
  }, [filePath, isDirty, setDirty]);

  useEffect(() => {
    setFileState({ status: "loading" });
    setViewMode("rendered");
    setSavedContent("");
    setCurrentContent("");

    const category = getFileCategory(filePath);

    if (category !== "text" && category !== "svg") {
      const assetUrl = convertFileSrc(filePath);
      setFileState({ status: "media", category, assetUrl });
      return;
    }

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
          setSavedContent(content);
          setCurrentContent(content);
        }
      } catch (err) {
        if (cancelled) return;
        logger.error("[FileContent] Failed to read file:", err);

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

  const handleSave = useCallback(async (content: string) => {
    try {
      await filesystemClient.writeFile(filePath, content);
      setSavedContent(content);
    } catch (err) {
      logger.error("[FileContent] Failed to save file:", err);
    }
  }, [filePath]);

  const handleChange = useCallback((content: string) => {
    setCurrentContent(content);
  }, []);

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
        renderSource={(content, lang) => (
          <CodeMirrorEditor
            value={content}
            language={lang}
            onSave={(c) => handleSave(c)}
            onChange={handleChange}
          />
        )}
      />
    );
  }

  const { content, language } = fileState;
  const isMarkdown = language === "markdown" || language === "mdx";

  if (isMarkdown) {
    return (
      <div data-testid="file-content" className="flex flex-col h-full">
        <TiptapEditor
          initialContent={currentContent}
          onChange={handleChange}
          onSave={handleSave}
        />
      </div>
    );
  }

  return (
    <div data-testid="file-content" className="flex flex-col h-full">
      <CodeMirrorEditor
        value={content}
        language={language}
        lineNumber={lineNumber}
        onSave={handleSave}
        onChange={handleChange}
      />
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
    <div className="flex items-center gap-1 px-3 py-1.5">
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
