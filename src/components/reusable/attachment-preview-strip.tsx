import { useState } from "react";
import { convertFileSrc } from "@/lib/browser-stubs";
import { extractImagePaths } from "@/lib/image-paths";
import { ImageLightbox } from "@/components/ui/image-lightbox";

interface AttachmentPreviewStripProps {
  content: string;
}

/** Shows small image thumbnails for any image paths detected in the input content. */
export function AttachmentPreviewStrip({ content }: AttachmentPreviewStripProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const imagePaths = extractImagePaths(content);
  if (imagePaths.length === 0) return null;

  return (
    <div className="flex gap-2 px-2 pb-2 overflow-x-auto">
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          onClose={() => setLightboxSrc(null)}
        />
      )}
      {imagePaths.map((path) => (
        <img
          key={path}
          src={convertFileSrc(path)}
          className="h-12 w-12 rounded object-cover border border-surface-600 cursor-zoom-in"
          alt={path.split("/").pop()}
          onClick={() => setLightboxSrc(convertFileSrc(path))}
        />
      ))}
    </div>
  );
}
