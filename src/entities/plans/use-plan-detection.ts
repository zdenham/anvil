import { useCallback } from "react";
import { planService } from "./service";
import { useTaskStore } from "@/entities/tasks";
import {
  detectPlanFromToolCall,
  detectPlanFromFileChanges,
  detectPlanFromMessage,
} from "./detection-service";
import type { FileChange } from "@core/types/events";

interface UsePlanDetectionOptions {
  taskId: string;
  workingDirectory: string;
}

/**
 * Hook to detect and create plan associations.
 * Note: repositoryName is looked up from task, not passed directly.
 */
export function usePlanDetection({
  taskId,
  workingDirectory,
}: UsePlanDetectionOptions) {
  // Get repository name from task
  const task = useTaskStore((s) => s.tasks[taskId]);
  const repositoryName = task?.repositoryName;

  const detectFromToolCall = useCallback(
    async (
      toolName: string,
      toolInput: Record<string, unknown>
    ): Promise<string | null> => {
      if (!repositoryName) return null;

      const result = detectPlanFromToolCall(toolName, toolInput, workingDirectory);

      if (result.detected && result.path) {
        const plan = await planService.ensurePlanExists(
          repositoryName,
          result.path
        );
        return plan.id;
      }

      return null;
    },
    [repositoryName, workingDirectory]
  );

  const detectFromFileChanges = useCallback(
    async (fileChanges: FileChange[]): Promise<string | null> => {
      if (!repositoryName) return null;

      const result = detectPlanFromFileChanges(fileChanges, workingDirectory);

      if (result.detected && result.path) {
        const plan = await planService.ensurePlanExists(
          repositoryName,
          result.path
        );
        return plan.id;
      }

      return null;
    },
    [repositoryName, workingDirectory]
  );

  const detectFromMessage = useCallback(
    async (messageContent: string): Promise<string | null> => {
      if (!repositoryName) return null;

      const result = detectPlanFromMessage(messageContent);

      if (result.detected && result.path) {
        const plan = await planService.ensurePlanExists(
          repositoryName,
          result.path
        );
        return plan.id;
      }

      return null;
    },
    [repositoryName]
  );

  return {
    detectFromToolCall,
    detectFromFileChanges,
    detectFromMessage,
  };
}
