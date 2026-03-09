import { useState } from "react";
import { X } from "lucide-react";
import { convertFileSrc } from "@/lib/browser-stubs";
import { ImageLightbox } from "@/components/ui/image-lightbox";

interface AttachmentPreviewStripProps {
  attachments: string[];
  onRemove?: (path: string) => void;
}

/** Shows small image thumbnails for attached image paths. */
export function AttachmentPreviewStrip({ attachments, onRemove }: AttachmentPreviewStripProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  if (attachments.length === 0) return null;

  return (
    <div className="flex gap-2 px-2 pb-2 overflow-x-auto">
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          onClose={() => setLightboxSrc(null)}
        />
      )}
      {attachments.map((path) => (
        <div key={path} className="relative group flex-shrink-0">
          <img
            src={convertFileSrc(path)}
            className="h-12 w-12 rounded object-cover border border-surface-600 cursor-zoom-in"
            alt={path.split("/").pop()}
            onClick={() => setLightboxSrc(convertFileSrc(path))}
          />
          {onRemove && (
            <button
              onClick={() => onRemove(path)}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-surface-700 border border-surface-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Remove ${path.split("/").pop()}`}
            >
              <X size={10} className="text-surface-300" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
