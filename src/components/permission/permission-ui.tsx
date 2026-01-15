import { useMemo } from "react";
import { usePermissionStore } from "@/entities/permissions/store";
import { usePermissionKeyboard } from "./use-permission-keyboard";
import { PermissionModal } from "./permission-modal";
import { PermissionInline } from "./permission-inline";

interface PermissionUIProps {
  threadId: string;
}

/**
 * Main permission UI component.
 * Delegates to modal or inline based on display mode setting.
 */
export function PermissionUI({ threadId }: PermissionUIProps) {
  const displayMode = usePermissionStore((state) => state.displayMode);
  // Select raw state to avoid creating new array reference on each render
  const allRequests = usePermissionStore((state) => state.requests);
  const focusedIndex = usePermissionStore((state) => state.focusedIndex);

  // Derive filtered/sorted requests with stable reference
  const requests = useMemo(
    () =>
      Object.values(allRequests)
        .filter((r) => r.threadId === threadId)
        .sort((a, b) => a.timestamp - b.timestamp),
    [allRequests, threadId]
  );

  // Enable keyboard handling when there are pending requests
  usePermissionKeyboard({
    threadId,
    enabled: requests.some((r) => r.status === "pending"),
  });

  if (requests.length === 0) return null;

  if (displayMode === "modal") {
    return <PermissionModal threadId={threadId} />;
  }

  // Inline mode: render all requests in thread
  return (
    <div className="space-y-3 my-4">
      {requests.map((request, index) => (
        <PermissionInline
          key={request.requestId}
          request={request}
          isFocused={index === focusedIndex}
        />
      ))}
    </div>
  );
}
