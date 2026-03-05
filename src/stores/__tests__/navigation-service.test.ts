/**
 * Navigation Service Tests
 *
 * Verifies that the navigation service correctly routes through
 * paneLayoutService for both regular navigation (findOrOpenTab)
 * and new-tab navigation (openTab).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/stores/pane-layout/service", () => ({
  paneLayoutService: {
    findOrOpenTab: vi.fn().mockResolvedValue(undefined),
    openTab: vi.fn().mockResolvedValue("tab-123"),
  },
}));

vi.mock("@/stores/tree-menu/service", () => ({
  treeMenuService: {
    setSelectedItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { navigationService } from "../navigation-service";
import { paneLayoutService } from "@/stores/pane-layout/service";
import { treeMenuService } from "@/stores/tree-menu/service";

describe("navigationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("navigateToThread", () => {
    it("sets tree selection and calls findOrOpenTab for regular click", async () => {
      await navigationService.navigateToThread("t-1");

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("t-1");
      expect(paneLayoutService.findOrOpenTab).toHaveBeenCalledWith(
        { type: "thread", threadId: "t-1", autoFocus: undefined },
      );
      expect(paneLayoutService.openTab).not.toHaveBeenCalled();
    });

    it("calls openTab when newTab is true (Cmd+Click)", async () => {
      await navigationService.navigateToThread("t-2", { newTab: true });

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("t-2");
      expect(paneLayoutService.openTab).toHaveBeenCalledWith(
        { type: "thread", threadId: "t-2", autoFocus: undefined },
      );
      expect(paneLayoutService.findOrOpenTab).not.toHaveBeenCalled();
    });

    it("passes autoFocus through to the view", async () => {
      await navigationService.navigateToThread("t-3", { autoFocus: true });

      expect(paneLayoutService.findOrOpenTab).toHaveBeenCalledWith(
        { type: "thread", threadId: "t-3", autoFocus: true },
      );
    });
  });

  describe("navigateToPlan", () => {
    it("sets tree selection and calls findOrOpenTab", async () => {
      await navigationService.navigateToPlan("p-1");

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("p-1");
      expect(paneLayoutService.findOrOpenTab).toHaveBeenCalledWith(
        { type: "plan", planId: "p-1" },
      );
    });

    it("opens new tab when newTab is true", async () => {
      await navigationService.navigateToPlan("p-2", { newTab: true });

      expect(paneLayoutService.openTab).toHaveBeenCalledWith(
        { type: "plan", planId: "p-2" },
      );
    });
  });

  describe("navigateToFile", () => {
    it("clears tree selection and calls findOrOpenTab", async () => {
      await navigationService.navigateToFile("/path/to/file.ts", { lineNumber: 42 });

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith(null);
      expect(paneLayoutService.findOrOpenTab).toHaveBeenCalledWith(
        { type: "file", filePath: "/path/to/file.ts", lineNumber: 42 },
      );
    });
  });

  describe("navigateToTerminal", () => {
    it("sets tree selection and calls findOrOpenTab", async () => {
      await navigationService.navigateToTerminal("term-1");

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("term-1");
      expect(paneLayoutService.findOrOpenTab).toHaveBeenCalledWith(
        { type: "terminal", terminalId: "term-1" },
      );
    });
  });

  describe("navigateToPullRequest", () => {
    it("sets tree selection and calls findOrOpenTab", async () => {
      await navigationService.navigateToPullRequest("pr-1");

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("pr-1");
      expect(paneLayoutService.findOrOpenTab).toHaveBeenCalledWith(
        { type: "pull-request", prId: "pr-1" },
      );
    });
  });

  describe("navigateToChanges", () => {
    it("sets tree selection to treeItemId and calls findOrOpenTab", async () => {
      await navigationService.navigateToChanges("repo-1", "wt-1", {
        treeItemId: "changes-item-1",
      });

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("changes-item-1");
      expect(paneLayoutService.findOrOpenTab).toHaveBeenCalledWith(
        { type: "changes", repoId: "repo-1", worktreeId: "wt-1" },
      );
    });

    it("sets tree selection to null when no treeItemId", async () => {
      await navigationService.navigateToChanges("repo-1", "wt-1");

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith(null);
    });
  });

  describe("navigateToView", () => {
    it("dispatches thread views to navigateToThread", async () => {
      await navigationService.navigateToView({
        type: "thread",
        threadId: "t-1",
        autoFocus: true,
      });

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("t-1");
      expect(paneLayoutService.findOrOpenTab).toHaveBeenCalledWith(
        expect.objectContaining({ type: "thread", threadId: "t-1", autoFocus: true }),
      );
    });

    it("dispatches plan views to navigateToPlan", async () => {
      await navigationService.navigateToView({ type: "plan", planId: "p-1" });

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith("p-1");
    });

    it("dispatches settings/logs to direct view with null tree selection", async () => {
      await navigationService.navigateToView({ type: "settings" });

      expect(treeMenuService.setSelectedItem).toHaveBeenCalledWith(null);
      expect(paneLayoutService.findOrOpenTab).toHaveBeenCalledWith(
        { type: "settings" },
      );
    });

    it("passes newTab option through navigateToView", async () => {
      await navigationService.navigateToView(
        { type: "thread", threadId: "t-1" },
        { newTab: true },
      );

      expect(paneLayoutService.openTab).toHaveBeenCalledWith(
        expect.objectContaining({ type: "thread", threadId: "t-1" }),
      );
    });
  });
});
