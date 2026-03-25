import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { convertFileSrc } from "@/lib/browser-stubs";
import { extractImagePaths, stripImagePaths } from "@/lib/image-paths";
import type { Turn } from "@/lib/utils/turn-grouping";
import { getUserTurnPrompt } from "@/lib/utils/turn-grouping";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { useQueuedMessagesStore } from "@/stores/queued-messages-store";

const MIN_PENDING_DISPLAY_MS = 800;

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
  const storePending = useQueuedMessagesStore((s) => s.isMessagePending(turn.messageId));
  const [showPending, setShowPending] = useState(false);
  const pendingSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (storePending && !pendingSinceRef.current) {
      pendingSinceRef.current = Date.now();
      setShowPending(true);
    }
    if (!storePending && pendingSinceRef.current) {
      const elapsed = Date.now() - pendingSinceRef.current;
      const remaining = MIN_PENDING_DISPLAY_MS - elapsed;
      if (remaining > 0) {
        const timer = setTimeout(() => {
          setShowPending(false);
          pendingSinceRef.current = null;
        }, remaining);
        return () => clearTimeout(timer);
      }
      setShowPending(false);
      pendingSinceRef.current = null;
    }
  }, [storePending]);

  const isPending = showPending;
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
              "px-4 py-3 rounded-2xl transition-[opacity,background-color,border-color,box-shadow] duration-200 ease-out",
              isPending
                ? "bg-accent-600/90 text-accent-900 opacity-70"
                : "bg-accent-600 text-accent-900 shadow-sm",
            )}
          >
            <p className={cn(
              "text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
              isPending && "italic",
            )}>{textContent}</p>
          </div>
        )}
      </div>
    </article>
  );
}
