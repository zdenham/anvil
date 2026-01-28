import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { useThreadPreview } from "@/hooks/use-thread-preview";
import { usePlanPreview } from "@/hooks/use-plan-preview";

interface ItemPreviewTooltipProps {
  children: React.ReactNode;
  itemId: string;
  itemType: "thread" | "plan";
}

/**
 * Tooltip wrapper for tree menu items that shows a preview of the content.
 * - For threads: shows the most recent user message
 * - For plans: shows the first ~200 characters of the plan content
 *
 * Appears instantly on hover to the right of the item, no animation.
 */
export function ItemPreviewTooltip({
  children,
  itemId,
  itemType,
}: ItemPreviewTooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipContent itemId={itemId} itemType={itemType} />
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

interface TooltipContentProps {
  itemId: string;
  itemType: "thread" | "plan";
}

const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  ({ itemId, itemType }, ref) => {
    const threadPreview = useThreadPreview(itemType === "thread" ? itemId : "");
    const { preview: planPreview, isLoading: planLoading } = usePlanPreview(
      itemType === "plan" ? itemId : null
    );

    const preview = itemType === "thread" ? threadPreview : planPreview;
    const isLoading = itemType === "plan" && planLoading;

    // Don't render tooltip if no preview content
    if (!preview && !isLoading) {
      return null;
    }

    return (
      <TooltipPrimitive.Content
        ref={ref}
        side="right"
        sideOffset={8}
        className={cn(
          "z-50 px-3 py-2 text-xs",
          "bg-accent-600 text-accent-900",
          "rounded-xl shadow-sm",
          "max-w-[300px] whitespace-pre-wrap"
          // No animation classes - instant appear/disappear
        )}
      >
        {isLoading ? (
          <span className="text-accent-900/60">Loading...</span>
        ) : (
          preview
        )}
      </TooltipPrimitive.Content>
    );
  }
);

TooltipContent.displayName = "TooltipContent";
