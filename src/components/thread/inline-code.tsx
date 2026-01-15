import { cn } from "@/lib/utils";

interface InlineCodeProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Styled inline code element for markdown content.
 */
export function InlineCode({ children, className }: InlineCodeProps) {
  return (
    <code
      className={cn(
        "text-amber-400 bg-zinc-800/50 px-1 py-0.5 rounded",
        "before:content-none after:content-none",
        className
      )}
    >
      {children}
    </code>
  );
}
