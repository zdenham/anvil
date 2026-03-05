/**
 * Pane Layout Event Listeners
 *
 * Handles archive events to close tabs showing archived content
 * across all groups. If closing tabs leaves a group empty,
 * the group is removed and the split tree collapses.
 */

import { EventName, type EventPayloads } from "@core/types/events.js";
import { eventBus } from "@/entities/events";
import { paneLayoutService } from "./service";
import { usePaneLayoutStore } from "./store";
import { logger } from "@/lib/logger-client";

/**
 * Close all tabs matching a predicate across every pane group.
 * Handles empty-group cleanup automatically via paneLayoutService.closeTab.
 */
async function closeMatchingTabs(
  predicate: (view: { type: string; [key: string]: unknown }) => boolean,
): Promise<void> {
  const { groups } = usePaneLayoutStore.getState();

  for (const group of Object.values(groups)) {
    for (const tab of group.tabs) {
      if (predicate(tab.view)) {
        await paneLayoutService.closeTab(group.id, tab.id);
      }
    }
  }
}

/**
 * Setup pane layout event listeners.
 * Handles THREAD_ARCHIVED and PLAN_ARCHIVED events to close
 * tabs showing archived content across all groups.
 */
export function setupPaneLayoutListeners(): void {
  eventBus.on(
    EventName.THREAD_ARCHIVED,
    ({ threadId }: EventPayloads[typeof EventName.THREAD_ARCHIVED]) => {
      closeMatchingTabs(
        (view) => view.type === "thread" && view.threadId === threadId,
      ).catch((e) => {
        logger.error(`[PaneLayoutListener] Failed to close archived thread tabs ${threadId}:`, e);
      });
      logger.info(`[PaneLayoutListener] Closed tabs for archived thread ${threadId}`);
    },
  );

  eventBus.on(
    EventName.PLAN_ARCHIVED,
    ({ planId }: EventPayloads[typeof EventName.PLAN_ARCHIVED]) => {
      closeMatchingTabs(
        (view) => view.type === "plan" && view.planId === planId,
      ).catch((e) => {
        logger.error(`[PaneLayoutListener] Failed to close archived plan tabs ${planId}:`, e);
      });
      logger.info(`[PaneLayoutListener] Closed tabs for archived plan ${planId}`);
    },
  );

  logger.debug("[PaneLayoutListener] Pane layout listeners initialized");
}
