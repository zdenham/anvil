/**
 * Tests for the TabBar "+" button behavior — verifies that clicking "+"
 * creates a terminal when the active tab is a terminal, and falls back
 * to creating a thread otherwise.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/helpers";
import { DndContext } from "@dnd-kit/core";
import { TabBar } from "./tab-bar";
import type { TabItem } from "@/stores/pane-layout/types";

const {
  mockOpenTab,
  mockTerminalGet,
  mockTerminalCreate,
  mockThreadCreate,
  mockUseMRUWorktree,
} = vi.hoisted(() => ({
  mockOpenTab: vi.fn(),
  mockTerminalGet: vi.fn(),
  mockTerminalCreate: vi.fn(),
  mockThreadCreate: vi.fn(),
  mockUseMRUWorktree: vi.fn(),
}));

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/lib/hotkey-service", () => ({
  showMainWindowWithView: vi.fn(),
}));

vi.mock("@/stores/pane-layout/service", () => ({
  paneLayoutService: {
    hydrate: vi.fn(),
    setActiveGroup: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    openTab: mockOpenTab,
    updateSplitSizes: vi.fn(),
    reorderTabs: vi.fn(),
    moveTab: vi.fn(),
    splitGroup: vi.fn(),
  },
}));

vi.mock("@/entities/terminal-sessions", () => ({
  terminalSessionService: {
    get: (...args: unknown[]) => mockTerminalGet(...args),
    create: (...args: unknown[]) => mockTerminalCreate(...args),
  },
}));

vi.mock("@/entities/threads/service", () => ({
  threadService: {
    create: (...args: unknown[]) => mockThreadCreate(...args),
  },
}));

vi.mock("@/hooks/use-mru-worktree", () => ({
  useMRUWorktree: () => mockUseMRUWorktree(),
}));

function renderTabBar(tabs: TabItem[], activeTabId: string) {
  return render(
    <DndContext>
      <TabBar groupId="g1" tabs={tabs} activeTabId={activeTabId} />
    </DndContext>,
  );
}

describe("TabBar new tab button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMRUWorktree.mockReturnValue({ repoId: "repo-1", worktreeId: "wt-1" });
    mockThreadCreate.mockResolvedValue({});
  });

  it("creates a terminal when the active tab is a terminal", async () => {
    const tabs: TabItem[] = [
      { id: "t1", view: { type: "terminal", terminalId: "term-1" } },
    ];
    mockTerminalGet.mockReturnValue({
      id: "term-1",
      worktreeId: "wt-1",
      worktreePath: "/path/to/worktree",
    });
    mockTerminalCreate.mockResolvedValue({ id: "term-2" });

    renderTabBar(tabs, "t1");
    fireEvent.click(screen.getByTestId("tab-new-g1"));

    await waitFor(() => {
      expect(mockTerminalCreate).toHaveBeenCalledWith("wt-1", "/path/to/worktree");
      expect(mockOpenTab).toHaveBeenCalledWith(
        { type: "terminal", terminalId: "term-2" },
        "g1",
      );
    });
    expect(mockThreadCreate).not.toHaveBeenCalled();
  });

  it("creates a thread when the active tab is a thread", async () => {
    const tabs: TabItem[] = [
      { id: "t1", view: { type: "thread", threadId: "thread-1" } },
    ];

    renderTabBar(tabs, "t1");
    fireEvent.click(screen.getByTestId("tab-new-g1"));

    await waitFor(() => {
      expect(mockThreadCreate).toHaveBeenCalled();
      expect(mockOpenTab).toHaveBeenCalledWith(
        expect.objectContaining({ type: "thread" }),
        "g1",
      );
    });
    expect(mockTerminalCreate).not.toHaveBeenCalled();
  });

  it("falls back to thread when terminal session lookup fails", async () => {
    const tabs: TabItem[] = [
      { id: "t1", view: { type: "terminal", terminalId: "term-1" } },
    ];
    mockTerminalGet.mockReturnValue(undefined);

    renderTabBar(tabs, "t1");
    fireEvent.click(screen.getByTestId("tab-new-g1"));

    await waitFor(() => {
      expect(mockThreadCreate).toHaveBeenCalled();
      expect(mockOpenTab).toHaveBeenCalledWith(
        expect.objectContaining({ type: "thread" }),
        "g1",
      );
    });
    expect(mockTerminalCreate).not.toHaveBeenCalled();
  });

  it("falls back to thread when terminal creation throws", async () => {
    const tabs: TabItem[] = [
      { id: "t1", view: { type: "terminal", terminalId: "term-1" } },
    ];
    mockTerminalGet.mockReturnValue({
      id: "term-1",
      worktreeId: "wt-1",
      worktreePath: "/path/to/worktree",
    });
    mockTerminalCreate.mockRejectedValue(new Error("spawn failed"));

    renderTabBar(tabs, "t1");
    fireEvent.click(screen.getByTestId("tab-new-g1"));

    await waitFor(() => {
      expect(mockThreadCreate).toHaveBeenCalled();
      expect(mockOpenTab).toHaveBeenCalledWith(
        expect.objectContaining({ type: "thread" }),
        "g1",
      );
    });
  });
});
