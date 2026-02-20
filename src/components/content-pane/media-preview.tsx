/**
 * Media preview components for non-text file types.
 * Used by FileContent to render images, SVGs, PDFs, video, and audio.
 */

import { useState, useEffect } from "react";
import { FilesystemClient } from "@/lib/filesystem-client";
import type { FileCategory } from "@/lib/file-categories";

const filesystemClient = new FilesystemClient();

// Shared by ImagePreview and SvgPreview for transparency indication
const CHECKERBOARD_BG =
  "bg-[repeating-conic-gradient(#1e201e_0%_25%,#141514_0%_50%)] bg-[length:20px_20px]";

interface MediaPreviewProps {
  category: FileCategory;
  assetUrl: string;
  filePath: string;
  viewMode: "rendered" | "source";
  /** Render the view-mode toggle bar */
  renderToggle: () => React.ReactNode;
  /** Render syntax-highlighted source code */
  renderHighlighted: (content: string, language: string) => React.ReactNode;
}

export function MediaPreview({
  category,
  assetUrl,
  filePath,
  viewMode,
  renderToggle,
  renderHighlighted,
}: MediaPreviewProps) {
  if (category === "svg") {
    return (
      <SvgPreview
        assetUrl={assetUrl}
        filePath={filePath}
        viewMode={viewMode}
        renderToggle={renderToggle}
        renderHighlighted={renderHighlighted}
      />
    );
  }

  if (category === "image") return <ImagePreview url={assetUrl} filePath={filePath} />;
  if (category === "pdf") return <PdfPreview url={assetUrl} />;
  if (category === "video") return <VideoPreview url={assetUrl} />;
  if (category === "audio") return <AudioPreview url={assetUrl} />;

  return (
    <div className="flex items-center justify-center h-full text-surface-400 text-sm">
      Unsupported media type
    </div>
  );
}

function ImagePreview({ url, filePath }: { url: string; filePath: string }) {
  const filename = filePath.split("/").pop() ?? "image";

  return (
    <div className={`flex items-center justify-center h-full p-8 ${CHECKERBOARD_BG}`}>
      <img
        src={url}
        alt={filename}
        className="max-w-full max-h-full object-contain rounded"
        draggable={false}
      />
    </div>
  );
}

function PdfPreview({ url }: { url: string }) {
  return (
    <embed src={url} type="application/pdf" className="w-full h-full" />
  );
}

function VideoPreview({ url }: { url: string }) {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <video controls src={url} className="max-w-full max-h-full rounded" />
    </div>
  );
}

function AudioPreview({ url }: { url: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <audio controls src={url} />
    </div>
  );
}

function SvgPreview({
  assetUrl,
  filePath,
  viewMode,
  renderToggle,
  renderHighlighted,
}: {
  assetUrl: string;
  filePath: string;
  viewMode: "rendered" | "source";
  renderToggle: () => React.ReactNode;
  renderHighlighted: (content: string, language: string) => React.ReactNode;
}) {
  const [sourceContent, setSourceContent] = useState<string | null>(null);
  const filename = filePath.split("/").pop() ?? "image.svg";

  useEffect(() => {
    if (viewMode !== "source" || sourceContent) return;

    let cancelled = false;
    async function loadSource() {
      try {
        const content = await filesystemClient.readFile(filePath);
        if (!cancelled) setSourceContent(content);
      } catch {
        if (!cancelled) setSourceContent("<!-- Failed to load SVG source -->");
      }
    }
    loadSource();
    return () => { cancelled = true; };
  }, [viewMode, sourceContent, filePath]);

  return (
    <div className="flex flex-col h-full">
      {renderToggle()}
      {viewMode === "rendered" ? (
        <div className={`flex-1 min-h-0 flex items-center justify-center p-8 ${CHECKERBOARD_BG}`}>
          <img
            src={assetUrl}
            alt={filename}
            className="max-w-full max-h-full object-contain"
            draggable={false}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          {sourceContent ? (
            renderHighlighted(sourceContent, "xml")
          ) : (
            <div className="flex items-center justify-center h-full text-surface-400 text-sm">
              Loading source...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
