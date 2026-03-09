import { useState } from "react";
import { cn } from "@/lib/utils";
import { convertFileSrc } from "@/lib/browser-stubs";
import { extractImagePaths, stripImagePaths } from "@/lib/image-paths";
import type { Turn } from "@/lib/utils/turn-grouping";
import { getUserTurnPrompt } from "@/lib/utils/turn-grouping";
import { ImageLightbox } from "@/components/ui/image-lightbox";

interface UserMessageProps {
  /** The user turn containing the message */
  turn: Turn;
}

/**
 * Right-aligned user message bubble.
 * Renders image previews above the text when the message contains image paths.
 */
export function UserMessage({ turn }: UserMessageProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const content = getUserTurnPrompt(turn);
  if (!content) return null;

  const imagePaths = extractImagePaths(content);
  const textContent = stripImagePaths(content);

  if (imagePaths.length === 0 && !textContent) return null;

  return (
    <article
      role="article"
      aria-label="Your message"
      className="flex justify-end my-3"
    >
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          onClose={() => setLightboxSrc(null)}
        />
      )}
      <div className="max-w-[80%] flex flex-col items-end gap-1 overflow-hidden">
        {imagePaths.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-end">
            {imagePaths.map((path) => (
              <img
                key={path}
                src={convertFileSrc(path)}
                className="max-h-48 rounded-xl object-cover cursor-zoom-in"
                alt={path.split("/").pop()}
                onClick={() => setLightboxSrc(convertFileSrc(path))}
              />
            ))}
          </div>
        )}

        {textContent && (
          <div
            className={cn(
              "px-4 py-3 rounded-2xl",
              "bg-accent-600 text-accent-900",
              "shadow-sm",
            )}
          >
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{textContent}</p>
          </div>
        )}
      </div>
    </article>
  );
}
