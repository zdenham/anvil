import { useCallback } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { usePermissionStore } from "@/entities/permissions/store";
import { permissionService } from "@/entities/permissions/service";
import { isDangerousTool, type PermissionDecision } from "@core/types/permissions.js";
import { PermissionInputDisplay } from "./permission-input-display";

interface PermissionModalProps {
  threadId: string;
}

export function PermissionModal({ threadId }: PermissionModalProps) {
  const request = usePermissionStore((state) =>
    state.getNextRequestForThread(threadId)
  );

  const handleRespond = useCallback(
    async (decision: PermissionDecision) => {
      if (!request || request.status !== "pending") return;
      await permissionService.respond(request, decision);
    },
    [request]
  );

  if (!request || request.status !== "pending") return null;

  const isDangerous = isDangerousTool(request.toolName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => handleRespond("deny")}
      />

      {/* Dialog */}
      {/* Note: Using bg-surface-800 for consistency with other modal components in the codebase */}
      <div
        className={`relative bg-surface-800 rounded-lg border shadow-xl w-full max-w-lg mx-4 ${
          isDangerous ? "border-amber-500/50" : "border-surface-700"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            {isDangerous && (
              <AlertTriangle className="text-amber-500 flex-shrink-0" size={24} />
            )}
            <h2
              id="permission-dialog-title"
              className="text-lg font-semibold text-surface-100"
            >
              Allow {request.toolName}?
            </h2>
          </div>

          {/* Tool input preview */}
          <PermissionInputDisplay
            toolName={request.toolName}
            toolInput={request.toolInput}
          />

          {/* Action buttons */}
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => handleRespond("deny")}
              className="px-4 py-2 text-sm text-surface-300 hover:text-surface-100
                         border border-surface-600 rounded-lg hover:border-surface-500
                         flex items-center gap-2 transition-colors"
            >
              <X size={16} />
              Deny
              <kbd className="ml-1 px-1.5 py-0.5 bg-surface-700 rounded text-xs">Esc</kbd>
            </button>
            <button
              onClick={() => handleRespond("approve")}
              className="px-4 py-2 text-sm bg-green-600 hover:bg-green-500
                         text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              <Check size={16} />
              Approve
              <kbd className="ml-1 px-1.5 py-0.5 bg-green-800 rounded text-xs">Enter</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
