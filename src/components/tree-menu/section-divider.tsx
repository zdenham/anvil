import { cn } from "@/lib/utils";

interface SectionDividerProps {
  className?: string;
}

/**
 * Simple horizontal divider between tree sections.
 * Used to separate repo/worktree sections in the tree menu.
 */
export function SectionDivider({ className }: SectionDividerProps) {
  return (
    <div
      className={cn("h-px bg-surface-800 mx-2 my-1", className)}
      role="separator"
      aria-orientation="horizontal"
    />
  );
}
