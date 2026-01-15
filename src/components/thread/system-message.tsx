import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SystemMessage as SystemMessageType } from "@/lib/types/agent-messages";

interface SystemMessageProps {
  message: SystemMessageType;
}

/**
 * Displays system initialization info (model, available tools).
 */
export function SystemMessage({ message }: SystemMessageProps) {
  return (
    <div
      role="article"
      aria-label="System message"
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg",
        "bg-zinc-900/50 border border-zinc-800"
      )}
    >

      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Model:</span>{" "}
          <span className="font-mono text-secondary-400">{message.model}</span>
        </p>

        {message.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Wrench
              className="h-4 w-4 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
            {message.tools.map((tool) => (
              <span
                key={tool}
                className="px-2 py-0.5 text-xs rounded bg-zinc-800 text-zinc-300"
              >
                {tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
