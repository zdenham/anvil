/**
 * SplitNodeRenderer
 *
 * Recursive component that renders a SplitNode tree.
 *
 * Leaf nodes render a PaneGroup with tab bar and content.
 * Split nodes render a flex container with resize handles between children.
 */

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { SplitResizeHandle } from "./split-resize-handle";
import { PaneGroup } from "./pane-group";
import type { SplitNodeRendererProps } from "./types";

export function SplitNodeRenderer({ node, path }: SplitNodeRendererProps) {
  if (node.type === "leaf") {
    return <PaneGroup groupId={node.groupId} />;
  }

  const isHorizontal = node.direction === "horizontal";

  return (
    <div
      data-testid="split-node"
      data-direction={node.direction}
      className={cn(
        "flex w-full h-full",
        isHorizontal ? "flex-row" : "flex-col",
      )}
    >
      {node.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <SplitResizeHandle
              direction={node.direction}
              path={path}
              index={i}
              sizes={node.sizes}
            />
          )}
          <div
            data-testid="split-child"
            style={{ flexBasis: `${node.sizes[i]}%` }}
            className="min-w-0 min-h-0 overflow-hidden flex-shrink-0 flex-grow-0"
          >
            <SplitNodeRenderer node={child} path={[...path, i]} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
