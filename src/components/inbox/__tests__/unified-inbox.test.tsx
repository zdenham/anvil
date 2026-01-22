import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@/test/helpers";
import { UnifiedInbox } from "../unified-inbox";
import {
  createThread,
  createPlan,
  resetAllCounters,
} from "@/test/factories";
import { TestStores } from "@/test/helpers/stores";

describe("UnifiedInbox", () => {
  beforeEach(() => {
    resetAllCounters();
    TestStores.clear();
  });

  const defaultProps = {
    threads: [],
    plans: [],
    threadLastMessages: {},
    onThreadSelect: vi.fn(),
    onPlanSelect: vi.fn(),
  };

  describe("empty state", () => {
    it("should render EmptyInboxState when no items exist", () => {
      render(<UnifiedInbox {...defaultProps} />);

      expect(screen.getByText("Welcome to Mission Control")).toBeInTheDocument();
    });
  });

  describe("list rendering", () => {
    it("should render all items in a single unified list", () => {
      const thread = createThread();
      const plan = createPlan();
      TestStores.seedThread(thread);
      TestStores.seedPlan(plan);

      render(
        <UnifiedInbox
          {...defaultProps}
          threads={[thread]}
          plans={[plan]}
          threadLastMessages={{ [thread.id]: "Hello" }}
        />
      );

      const items = screen.getAllByTestId("inbox-item");
      expect(items).toHaveLength(2);
    });

    it("should NOT render filter tabs", () => {
      const thread = createThread();
      TestStores.seedThread(thread);

      render(
        <UnifiedInbox
          {...defaultProps}
          threads={[thread]}
          threadLastMessages={{ [thread.id]: "Hello" }}
        />
      );

      // There should be no tabs or filter buttons
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.queryByText("Threads")).not.toBeInTheDocument();
      expect(screen.queryByText("Plans")).not.toBeInTheDocument();
    });

    it("should NOT render section headers", () => {
      const thread = createThread();
      const plan = createPlan();
      TestStores.seedThread(thread);
      TestStores.seedPlan(plan);

      render(
        <UnifiedInbox
          {...defaultProps}
          threads={[thread]}
          plans={[plan]}
          threadLastMessages={{ [thread.id]: "Hello" }}
        />
      );

      // There should be no section headers like "Threads" or "Plans"
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });

    it("should sort items by updatedAt descending", () => {
      const oldThread = createThread({ updatedAt: 1000 });
      const newPlan = createPlan({ updatedAt: 2000 });
      TestStores.seedThread(oldThread);
      TestStores.seedPlan(newPlan);

      render(
        <UnifiedInbox
          {...defaultProps}
          threads={[oldThread]}
          plans={[newPlan]}
          threadLastMessages={{ [oldThread.id]: "Old message" }}
        />
      );

      const items = screen.getAllByTestId("inbox-item");
      // First item should be the plan (more recent)
      expect(items[0]).toHaveAttribute("data-item-type", "plan");
      // Second item should be the thread (older)
      expect(items[1]).toHaveAttribute("data-item-type", "thread");
    });

    it("should interleave threads and plans based on updatedAt", () => {
      const thread1 = createThread({ updatedAt: 4000 });
      const plan1 = createPlan({ updatedAt: 3000 });
      const thread2 = createThread({ updatedAt: 2000 });
      const plan2 = createPlan({ updatedAt: 1000 });

      TestStores.seedThreads({ threads: { [thread1.id]: thread1, [thread2.id]: thread2 } });
      TestStores.seedPlans([plan1, plan2]);

      render(
        <UnifiedInbox
          {...defaultProps}
          threads={[thread1, thread2]}
          plans={[plan1, plan2]}
          threadLastMessages={{
            [thread1.id]: "Thread 1",
            [thread2.id]: "Thread 2",
          }}
        />
      );

      const items = screen.getAllByTestId("inbox-item");
      expect(items).toHaveLength(4);
      expect(items[0]).toHaveAttribute("data-item-type", "thread"); // 4000
      expect(items[1]).toHaveAttribute("data-item-type", "plan"); // 3000
      expect(items[2]).toHaveAttribute("data-item-type", "thread"); // 2000
      expect(items[3]).toHaveAttribute("data-item-type", "plan"); // 1000
    });
  });

  describe("selection callbacks", () => {
    it("should call onThreadSelect when thread item is clicked", () => {
      const onThreadSelect = vi.fn();
      const thread = createThread();
      TestStores.seedThread(thread);

      render(
        <UnifiedInbox
          {...defaultProps}
          threads={[thread]}
          threadLastMessages={{ [thread.id]: "Hello" }}
          onThreadSelect={onThreadSelect}
        />
      );

      screen.getByTestId("inbox-item").click();

      expect(onThreadSelect).toHaveBeenCalledTimes(1);
      expect(onThreadSelect).toHaveBeenCalledWith(thread);
    });

    it("should call onPlanSelect when plan item is clicked", () => {
      const onPlanSelect = vi.fn();
      const plan = createPlan();
      TestStores.seedPlan(plan);

      render(
        <UnifiedInbox
          {...defaultProps}
          plans={[plan]}
          onPlanSelect={onPlanSelect}
        />
      );

      screen.getByTestId("inbox-item").click();

      expect(onPlanSelect).toHaveBeenCalledTimes(1);
      expect(onPlanSelect).toHaveBeenCalledWith(plan);
    });
  });

  describe("archive button", () => {
    it("should render archive button for threads", () => {
      const thread = createThread();
      TestStores.seedThread(thread);

      render(
        <UnifiedInbox
          {...defaultProps}
          threads={[thread]}
          threadLastMessages={{ [thread.id]: "Hello" }}
        />
      );

      expect(screen.getByTestId("archive-button")).toBeInTheDocument();
    });

    it("should render archive button for plans", () => {
      const plan = createPlan();
      TestStores.seedPlan(plan);

      render(
        <UnifiedInbox
          {...defaultProps}
          plans={[plan]}
        />
      );

      expect(screen.getByTestId("archive-button")).toBeInTheDocument();
    });
  });

  describe("className prop", () => {
    it("should apply custom className to container", () => {
      const thread = createThread();
      TestStores.seedThread(thread);

      render(
        <UnifiedInbox
          {...defaultProps}
          threads={[thread]}
          threadLastMessages={{ [thread.id]: "Hello" }}
          className="custom-class"
        />
      );

      expect(screen.getByTestId("unified-inbox")).toHaveClass("custom-class");
    });
  });
});
