/**
 * Navigation Service
 *
 * Centralized navigation that handles both tree selection and pane layout
 * tab/view updates together, ensuring they always stay in sync.
 *
 * Regular clicks use findOrOpenTab (dedup: finds existing tab or replaces active).
 * Cmd+Click / middle-click passes { newTab: true } to always open a new tab.
 */

import { paneLayoutService } from "./pane-layout/service";
import { treeMenuService } from "./tree-menu/service";
import type { ContentPaneView } from "@/components/content-pane/types";

export interface NavigateOptions {
  /** When true, always opens a new tab instead of reusing an existing one. */
  newTab?: boolean;
  /** Auto-focus the input (for threads). */
  autoFocus?: boolean;
}

function openOrFind(view: ContentPaneView, options?: NavigateOptions): Promise<void> {
  if (options?.newTab) {
    return paneLayoutService.openTab(view).then(() => undefined);
  }
  return paneLayoutService.findOrOpenTab(view);
}

export const navigationService = {
  /**
   * Navigate to a thread - updates both pane layout AND tree selection.
   */
  async navigateToThread(threadId: string, options?: NavigateOptions): Promise<void> {
    await treeMenuService.setSelectedItem(threadId);
    const view: ContentPaneView = {
      type: "thread",
      threadId,
      autoFocus: options?.autoFocus,
    };
    await openOrFind(view, options);
  },

  /**
   * Navigate to a plan - updates both pane layout AND tree selection.
   */
  async navigateToPlan(planId: string, options?: NavigateOptions): Promise<void> {
    await treeMenuService.setSelectedItem(planId);
    await openOrFind({ type: "plan", planId }, options);
  },

  /**
   * Navigate to a file - clears tree selection (files aren't tree items).
   */
  async navigateToFile(
    filePath: string,
    context?: { repoId?: string; worktreeId?: string; lineNumber?: number },
    options?: NavigateOptions,
  ): Promise<void> {
    await treeMenuService.setSelectedItem(null);
    await openOrFind({ type: "file", filePath, ...context }, options);
  },

  /**
   * Navigate to a terminal - updates both pane layout AND tree selection.
   */
  async navigateToTerminal(terminalId: string, options?: NavigateOptions): Promise<void> {
    await treeMenuService.setSelectedItem(terminalId);
    await openOrFind({ type: "terminal", terminalId }, options);
  },

  /**
   * Navigate to a pull request - updates both pane layout AND tree selection.
   */
  async navigateToPullRequest(prId: string, options?: NavigateOptions): Promise<void> {
    await treeMenuService.setSelectedItem(prId);
    await openOrFind({ type: "pull-request", prId }, options);
  },

  /**
   * Navigate to the Changes view for a worktree.
   */
  async navigateToChanges(repoId: string, worktreeId: string, options?: {
    uncommittedOnly?: boolean;
    commitHash?: string;
    /** Tree item ID to select */
    treeItemId?: string;
  } & NavigateOptions): Promise<void> {
    const { treeItemId, newTab, ...viewOptions } = options ?? {};
    await treeMenuService.setSelectedItem(treeItemId ?? null);
    const view: ContentPaneView = { type: "changes", repoId, worktreeId, ...viewOptions };
    await openOrFind(view, { newTab });
  },

  /**
   * Navigate to a view - dispatches to specific methods or handles directly.
   */
  async navigateToView(view: ContentPaneView, options?: NavigateOptions): Promise<void> {
    if (view.type === "thread") {
      await this.navigateToThread(view.threadId, { ...options, autoFocus: view.autoFocus });
    } else if (view.type === "plan") {
      await this.navigateToPlan(view.planId, options);
    } else if (view.type === "file") {
      await this.navigateToFile(view.filePath, {
        repoId: view.repoId,
        worktreeId: view.worktreeId,
        lineNumber: view.lineNumber,
      }, options);
    } else if (view.type === "terminal") {
      await this.navigateToTerminal(view.terminalId, options);
    } else if (view.type === "pull-request") {
      await this.navigateToPullRequest(view.prId, options);
    } else if (view.type === "changes") {
      await treeMenuService.setSelectedItem(null);
      await openOrFind(view, options);
    } else {
      // For settings, logs, archive, empty - clear tree selection
      await treeMenuService.setSelectedItem(null);
      await openOrFind(view, options);
    }
  },
};
