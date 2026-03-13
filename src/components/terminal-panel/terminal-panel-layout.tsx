/**
 * TerminalPanelLayout
 *
 * Wraps the content zone (children) and a bottom terminal panel.
 * The terminal panel has its own split tree and DndContext,
 * enabling tabs to be split and rearranged within the panel.
 *
 * Layout:
 * ┌─────────────────────────────────┐
 * │  children (SplitLayoutContainer)│  <- Content zone
 * ├─ ─ ─ ─ drag handle ─ ─ ─ ─ ─ ─ ┤
 * │  Terminal SplitNodeRenderer     │  <- Terminal split tree
 * │  [tab1] [+]  │ [tab2] [+]     │
 * │  $ _         │ $ _             │
 * └─────────────────────────────────┘
 */

import { useCallback, useMemo, type ReactNode } from "react";
import { DndContext, closestCenter, DragOverlay } from "@dnd-kit/core";
import { usePaneLayoutStore, paneLayoutService } from "@/stores/pane-layout";
import type { SplitNode } from "@/stores/pane-layout";
import { ResizablePanelVertical } from "@/components/ui/resizable-panel-vertical";
import { DndBridgeProvider } from "@/components/split-layout/dnd-context-bridge";
import { SplitNodeRenderer } from "@/components/split-layout/split-node-renderer";
import { SplitTreeScopeProvider } from "@/components/split-layout/split-tree-scope";
import { TabDragPreview } from "@/components/split-layout/tab-drag-preview";
import { useTabDnd } from "@/components/split-layout/use-tab-dnd";

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_HEIGHT = 120;
const CLOSE_THRESHOLD = 80;
const DEFAULT_HEIGHT = 300;

/** When drag height exceeds this fraction of window height, maximize. */
const MAXIMIZE_THRESHOLD = 0.85;

// ─── Main Component ──────────────────────────────────────────────────────────

interface TerminalPanelLayoutProps {
  children: ReactNode;
}

export function TerminalPanelLayout({ children }: TerminalPanelLayoutProps) {
  const terminalPanel = usePaneLayoutStore((s) => s.terminalPanel);

  const isOpen = terminalPanel?.isOpen ?? false;
  const isMaximized = terminalPanel?.isMaximized ?? false;
  const height = terminalPanel?.height ?? DEFAULT_HEIGHT;
  const terminalRoot = terminalPanel?.root;

  const handleHeightChange = useCallback((newHeight: number) => {
    const maxH = window.innerHeight * MAXIMIZE_THRESHOLD;
    if (newHeight >= maxH) {
      paneLayoutService.maximizeTerminalPanel();
      return;
    }

    // If was maximized and user drags down, restore first
    if (usePaneLayoutStore.getState().terminalPanel?.isMaximized) {
      usePaneLayoutStore.getState()._applySetTerminalPanelMaximized(false);
    }

    usePaneLayoutStore.getState()._applySetTerminalPanelHeight(newHeight);
  }, []);

  const handleDragEnd = useCallback((finalHeight: number) => {
    paneLayoutService.setTerminalPanelHeight(finalHeight);
  }, []);

  const handleClose = useCallback(() => {
    paneLayoutService.toggleTerminalPanel();
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* Content zone - hidden when terminal is maximized */}
      {!isMaximized && (
        <div className="flex-1 min-h-0 flex">{children}</div>
      )}

      {/* Terminal panel */}
      {isOpen && terminalRoot && (
        <TerminalPanelResizable
          height={height}
          isMaximized={isMaximized}
          terminalRoot={terminalRoot}
          onHeightChange={handleHeightChange}
          onDragEnd={handleDragEnd}
          onClose={handleClose}
        />
      )}
    </div>
  );
}

// ─── Resizable Wrapper ──────────────────────────────────────────────────────

interface TerminalPanelResizableProps {
  height: number;
  isMaximized: boolean;
  terminalRoot: SplitNode;
  onHeightChange: (height: number) => void;
  onDragEnd: (height: number) => void;
  onClose: () => void;
}

function TerminalPanelResizable({
  height,
  isMaximized,
  terminalRoot,
  onHeightChange,
  onDragEnd,
  onClose,
}: TerminalPanelResizableProps) {
  // When maximized, fill available space via a large computed height
  const effectiveHeight = isMaximized ? window.innerHeight : height;

  return (
    <ResizablePanelVertical
      height={effectiveHeight}
      onHeightChange={onHeightChange}
      onDragEnd={onDragEnd}
      minHeight={MIN_HEIGHT}
      maxHeight={Math.floor(window.innerHeight * 0.95)}
      closeThreshold={CLOSE_THRESHOLD}
      onClose={onClose}
      className={isMaximized ? "flex-1" : ""}
      fillContainer={isMaximized}
    >
      <TerminalPanelContent terminalRoot={terminalRoot} />
    </ResizablePanelVertical>
  );
}

// ─── Panel Content ───────────────────────────────────────────────────────────

interface TerminalPanelContentProps {
  terminalRoot: SplitNode;
}

/**
 * Wraps the terminal split tree in its own DndContext + SplitNodeRenderer.
 * This gives the terminal panel full drag-and-drop support (reorder, cross-group,
 * edge-zone splitting) while keeping it isolated from the content zone's DndContext.
 */
function TerminalPanelContent({ terminalRoot }: TerminalPanelContentProps) {
  const {
    sensors,
    activeDrag,
    activeEdgeZone,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleEdgeDrop,
  } = useTabDnd({ scope: "terminal" });

  const bridgeValue = useMemo(
    () => ({ activeDrag, activeEdgeZone, onEdgeDrop: handleEdgeDrop }),
    [activeDrag, activeEdgeZone, handleEdgeDrop],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <DndBridgeProvider value={bridgeValue}>
        <SplitTreeScopeProvider value="terminal">
          <SplitNodeRenderer node={terminalRoot} path={[]} />
        </SplitTreeScopeProvider>
      </DndBridgeProvider>
      <DragOverlay>
        {activeDrag ? <TabDragPreview activeDrag={activeDrag} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
