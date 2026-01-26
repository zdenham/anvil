import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

export interface CopyButtonProps {
  /** Text to copy to clipboard */
  text: string;
  /** Tooltip label (default: "Copy") */
  label?: string;
  /** Always visible vs only on group hover (default: false) */
  alwaysVisible?: boolean;
  /** Optional className for additional styling */
  className?: string;
}

/**
 * A button with copy-to-clipboard functionality.
 * Shows a checkmark on success. Supports tooltip, conditional visibility on hover.
 */
export function CopyButton({
  text,
  label = "Copy",
  alwaysVisible = false,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip content={copied ? "Copied!" : label}>
      <button
        onClick={handleCopy}
        className={cn(
          "p-1 hover:bg-zinc-700 rounded transition-opacity shrink-0",
          !alwaysVisible && "opacity-0 group-hover:opacity-100",
          className
        )}
        aria-label={label}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-zinc-400" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-zinc-400" />
        )}
      </button>
    </Tooltip>
  );
}
