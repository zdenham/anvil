import { useEffect, useCallback } from "react";
import { usePermissionStore } from "@/entities/permissions";
import { permissionService } from "@/entities/permissions/service";
import type {
  PermissionDecision,
  PermissionRequest,
  PermissionStatus,
} from "@core/types/permissions.js";

interface UsePermissionKeyboardOptions {
  threadId: string;
  enabled?: boolean;
}

/**
 * Keyboard shortcuts for permission prompts.
 *
 * Modal mode:
 * | Key    | Action |
 * |--------|--------|
 * | Enter  | Approve focused permission |
 * | Escape | Deny focused permission |
 *
 * Inline mode:
 * | Key   | Action |
 * |-------|--------|
 * | y     | Approve focused permission |
 * | n     | Deny focused permission |
 * | a     | Approve all pending |
 * | j/Down| Focus next |
 * | k/Up  | Focus previous |
 */
export function usePermissionKeyboard({
  threadId,
  enabled = true,
}: UsePermissionKeyboardOptions): void {
  const handleRespond = useCallback(
    async (
      request: PermissionRequest & { status: PermissionStatus },
      decision: PermissionDecision
    ) => {
      if (request.status !== "pending") return;
      await permissionService.respond(request, decision);
    },
    []
  );

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const store = usePermissionStore.getState();
      const displayMode = store.displayMode;
      const pending = store.getPendingRequests();
      const focused = store.getFocusedRequest();

      if (pending.length === 0) return;

      // Modal mode shortcuts
      if (displayMode === "modal") {
        switch (event.key) {
          case "Enter":
            event.preventDefault();
            if (focused) handleRespond(focused, "approve");
            break;
          case "Escape":
            event.preventDefault();
            if (focused) handleRespond(focused, "deny");
            break;
        }
        return;
      }

      // Inline mode shortcuts (vim-style)
      switch (event.key) {
        case "y":
          event.preventDefault();
          if (focused) handleRespond(focused, "approve");
          break;
        case "n":
          event.preventDefault();
          if (focused) handleRespond(focused, "deny");
          break;
        case "a":
          event.preventDefault();
          permissionService.approveAll(threadId);
          break;
        case "j":
        case "ArrowDown":
          event.preventDefault();
          store.focusNext();
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          store.focusPrev();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, threadId, handleRespond]);
}
