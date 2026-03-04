import { useEffect, useState } from "react";
import { invoke } from "@/lib/invoke";
import { z } from "zod";
import { logger } from "@/lib/logger-client";
import {
  eventBus,
  type OpenControlPanelPayload,
  type ControlPanelViewType,
} from "@/entities";
import type { WindowConfig } from "@/control-panel-main";

/** Hook return type - simplified to just view and prompt */
interface ControlPanelParams {
  /** The current view (thread or plan) */
  view: ControlPanelViewType | null;
  /** Initial prompt to display */
  prompt?: string;
  /** @deprecated Legacy field for backwards compatibility during migration */
  threadId?: string;
  /** Instance ID for standalone windows (null for NSPanel) */
  instanceId?: string | null;
  /** Whether this is a standalone window or NSPanel */
  isStandaloneWindow?: boolean;
}

/** Schema for IPC data from Rust (snake_case) */
const PendingControlPanelSchema = z.object({
  thread_id: z.string(),
  task_id: z.string(),
  prompt: z.string().nullish(), // Rust serializes Option<String> as null
});

/**
 * Parse view type from URL search params.
 * Supports: ?view=thread&threadId=xxx, ?view=plan&planId=xxx
 * Note: Inbox view has been moved to a dedicated inbox-list-panel (see plans/inbox-navigation-fix.md)
 */
function parseUrlParams(): { view: ControlPanelViewType | null; instanceId: string | null } {
  const searchParams = new URLSearchParams(window.location.search);
  const view = searchParams.get("view");
  const instanceId = searchParams.get("instanceId");

  if (view === "thread") {
    const threadId = searchParams.get("threadId");
    if (threadId) {
      return { view: { type: "thread", threadId }, instanceId };
    }
  }

  if (view === "plan") {
    const planId = searchParams.get("planId");
    if (planId) {
      return { view: { type: "plan", planId }, instanceId };
    }
  }

  return { view: null, instanceId };
}

/**
 * Gets control panel parameters from the Rust backend (Pull Model).
 * Fetches pending thread/plan info via get_pending_control_panel IPC call.
 * Also supports URL params for direct navigation (e.g., ?view=inbox).
 *
 * For standalone windows (detected via instanceId in URL), we use URL params
 * directly and don't fetch from IPC or listen to events.
 */
export function useControlPanelParams(_windowConfig?: WindowConfig): ControlPanelParams | null {
  const [params, setParams] = useState<ControlPanelParams | null>(null);

  useEffect(() => {
    // First check URL params for direct navigation
    const { view: urlView, instanceId } = parseUrlParams();
    const isStandaloneWindow = !!instanceId;

    if (urlView) {
      logger.info("[useControlPanelParams] Got view from URL params:", { urlView, instanceId, isStandaloneWindow });
      setParams({
        view: urlView,
        prompt: undefined,
        threadId: urlView.type === "thread" ? urlView.threadId : undefined,
        instanceId,
        isStandaloneWindow,
      });

      // For standalone windows, don't set up event listener - window is independent
      if (isStandaloneWindow) {
        return;
      }
    } else {
      // Fetch pending control panel params from backend on mount (NSPanel only)
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
              instanceId: null,
              isStandaloneWindow: false,
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

    // For NSPanel only: listen for open-control-panel events via eventBus
    // Standalone windows don't need this - they're independent
    if (!isStandaloneWindow) {
      const handleOpenControlPanel = (payload: OpenControlPanelPayload) => {
        logger.info("[useControlPanelParams] Received open-control-panel event:", payload);

        // Handle new discriminated union view type
        if (payload.view) {
          setParams({
            view: payload.view,
            prompt: payload.prompt ?? undefined,
            threadId: payload.view.type === "thread" ? payload.view.threadId : undefined,
            instanceId: null,
            isStandaloneWindow: false,
          });
          return;
        }

        // Legacy path: build view from threadId
        if (payload.threadId) {
          setParams({
            view: { type: "thread", threadId: payload.threadId },
            prompt: payload.prompt ?? undefined,
            threadId: payload.threadId,
            instanceId: null,
            isStandaloneWindow: false,
          });
        }
      };

      eventBus.on("open-control-panel", handleOpenControlPanel);

      return () => {
        eventBus.off("open-control-panel", handleOpenControlPanel);
      };
    }
  }, []);

  return params;
}
