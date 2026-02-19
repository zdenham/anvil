/**
 * Plan Input Area Component
 *
 * Input area for starting a new thread from a plan.
 * When the user sends a message while viewing a plan:
 * 1. A new thread is created
 * 2. The message is prefixed with @plan:{planId} mention
 * 3. A "mentioned" relation is created between the thread and plan
 * 4. The control panel switches to show the new thread's conversation
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { usePlanStore } from "@/entities/plans/store";
import { useControlPanelStore } from "./store";
import { threadService } from "@/entities/threads/service";
import { draftService } from "@/entities/drafts/service";
import { logger } from "@/lib/logger-client";

interface PlanInputAreaProps {
  planId: string;
}

export function PlanInputArea({ planId }: PlanInputAreaProps) {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const plan = usePlanStore((s) => s.getPlan(planId));
  const setView = useControlPanelStore((s) => s.setView);
  const messageRef = useRef(message);
  messageRef.current = message;

  // Restore draft on mount / planId change, save on unmount
  useEffect(() => {
    const draft = draftService.getPlanDraft(planId);
    if (draft) setMessage(draft);
    return () => {
      const current = messageRef.current;
      if (current.trim()) {
        draftService.savePlanDraft(planId, current);
      } else {
        draftService.clearPlanDraft(planId);
      }
    };
  }, [planId]);

  const handleSend = useCallback(async () => {
    if (!message.trim() || !plan) return;

    setIsLoading(true);
    try {
      // TODO: Get repoId and worktreeId from plan once schema is updated
      // For now, this will fail gracefully if plan doesn't have these fields
      const repoId = (plan as { repoId?: string }).repoId;
      const worktreeId = (plan as { worktreeId?: string }).worktreeId;

      if (!repoId || !worktreeId) {
        logger.warn("[PlanInputArea] Plan does not have repoId/worktreeId, cannot create thread");
        return;
      }

      // 1. Create new thread with the @plan mention prefix
      const messageWithMention = `@plan:${planId} ${message}`;
      const thread = await threadService.create({
        repoId,
        worktreeId,
        prompt: messageWithMention,
      });

      // 2. TODO: Create relation (mentioned) once relationService exists
      // await relationService.createOrUpgrade({
      //   threadId: thread.id,
      //   planId: planId,
      //   type: 'mentioned',
      // });

      logger.info(`[PlanInputArea] Created thread ${thread.id} with plan mention`);

      // 4. Switch to thread view
      setView({ type: "thread", threadId: thread.id });

      setMessage("");
      draftService.clearPlanDraft(planId);
    } catch (error) {
      logger.error("[PlanInputArea] Failed to create thread:", error);
    } finally {
      setIsLoading(false);
    }
  }, [message, plan, planId, setView]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="border-t border-surface-700 p-3">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Start a new thread about this plan..."
        className="w-full bg-surface-800 border border-surface-700 rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-surface-600 text-surface-100 placeholder:text-surface-500"
        rows={3}
        disabled={isLoading}
        onKeyDown={handleKeyDown}
      />
      <div className="flex justify-end mt-2">
        <button
          onClick={handleSend}
          disabled={!message.trim() || isLoading}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-600 transition-colors"
        >
          {isLoading ? "Creating..." : "Start Thread"}
        </button>
      </div>
    </div>
  );
}
