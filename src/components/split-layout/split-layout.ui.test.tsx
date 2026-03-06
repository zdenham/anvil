/**
 * Split Layout UI Tests
 *
 * Tests the recursive split layout rendering system.
 * Covers: leaf nodes, horizontal splits, vertical splits, nested splits,
 * resize handles, and hydration gating.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test/helpers";
import { usePaneLayoutStore } from "@/stores/pane-layout/store";
import { SplitLayoutContainer } from "./split-layout-container";
import { SplitNodeRenderer } from "./split-node-renderer";
import { DndBridgeProvider } from "./dnd-context-bridge";
import type { SplitNode, PaneGroup } from "@/stores/pane-layout/types";
import type { ReactNode } from "react";

// Suppress logger output during tests
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock hotkey-service and invoke
vi.mock("@/lib/hotkey-service", () => ({
  showMainWindowWithView: vi.fn(),
}));
vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(),
  connectWs: () => Promise.resolve(),
  disconnectWs: () => {},
  setEventDispatcher: () => {},
}));

// Mock pane layout service to prevent disk writes in tests
vi.mock("@/stores/pane-layout/service", () => ({
  paneLayoutService: {
    hydrate: vi.fn(),
    setActiveGroup: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    openTab: vi.fn(),
    updateSplitSizes: vi.fn(),
    reorderTabs: vi.fn(),
    moveTab: vi.fn(),
    splitGroup: vi.fn(),
  },
}));

function createGroup(groupId: string, tabView = { type: "empty" as const }): PaneGroup {
  const tabId = `tab-${groupId}`;
  return {
    id: groupId,
    tabs: [{ id: tabId, view: tabView }],
    activeTabId: tabId,
  };
}

function hydrateStore(root: SplitNode, groups: Record<string, PaneGroup>, activeGroupId: string) {
  usePaneLayoutStore.getState().hydrate({ root, groups, activeGroupId });
}

const noop = () => {};

/** Wrapper providing DndBridge context for split node tests. */
function DndWrapper({ children }: { children: ReactNode }) {
  return (
    <DndBridgeProvider value={{ activeDrag: null, onEdgeDrop: noop }}>
      {children}
    </DndBridgeProvider>
  );
}

describe("SplitLayoutContainer", () => {
  beforeEach(() => {
    usePaneLayoutStore.setState({
      root: { type: "leaf", groupId: "" },
      groups: {},
      activeGroupId: "",
      _hydrated: false,
    });
  });

  it("renders nothing when not hydrated", () => {
    render(<SplitLayoutContainer />);
    expect(screen.queryByTestId("split-layout-container")).toBeNull();
  });

  it("renders when hydrated with a single leaf", () => {
    const groupId = "g1";
    hydrateStore(
      { type: "leaf", groupId },
      { [groupId]: createGroup(groupId) },
      groupId,
    );

    render(<SplitLayoutContainer />);
    expect(screen.getByTestId("split-layout-container")).toBeInTheDocument();
    expect(screen.getByTestId(`pane-group-${groupId}`)).toBeInTheDocument();
  });
});

describe("SplitNodeRenderer", () => {
  beforeEach(() => {
    usePaneLayoutStore.setState({
      root: { type: "leaf", groupId: "" },
      groups: {},
      activeGroupId: "",
      _hydrated: true,
    });
  });

  it("renders a leaf node as a pane group", () => {
    const groupId = "g1";
    usePaneLayoutStore.setState({
      groups: { [groupId]: createGroup(groupId) },
      activeGroupId: groupId,
    });

    const node: SplitNode = { type: "leaf", groupId };
    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );
    expect(screen.getByTestId(`pane-group-${groupId}`)).toBeInTheDocument();
  });

  it("renders a horizontal split with two children", () => {
    const g1 = createGroup("g1");
    const g2 = createGroup("g2");
    usePaneLayoutStore.setState({
      groups: { g1, g2 },
      activeGroupId: "g1",
    });

    const node: SplitNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", groupId: "g1" },
        { type: "leaf", groupId: "g2" },
      ],
      sizes: [50, 50],
    };

    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const splitNode = screen.getByTestId("split-node");
    expect(splitNode).toHaveAttribute("data-direction", "horizontal");
    expect(splitNode).toHaveClass("flex-row");

    const children = screen.getAllByTestId("split-child");
    expect(children).toHaveLength(2);
    expect(children[0]).toHaveStyle({ flexBasis: "50%" });
    expect(children[1]).toHaveStyle({ flexBasis: "50%" });

    expect(screen.getByTestId("split-resize-handle")).toBeInTheDocument();
    expect(screen.getByTestId("split-resize-handle")).toHaveAttribute("data-direction", "horizontal");
  });

  it("renders a vertical split with two children", () => {
    const g1 = createGroup("g1");
    const g2 = createGroup("g2");
    usePaneLayoutStore.setState({
      groups: { g1, g2 },
      activeGroupId: "g1",
    });

    const node: SplitNode = {
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", groupId: "g1" },
        { type: "leaf", groupId: "g2" },
      ],
      sizes: [60, 40],
    };

    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const splitNode = screen.getByTestId("split-node");
    expect(splitNode).toHaveAttribute("data-direction", "vertical");
    expect(splitNode).toHaveClass("flex-col");

    const children = screen.getAllByTestId("split-child");
    expect(children).toHaveLength(2);
    expect(children[0]).toHaveStyle({ flexBasis: "60%" });
    expect(children[1]).toHaveStyle({ flexBasis: "40%" });

    expect(screen.getByTestId("split-resize-handle")).toHaveAttribute("data-direction", "vertical");
  });

  it("renders a three-child horizontal split with two resize handles", () => {
    const g1 = createGroup("g1");
    const g2 = createGroup("g2");
    const g3 = createGroup("g3");
    usePaneLayoutStore.setState({
      groups: { g1, g2, g3 },
      activeGroupId: "g1",
    });

    const node: SplitNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", groupId: "g1" },
        { type: "leaf", groupId: "g2" },
        { type: "leaf", groupId: "g3" },
      ],
      sizes: [33.3, 33.3, 33.4],
    };

    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const children = screen.getAllByTestId("split-child");
    expect(children).toHaveLength(3);

    const handles = screen.getAllByTestId("split-resize-handle");
    expect(handles).toHaveLength(2);
  });

  it("renders nested splits (horizontal inside vertical)", () => {
    const g1 = createGroup("g1");
    const g2 = createGroup("g2");
    const g3 = createGroup("g3");
    usePaneLayoutStore.setState({
      groups: { g1, g2, g3 },
      activeGroupId: "g1",
    });

    const node: SplitNode = {
      type: "split",
      direction: "vertical",
      children: [
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", groupId: "g1" },
            { type: "leaf", groupId: "g2" },
          ],
          sizes: [50, 50],
        },
        { type: "leaf", groupId: "g3" },
      ],
      sizes: [70, 30],
    };

    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const splitNodes = screen.getAllByTestId("split-node");
    expect(splitNodes).toHaveLength(2);

    expect(splitNodes[0]).toHaveAttribute("data-direction", "vertical");
    expect(splitNodes[1]).toHaveAttribute("data-direction", "horizontal");

    // 3 total pane groups
    expect(screen.getByTestId("pane-group-g1")).toBeInTheDocument();
    expect(screen.getByTestId("pane-group-g2")).toBeInTheDocument();
    expect(screen.getByTestId("pane-group-g3")).toBeInTheDocument();

    const handles = screen.getAllByTestId("split-resize-handle");
    expect(handles).toHaveLength(2);
  });

  it("applies unequal sizes correctly", () => {
    const g1 = createGroup("g1");
    const g2 = createGroup("g2");
    usePaneLayoutStore.setState({
      groups: { g1, g2 },
      activeGroupId: "g1",
    });

    const node: SplitNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", groupId: "g1" },
        { type: "leaf", groupId: "g2" },
      ],
      sizes: [30, 70],
    };

    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const children = screen.getAllByTestId("split-child");
    expect(children[0]).toHaveStyle({ flexBasis: "30%" });
    expect(children[1]).toHaveStyle({ flexBasis: "70%" });
  });
});

describe("SplitResizeHandle", () => {
  it("renders with correct cursor for horizontal direction", () => {
    const g1 = createGroup("g1");
    const g2 = createGroup("g2");
    usePaneLayoutStore.setState({
      groups: { g1, g2 },
      activeGroupId: "g1",
      _hydrated: true,
    });

    const node: SplitNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", groupId: "g1" },
        { type: "leaf", groupId: "g2" },
      ],
      sizes: [50, 50],
    };

    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const handle = screen.getByTestId("split-resize-handle");
    expect(handle).toHaveClass("cursor-col-resize");
  });

  it("renders with correct cursor for vertical direction", () => {
    const g1 = createGroup("g1");
    const g2 = createGroup("g2");
    usePaneLayoutStore.setState({
      groups: { g1, g2 },
      activeGroupId: "g1",
      _hydrated: true,
    });

    const node: SplitNode = {
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", groupId: "g1" },
        { type: "leaf", groupId: "g2" },
      ],
      sizes: [50, 50],
    };

    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const handle = screen.getByTestId("split-resize-handle");
    expect(handle).toHaveClass("cursor-row-resize");
  });

  it("has accessible separator role", () => {
    const g1 = createGroup("g1");
    const g2 = createGroup("g2");
    usePaneLayoutStore.setState({
      groups: { g1, g2 },
      activeGroupId: "g1",
      _hydrated: true,
    });

    const node: SplitNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", groupId: "g1" },
        { type: "leaf", groupId: "g2" },
      ],
      sizes: [50, 50],
    };

    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const handle = screen.getByRole("separator");
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute("aria-label", "Drag to resize");
  });
});

describe("PaneGroup", () => {
  beforeEach(() => {
    usePaneLayoutStore.setState({
      root: { type: "leaf", groupId: "" },
      groups: {},
      activeGroupId: "",
      _hydrated: true,
    });
  });

  it("marks active group with ring accent", () => {
    const g1 = createGroup("g1");
    usePaneLayoutStore.setState({
      groups: { g1 },
      activeGroupId: "g1",
    });

    const node: SplitNode = { type: "leaf", groupId: "g1" };
    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const group = screen.getByTestId("pane-group-g1");
    expect(group).toHaveClass("ring-1");
  });

  it("does not show ring on inactive group", () => {
    const g1 = createGroup("g1");
    const g2 = createGroup("g2");
    usePaneLayoutStore.setState({
      groups: { g1, g2 },
      activeGroupId: "g2",
    });

    const node: SplitNode = { type: "leaf", groupId: "g1" };
    render(
      <DndWrapper>
        <SplitNodeRenderer node={node} path={[]} />
      </DndWrapper>,
    );

    const group = screen.getByTestId("pane-group-g1");
    expect(group).not.toHaveClass("ring-1");
  });
});
