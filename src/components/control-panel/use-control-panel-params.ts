import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { logger } from "@/lib/logger-client";
import {
  eventBus,
  type OpenControlPanelPayload,
  type ControlPanelViewType,
} from "@/entities";

/** Hook return type - simplified to just view and prompt */
interface ControlPanelParams {
  /** The current view (thread or plan) */
  view: ControlPanelViewType | null;
  /** Initial prompt to display */
  prompt?: string;
  /** @deprecated Legacy field for backwards compatibility during migration */
  threadId?: string;
}

/** Schema for IPC data from Rust (snake_case) */
const PendingControlPanelSchema = z.object({
  thread_id: z.string(),
  task_id: z.string(),
  prompt: z.string().nullish(), // Rust serializes Option<String> as null
});

/**
 * Parse view type from URL search params.
 * Supports: ?view=inbox, ?view=thread&threadId=xxx, ?view=plan&planId=xxx
 */
function parseUrlParams(): ControlPanelViewType | null {
  const searchParams = new URLSearchParams(window.location.search);
  const view = searchParams.get("view");

  if (view === "inbox") {
    return { type: "inbox" };
  }

  if (view === "thread") {
    const threadId = searchParams.get("threadId");
    if (threadId) {
      return { type: "thread", threadId };
    }
  }

  if (view === "plan") {
    const planId = searchParams.get("planId");
    if (planId) {
      return { type: "plan", planId };
    }
  }

  return null;
}

/**
 * Gets control panel parameters from the Rust backend (Pull Model).
 * Fetches pending thread/plan info via get_pending_control_panel IPC call.
 * Also supports URL params for direct navigation (e.g., ?view=inbox).
 */
export function useControlPanelParams(): ControlPanelParams | null {
  const [params, setParams] = useState<ControlPanelParams | null>(null);

  useEffect(() => {
    // First check URL params for direct navigation
    const urlView = parseUrlParams();
    if (urlView) {
      logger.info("[useControlPanelParams] Got view from URL params:", urlView);
      setParams({
        view: urlView,
        prompt: undefined,
        threadId: urlView.type === "thread" ? urlView.threadId : undefined,
      });
      // Don't fetch from IPC, but still set up event listener below
    } else {
      // Fetch pending control panel params from backend on mount
      const fetchPendingControlPanel = async () => {
        try {
          const raw = await invoke<unknown>("get_pending_control_panel");
          if (raw) {
            const pending = PendingControlPanelSchema.parse(raw);
            logger.info("[useControlPanelParams] Got pending control panel:", pending);
            setParams({
              view: { type: "thread", threadId: pending.thread_id },
              prompt: pending.prompt ?? undefined,
              threadId: pending.thread_id, // Legacy field for backwards compat
            });
          } else {
            logger.warn("[useControlPanelParams] No pending control panel found");
          }
        } catch (err) {
          logger.error("[useControlPanelParams] Failed to get pending control panel:", err);
        }
      };

      fetchPendingControlPanel();
    }

    // Also listen for open-control-panel events via eventBus (for when panel is already mounted)
    const handleOpenControlPanel = (payload: OpenControlPanelPayload) => {
      logger.info("[useControlPanelParams] Received open-control-panel event:", payload);

      // Handle new discriminated union view type
      if (payload.view) {
        setParams({
          view: payload.view,
          prompt: payload.prompt ?? undefined,
          threadId: payload.view.type === "thread" ? payload.view.threadId : undefined,
        });
        return;
      }

      // Legacy path: build view from threadId
      if (payload.threadId) {
        setParams({
          view: { type: "thread", threadId: payload.threadId },
          prompt: payload.prompt ?? undefined,
          threadId: payload.threadId,
        });
      }
    };

    eventBus.on("open-control-panel", handleOpenControlPanel);

    return () => {
      eventBus.off("open-control-panel", handleOpenControlPanel);
    };
  }, []);

  return params;
}
