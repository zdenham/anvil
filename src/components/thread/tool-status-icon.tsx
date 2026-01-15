import { Loader2, CheckCircle, XCircle, Clock } from "lucide-react";

export type ToolStatus = "running" | "complete" | "error" | "pending";

interface ToolStatusIconProps {
  status: ToolStatus;
  isError: boolean;
}

/**
 * Status indicator icon for tool execution state.
 */
export function ToolStatusIcon({ status, isError }: ToolStatusIconProps) {
  if (status === "running") {
    return (
      <Loader2 className="h-4 w-4 animate-spin text-accent-400" aria-hidden="true" />
    );
  }
  if (status === "pending") {
    return <Clock className="h-4 w-4 text-amber-400" aria-hidden="true" />;
  }
  if (status === "error" || isError) {
    return <XCircle className="h-4 w-4 text-red-400" aria-hidden="true" />;
  }
  return <CheckCircle className="h-4 w-4 text-green-400" aria-hidden="true" />;
}
