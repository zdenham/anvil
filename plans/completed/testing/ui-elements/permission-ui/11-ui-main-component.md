# Sub-Plan 11: Main Permission UI Component and Exports

## Scope

Create the main PermissionUI component that delegates to modal or inline mode, plus the module barrel export.

## Dependencies

- **02-zustand-store.md** - Requires `usePermissionStore`
- **08-ui-keyboard-hook.md** - Requires `usePermissionKeyboard`
- **09-ui-modal-component.md** - Requires `PermissionModal`
- **10-ui-inline-component.md** - Requires `PermissionInline`

## Files to Create

### `src/components/permission/permission-ui.tsx` (~40 lines)

```typescript
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
  const requests = usePermissionStore((state) => state.getRequestsByThread(threadId));
  const focusedIndex = usePermissionStore((state) => state.focusedIndex);

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
```

### `src/components/permission/index.ts` (~10 lines)

```typescript
export { PermissionUI } from "./permission-ui";
export { PermissionModal } from "./permission-modal";
export { PermissionInline } from "./permission-inline";
export { PermissionInputDisplay } from "./permission-input-display";
export { usePermissionKeyboard } from "./use-permission-keyboard";
```

## Verification

```bash
pnpm tsc --noEmit
```

## Estimated Time

15-20 minutes

## Notes

- Simple delegation component based on display mode
- Keyboard hook is enabled only when pending requests exist
- Inline mode shows all requests with focus indication
- Modal mode shows only the next pending request
