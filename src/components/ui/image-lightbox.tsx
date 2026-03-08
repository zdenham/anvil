import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

/** Full-screen overlay that shows an image at its natural size. Click or Escape to dismiss. */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        draggable={false}
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
