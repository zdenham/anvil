import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { InboxItemRow } from "../inbox-item";
import type { InboxItem } from "../types";
import {
  createThread,
  createPlan,
  createRelation,
  resetAllCounters,
} from "@/test/factories";
import { TestStores } from "@/test/helpers/stores";

describe("InboxItemRow", () => {
  beforeEach(() => {
    resetAllCounters();
    TestStores.clear();
  });

  function createThreadItem(
    overrides: Partial<InboxItem> = {}
  ): InboxItem {
    const thread = createThread();
    return {
      type: "thread",
      data: thread,
      sortKey: thread.updatedAt,
      displayText: "Test message",
      ...overrides,
    } as InboxItem;
  }

  function createPlanItem(
    overrides: Partial<InboxItem> = {}
  ): InboxItem {
    const plan = createPlan();
    return {
      type: "plan",
      data: plan,
      sortKey: plan.updatedAt,
      displayText: "test-plan",
      ...overrides,
    } as InboxItem;
  }

  describe("display text", () => {
    it("should display item.displayText as the title", () => {
      const item = createThreadItem({ displayText: "My custom message" });
      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      expect(screen.getByTestId("inbox-item-text")).toHaveTextContent(
        "My custom message"
      );
    });
  });

  describe("click handling", () => {
    it("should call onSelect when item is clicked", () => {
      const onSelect = vi.fn();
      const item = createThreadItem();
      render(<InboxItemRow item={item} onSelect={onSelect} />);

      fireEvent.click(screen.getByTestId("inbox-item"));

      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe("status dot for threads", () => {
    it("should display status dot with running class for running threads", () => {
      const thread = createThread({ status: "running" });
      const item: InboxItem = {
        type: "thread",
        data: thread,
        sortKey: thread.updatedAt,
        displayText: "Running task",
      };
      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      const dot = screen.getByTestId("status-dot");
      expect(dot).toHaveClass("status-dot-running");
    });

    it("should display status dot with blue color for unread items", () => {
      const thread = createThread({ status: "idle", isRead: false });
      const item: InboxItem = {
        type: "thread",
        data: thread,
        sortKey: thread.updatedAt,
        displayText: "Unread task",
      };
      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      const dot = screen.getByTestId("status-dot");
      expect(dot).toHaveClass("bg-blue-500");
    });

    it("should display grey status dot for read, non-running items", () => {
      const thread = createThread({ status: "idle", isRead: true });
      const item: InboxItem = {
        type: "thread",
        data: thread,
        sortKey: thread.updatedAt,
        displayText: "Read task",
      };
      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      const dot = screen.getByTestId("status-dot");
      expect(dot).toHaveClass("bg-zinc-400");
    });
  });

  describe("status dot for plans", () => {
    it("should display running class for plan with running associated thread", () => {
      const thread = createThread({ id: "thread-running", status: "running" });
      const plan = createPlan({ id: "plan-1" });
      const relation = createRelation({
        planId: "plan-1",
        threadId: "thread-running",
        type: "created",
      });

      // Seed stores
      TestStores.seedThread(thread);
      TestStores.seedPlan(plan);
      TestStores.seedRelation(relation);

      const item: InboxItem = {
        type: "plan",
        data: plan,
        sortKey: plan.updatedAt,
        displayText: "test-plan",
      };

      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      const dot = screen.getByTestId("status-dot");
      expect(dot).toHaveClass("status-dot-running");
    });

    it("should display grey for plan with no running threads", () => {
      const plan = createPlan({ id: "plan-1", isRead: true });
      TestStores.seedPlan(plan);

      const item: InboxItem = {
        type: "plan",
        data: plan,
        sortKey: plan.updatedAt,
        displayText: "test-plan",
      };

      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      const dot = screen.getByTestId("status-dot");
      expect(dot).toHaveClass("bg-zinc-400");
    });
  });

  describe("unread indicator", () => {
    it("should display unread indicator dot when item.data.isRead is false", () => {
      const thread = createThread({ isRead: false });
      const item: InboxItem = {
        type: "thread",
        data: thread,
        sortKey: thread.updatedAt,
        displayText: "Unread item",
      };
      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      expect(screen.getByTestId("unread-indicator")).toBeInTheDocument();
    });

    it("should not display unread indicator when item.data.isRead is true", () => {
      const thread = createThread({ isRead: true });
      const item: InboxItem = {
        type: "thread",
        data: thread,
        sortKey: thread.updatedAt,
        displayText: "Read item",
      };
      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      expect(screen.queryByTestId("unread-indicator")).not.toBeInTheDocument();
    });
  });

  describe("archive button", () => {
    it("should render archive button", () => {
      const item = createThreadItem();
      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      expect(screen.getByTestId("archive-button")).toBeInTheDocument();
    });

    it("should not trigger select when archive button is clicked", () => {
      const onSelect = vi.fn();
      const item = createThreadItem();
      render(<InboxItemRow item={item} onSelect={onSelect} />);

      fireEvent.click(screen.getByTestId("archive-button"));

      // Archive click should not trigger select
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("should show confirmation state on first click", () => {
      const item = createThreadItem();
      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      const button = screen.getByTestId("archive-button");
      expect(button).toHaveAttribute("data-confirming", "false");

      fireEvent.click(button);

      expect(button).toHaveAttribute("data-confirming", "true");
      expect(button).toHaveTextContent("Confirm");
    });
  });

  describe("styling", () => {
    it("should apply correct CSS classes matching UnifiedTaskList styling", () => {
      const item = createThreadItem();
      render(<InboxItemRow item={item} onSelect={vi.fn()} />);

      const listItem = screen.getByTestId("inbox-item");
      expect(listItem).toHaveClass("bg-surface-800");
      expect(listItem).toHaveClass("rounded-lg");
      expect(listItem).toHaveClass("border");
      expect(listItem).toHaveClass("border-surface-700");
      expect(listItem).toHaveClass("hover:border-surface-600");
      expect(listItem).toHaveClass("cursor-pointer");

      const text = screen.getByTestId("inbox-item-text");
      expect(text).toHaveClass("text-sm");
      expect(text).toHaveClass("text-surface-100");
      expect(text).toHaveClass("truncate");
      expect(text).toHaveClass("font-mono");
    });
  });
});
