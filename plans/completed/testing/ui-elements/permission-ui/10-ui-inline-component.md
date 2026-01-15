# Sub-Plan 10: Permission Inline Component

## Scope

Create the inline display mode component for permission prompts that embeds within the thread view.

## Dependencies

- **01-core-types.md** - Requires `isDangerousTool` function from `@core/types/permissions.js`
- **05-permission-service.md** - Requires `permissionService`
- **07-ui-input-display.md** - Requires `PermissionInputDisplay`

## Files to Create

### `src/components/permission/permission-inline.tsx` (~120 lines)

```typescript
import { useState, useCallback } from "react";
import { Shield, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { permissionService } from "@/entities/permissions/service";
import { isDangerousTool, type PermissionRequest, type PermissionStatus } from "@core/types/permissions.js";
import { PermissionInputDisplay } from "./permission-input-display";

interface PermissionInlineProps {
  request: PermissionRequest & { status: PermissionStatus };
  isFocused: boolean;
}

export function PermissionInline({ request, isFocused }: PermissionInlineProps) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const handleApprove = useCallback(async () => {
    if (request.status !== "pending") return;
    await permissionService.respond(request, "approve");
  }, [request]);

  const handleReject = useCallback(async () => {
    if (request.status !== "pending") return;
    if (showRejectInput) {
      await permissionService.respond(request, "deny", rejectReason || undefined);
      setShowRejectInput(false);
      setRejectReason("");
    } else {
      setShowRejectInput(true);
    }
  }, [request, showRejectInput, rejectReason]);

  const isDangerous = isDangerousTool(request.toolName);

  const statusStyles = {
    pending: "border-amber-500/50 bg-amber-950/20",
    approved: "border-green-500/50 bg-green-950/20",
    denied: "border-red-500/50 bg-red-950/20",
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        statusStyles[request.status],
        isFocused && "ring-2 ring-accent-400"
      )}
      role="dialog"
      aria-label={`Permission request for ${request.toolName}`}
      data-testid={`permission-prompt-${request.requestId}`}
      data-status={request.status}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-5 w-5 text-amber-400" aria-hidden="true" />
        <span className="font-medium text-surface-200">
          Permission Required
        </span>
        {isDangerous && (
          <span className="text-xs text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded">
            Writes
          </span>
        )}
      </div>

      {/* Tool info */}
      <div className="mb-4">
        <div className="text-sm text-surface-300 mb-1">
          Tool: <span className="font-mono text-surface-100">{request.toolName}</span>
        </div>
        <PermissionInputDisplay
          toolName={request.toolName}
          toolInput={request.toolInput}
        />
      </div>

      {/* Actions */}
      {request.status === "pending" && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleApprove}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded",
              "bg-green-600 hover:bg-green-500 text-white text-sm font-medium",
              "transition-colors"
            )}
            aria-label="Approve (y)"
          >
            <Check className="h-4 w-4" />
            Approve
            <kbd className="ml-1 text-xs opacity-70">y</kbd>
          </button>

          <button
            onClick={handleReject}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded",
              "bg-red-600 hover:bg-red-500 text-white text-sm font-medium",
              "transition-colors"
            )}
            aria-label="Reject (n)"
          >
            <X className="h-4 w-4" />
            Reject
            <kbd className="ml-1 text-xs opacity-70">n</kbd>
          </button>

          {showRejectInput && (
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (optional)"
              className="flex-1 px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  permissionService.respond(request, "deny", rejectReason || undefined);
                  setShowRejectInput(false);
                  setRejectReason("");
                }
                if (e.key === "Escape") {
                  setShowRejectInput(false);
                  setRejectReason("");
                }
              }}
              autoFocus
            />
          )}
        </div>
      )}

      {/* Status badges */}
      {request.status === "approved" && (
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <Check className="h-4 w-4" />
          <span>Approved</span>
        </div>
      )}

      {request.status === "denied" && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <X className="h-4 w-4" />
          <span>Denied</span>
        </div>
      )}
    </div>
  );
}
```

### `src/components/permission/permission-inline.ui.test.tsx`

Include tests from main plan's "Test 3: Permission Inline" section.

## Verification

```bash
pnpm tsc --noEmit
pnpm test:ui -- src/components/permission/permission-inline
```

## Estimated Time

35-45 minutes

## Notes

- Embedded component style (not fixed/modal)
- Focus ring for keyboard navigation indication
- Optional reject reason input
- Status badges for approved/denied states
- Accessible with proper ARIA attributes
