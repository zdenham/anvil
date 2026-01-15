import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { logger } from "@/lib/logger-client";
import { eventBus, type OpenSimpleTaskPayload } from "@/entities";

/** Internal type for hook return value */
interface SimpleTaskParams {
  taskId: string;
  threadId: string;
  prompt?: string;
}

/** Schema for IPC data from Rust (snake_case) */
const PendingSimpleTaskSchema = z.object({
  thread_id: z.string(),
  task_id: z.string(),
  prompt: z.string().nullish(), // Rust serializes Option<String> as null
});

/**
 * Gets task parameters from the Rust backend (Pull Model).
 * Similar to how task panel gets its params from get_pending_task.
 */
export function useSimpleTaskParams(): SimpleTaskParams | null {
  const [params, setParams] = useState<SimpleTaskParams | null>(null);

  useEffect(() => {
    // Fetch pending task from backend on mount
    const fetchPendingTask = async () => {
      try {
        const raw = await invoke<unknown>("get_pending_simple_task");
        if (raw) {
          const pending = PendingSimpleTaskSchema.parse(raw);
          logger.info("[useSimpleTaskParams] Got pending simple task:", pending);
          setParams({
            taskId: pending.task_id,
            threadId: pending.thread_id,
            prompt: pending.prompt ?? undefined, // Convert null to undefined
          });
        } else {
          logger.warn("[useSimpleTaskParams] No pending simple task found");
        }
      } catch (err) {
        logger.error("[useSimpleTaskParams] Failed to get pending simple task:", err);
      }
    };

    fetchPendingTask();

    // Also listen for open-simple-task events via eventBus (for when panel is already mounted)
    const handleOpenSimpleTask = (payload: OpenSimpleTaskPayload) => {
      logger.info("[useSimpleTaskParams] Received open-simple-task event:", payload);
      setParams({
        taskId: payload.taskId,
        threadId: payload.threadId,
        prompt: payload.prompt ?? undefined,
      });
    };

    eventBus.on("open-simple-task", handleOpenSimpleTask);

    return () => {
      eventBus.off("open-simple-task", handleOpenSimpleTask);
    };
  }, []);

  return params;
}
