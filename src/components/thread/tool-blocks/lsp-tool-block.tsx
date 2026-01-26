import * as React from "react";
import { formatDuration } from "@/lib/utils/time-format";
import { toRelativePath } from "@/lib/utils/path-display";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useWorkspaceRoot } from "@/hooks/use-workspace-root";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { Code } from "lucide-react";
import type { ToolBlockProps } from "./index";

// LSP input structure (from tool_use block input field)
interface LSPInput {
  operation: string;
  filePath: string;
  line: number;
  character: number;
}

// LSP result structure (parsed from tool_result content string)
interface LSPResult {
  definitions?: Array<LocationResult>;
  references?: Array<LocationResult>;
  hover?: { contents: string | { kind: string; value: string } };
  symbols?: Array<SymbolResult>;
  workspaceSymbols?: Array<WorkspaceSymbolResult>;
  callHierarchyItems?: Array<CallHierarchyItem>;
  incomingCalls?: Array<IncomingCall>;
  outgoingCalls?: Array<OutgoingCall>;
  error?: string;
}

interface LocationResult {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface SymbolResult {
  name: string;
  kind: number;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  children?: SymbolResult[];
}

interface WorkspaceSymbolResult {
  name: string;
  kind: number;
  location: LocationResult;
}

interface CallHierarchyItem {
  name: string;
  kind: number;
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface IncomingCall {
  from: CallHierarchyItem;
  fromRanges: Array<{ start: { line: number; character: number }; end: { line: number; character: number } }>;
}

interface OutgoingCall {
  to: CallHierarchyItem;
  fromRanges: Array<{ start: { line: number; character: number }; end: { line: number; character: number } }>;
}

const LINE_COLLAPSE_THRESHOLD = 10;
const MAX_COLLAPSED_HEIGHT = 300;

const OPERATION_NAMES: Record<string, string> = {
  goToDefinition: "Go to definition",
  findReferences: "Find references",
  hover: "Hover information",
  documentSymbol: "Document symbols",
  workspaceSymbol: "Workspace symbols",
  goToImplementation: "Go to implementation",
  prepareCallHierarchy: "Call hierarchy",
  incomingCalls: "Incoming calls",
  outgoingCalls: "Outgoing calls",
};

const OPERATION_RUNNING_TEXT: Record<string, string> = {
  goToDefinition: "Fetching definition...",
  findReferences: "Finding references...",
  hover: "Fetching hover info...",
  documentSymbol: "Fetching symbols...",
  workspaceSymbol: "Searching symbols...",
  goToImplementation: "Fetching implementation...",
  prepareCallHierarchy: "Preparing call hierarchy...",
  incomingCalls: "Finding callers...",
  outgoingCalls: "Finding callees...",
};

const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package",
  5: "Class", 6: "Method", 7: "Property", 8: "Field",
  9: "Constructor", 10: "Enum", 11: "Interface", 12: "Function",
  13: "Variable", 14: "Constant", 15: "String", 16: "Number",
  17: "Boolean", 18: "Array", 19: "Object", 20: "Key",
  21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter"
};

/**
 * Parse LSP result from JSON string.
 * Returns null if parsing fails or result is undefined.
 */
function parseLSPResult(result: string | undefined): LSPResult | null {
  if (!result) return null;
  try {
    return JSON.parse(result) as LSPResult;
  } catch {
    return null;
  }
}

/**
 * Convert file:// URI to relative path for display.
 */
function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    return uri.slice(7).replace(/^\/([A-Za-z]:)/, "$1"); // Handle Windows paths
  }
  return uri;
}

/**
 * Format location as file:line:character string.
 */
function formatLocation(uri: string, line: number, character: number): string {
  return `${uriToPath(uri)}:${line + 1}:${character + 1}`;
}

/**
 * Get symbol kind display name.
 */
function getSymbolKindName(kind: number): string {
  return SYMBOL_KIND_NAMES[kind] || `Kind ${kind}`;
}

export function LSPToolBlock({
  id,
  name: _name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  isFocused: _isFocused,
  threadId,
}: ToolBlockProps) {
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Get workspace root for relative path display
  const workspaceRoot = useWorkspaceRoot(threadId);

  const lspInput = input as unknown as LSPInput;
  const operation = lspInput.operation || "LSP";
  const filePath = lspInput.filePath || "";
  const displayPath = toRelativePath(filePath, workspaceRoot);
  const line = lspInput.line;
  const character = lspInput.character;

  const isRunning = status === "running";
  const parsed = parseLSPResult(result);

  const operationName = OPERATION_NAMES[operation] || operation;
  const runningText = OPERATION_RUNNING_TEXT[operation] || `${operationName}...`;

  // Format file reference for display (use relative path for display, full path for copy)
  const displayFileRef = line !== undefined && character !== undefined
    ? `${displayPath}:${line}:${character}`
    : displayPath;
  const fullFileRef = line !== undefined && character !== undefined
    ? `${filePath}:${line}:${character}`
    : filePath;

  return (
    <div
      className="group py-0.5"
      aria-label={`LSP ${operationName}: ${displayFileRef}`}
      data-testid={`lsp-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable Header */}
      <div
        className="cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {/* First line: description/operation name with chevron (no icon here) */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate"
          >
            {isRunning ? runningText : operationName}
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          {/* Duration on right */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
          </span>
        </div>

        {/* Second line: command/details with icon (icon goes here, not on first line) */}
        <div className="flex items-center gap-1 mt-0.5">
          <Code className="w-4 h-4 text-zinc-500 shrink-0" />
          <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
            <span className="truncate">{displayFileRef}</span>
          </code>
          <CopyButton text={fullFileRef} label="Copy reference" alwaysVisible className="ml-auto" />
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="relative mt-2 ml-6">
          {isError && parsed?.error ? (
            <div className="text-xs text-red-400">
              {parsed.error}
            </div>
          ) : isError && !parsed ? (
            <div className="text-xs text-red-400">
              {result || "LSP operation failed"}
            </div>
          ) : parsed ? (
            <LSPResultDisplay operation={operation} result={parsed} threadId={threadId} toolId={id} workspaceRoot={workspaceRoot} />
          ) : !isRunning ? (
            <div className="text-xs text-zinc-500">No results</div>
          ) : null}
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? `${operationName} in progress`
          : isError
            ? "LSP operation failed"
            : "LSP operation completed"}
      </span>
    </div>
  );
}

/**
 * Renders the appropriate result display based on operation type.
 */
function LSPResultDisplay({
  operation,
  result,
  threadId,
  toolId,
  workspaceRoot,
}: {
  operation: string;
  result: LSPResult;
  threadId: string;
  toolId: string;
  workspaceRoot: string;
}) {
  switch (operation) {
    case "goToDefinition":
    case "goToTypeDefinition":
    case "goToImplementation":
      return <DefinitionResults definitions={result.definitions || []} workspaceRoot={workspaceRoot} />;

    case "findReferences":
      return <ReferencesResults references={result.references || []} threadId={threadId} toolId={toolId} workspaceRoot={workspaceRoot} />;

    case "hover":
      return <HoverResults hover={result.hover} threadId={threadId} toolId={toolId} />;

    case "documentSymbol":
      return <DocumentSymbolResults symbols={result.symbols || []} />;

    case "workspaceSymbol":
      return <WorkspaceSymbolResults symbols={result.workspaceSymbols || []} workspaceRoot={workspaceRoot} />;

    case "prepareCallHierarchy":
      return <CallHierarchyResults items={result.callHierarchyItems || []} workspaceRoot={workspaceRoot} />;

    case "incomingCalls":
      return <IncomingCallsResults calls={result.incomingCalls || []} workspaceRoot={workspaceRoot} />;

    case "outgoingCalls":
      return <OutgoingCallsResults calls={result.outgoingCalls || []} workspaceRoot={workspaceRoot} />;

    default:
      return <div className="text-xs text-zinc-500">Unknown operation type</div>;
  }
}

/**
 * Renders definition/implementation results.
 */
function DefinitionResults({ definitions, workspaceRoot }: { definitions: LocationResult[]; workspaceRoot: string }) {
  if (definitions.length === 0) {
    return <div className="text-xs text-zinc-500">No definitions found</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">
        Found {definitions.length} definition{definitions.length !== 1 ? "s" : ""}
      </div>
      <div className="space-y-1">
        {definitions.map((def, idx) => {
          const fullPath = uriToPath(def.uri);
          const displayPath = toRelativePath(fullPath, workspaceRoot);
          const fullLocation = formatLocation(def.uri, def.range.start.line, def.range.start.character);
          const displayLocation = `${displayPath}:${def.range.start.line + 1}:${def.range.start.character + 1}`;
          return (
            <div
              key={idx}
              className="flex items-center gap-2 text-xs p-2 rounded border border-zinc-700/50 hover:border-zinc-600/50"
            >
              <code className="font-mono text-zinc-300 flex-1 truncate">
                {displayLocation}
              </code>
              <CopyButton text={fullLocation} label="Copy location" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders find references results with grouping for large result sets.
 */
function ReferencesResults({
  references,
  threadId,
  toolId,
  workspaceRoot,
}: {
  references: LocationResult[];
  threadId: string;
  toolId: string;
  workspaceRoot: string;
}) {
  if (references.length === 0) {
    return <div className="text-xs text-zinc-500">No references found</div>;
  }

  // Group references by file
  const grouped = references.reduce((acc, ref) => {
    const path = uriToPath(ref.uri);
    if (!acc[path]) acc[path] = [];
    acc[path].push(ref);
    return acc;
  }, {} as Record<string, LocationResult[]>);

  const fileCount = Object.keys(grouped).length;
  const isLarge = references.length > LINE_COLLAPSE_THRESHOLD;

  // Use store for output expand state
  const defaultExpanded = !isLarge;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, toolId, defaultExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">
        Found {references.length} reference{references.length !== 1 ? "s" : ""} in {fileCount} file{fileCount !== 1 ? "s" : ""}
      </div>

      <CollapsibleOutputBlock
        isExpanded={isOutputExpanded}
        onToggle={() => setOutputExpanded(threadId, toolId, !isOutputExpanded)}
        isLongContent={isLarge}
        maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
      >
        <div className="p-2 space-y-3">
          {Object.entries(grouped).map(([filePath, refs]) => {
            const displayPath = toRelativePath(filePath, workspaceRoot);
            return (
              <div key={filePath}>
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-xs font-mono text-zinc-400">{displayPath}</code>
                  <span className="text-xs text-zinc-600">({refs.length})</span>
                  <CopyButton text={filePath} label="Copy path" />
                </div>
                <div className="ml-4 text-xs text-zinc-500 font-mono">
                  {refs.map((ref, idx) => (
                    <span key={idx}>
                      :{ref.range.start.line + 1}:{ref.range.start.character + 1}
                      {idx < refs.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleOutputBlock>
    </div>
  );
}

/**
 * Renders hover information.
 */
function HoverResults({
  hover,
  threadId,
  toolId,
}: {
  hover: LSPResult["hover"];
  threadId: string;
  toolId: string;
}) {
  if (!hover) {
    return <div className="text-xs text-zinc-500">No hover information</div>;
  }

  const content = typeof hover.contents === "string"
    ? hover.contents
    : hover.contents.value;

  const lines = content.split("\n").length;
  const isLong = lines > 5;

  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, toolId, !isLong)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);

  return (
    <div className="space-y-2">
      <CollapsibleOutputBlock
        isExpanded={isOutputExpanded}
        onToggle={() => setOutputExpanded(threadId, toolId, !isOutputExpanded)}
        isLongContent={isLong}
        maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
      >
        <div className="relative">
          <div className="absolute top-1 right-1 z-10">
            <CopyButton text={content} label="Copy hover info" />
          </div>
          <pre className="text-xs font-mono p-2 text-zinc-300 whitespace-pre-wrap break-words">
            {content}
          </pre>
        </div>
      </CollapsibleOutputBlock>
    </div>
  );
}

/**
 * Renders document symbols grouped by kind.
 */
function DocumentSymbolResults({ symbols }: { symbols: SymbolResult[] }) {
  if (symbols.length === 0) {
    return <div className="text-xs text-zinc-500">No symbols found</div>;
  }

  // Flatten nested symbols and group by kind
  const flatSymbols: Array<{ name: string; kind: number; line: number }> = [];
  function flatten(syms: SymbolResult[]) {
    for (const sym of syms) {
      flatSymbols.push({ name: sym.name, kind: sym.kind, line: sym.range.start.line + 1 });
      if (sym.children) flatten(sym.children);
    }
  }
  flatten(symbols);

  const grouped = flatSymbols.reduce((acc, sym) => {
    const kindName = getSymbolKindName(sym.kind);
    if (!acc[kindName]) acc[kindName] = [];
    acc[kindName].push(sym);
    return acc;
  }, {} as Record<string, typeof flatSymbols>);

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">
        Found {flatSymbols.length} symbol{flatSymbols.length !== 1 ? "s" : ""}
      </div>
      <div className="space-y-3">
        {Object.entries(grouped).map(([kindName, syms]) => (
          <div key={kindName}>
            <div className="text-xs font-medium text-zinc-500 mb-1">
              {kindName}s ({syms.length})
            </div>
            <div className="ml-2 space-y-0.5">
              {syms.map((sym, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-600">{idx === syms.length - 1 ? "\u2514\u2500" : "\u251c\u2500"}</span>
                  <span className="text-zinc-300 font-mono">{sym.name}</span>
                  <span className="text-zinc-600">:{sym.line}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders workspace symbol search results grouped by file.
 */
function WorkspaceSymbolResults({ symbols, workspaceRoot }: { symbols: WorkspaceSymbolResult[]; workspaceRoot: string }) {
  if (symbols.length === 0) {
    return <div className="text-xs text-zinc-500">No symbols found</div>;
  }

  // Group by file
  const grouped = symbols.reduce((acc, sym) => {
    const path = uriToPath(sym.location.uri);
    if (!acc[path]) acc[path] = [];
    acc[path].push(sym);
    return acc;
  }, {} as Record<string, WorkspaceSymbolResult[]>);

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">
        Found {symbols.length} symbol{symbols.length !== 1 ? "s" : ""}
      </div>
      <div className="space-y-2">
        {Object.entries(grouped).map(([filePath, syms]) => (
          <FileSymbolGroup key={filePath} filePath={filePath} symbols={syms} workspaceRoot={workspaceRoot} />
        ))}
      </div>
    </div>
  );
}

/**
 * Collapsible file group for workspace symbols.
 */
function FileSymbolGroup({
  filePath,
  symbols,
  workspaceRoot,
}: {
  filePath: string;
  symbols: WorkspaceSymbolResult[];
  workspaceRoot: string;
}) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const displayPath = toRelativePath(filePath, workspaceRoot);

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      header={
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="sm" />
          <code className="text-xs font-mono text-zinc-400">{displayPath}</code>
        </div>
      }
    >
      <div className="ml-6 mt-1 space-y-0.5">
        {symbols.map((sym, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <span className="text-zinc-300 font-mono">{sym.name}</span>
            <span className="text-zinc-600">({getSymbolKindName(sym.kind)})</span>
            <span className="text-zinc-600">:{sym.location.range.start.line + 1}</span>
          </div>
        ))}
      </div>
    </CollapsibleBlock>
  );
}

/**
 * Renders call hierarchy items.
 */
function CallHierarchyResults({ items, workspaceRoot }: { items: CallHierarchyItem[]; workspaceRoot: string }) {
  if (items.length === 0) {
    return <div className="text-xs text-zinc-500">No call hierarchy items</div>;
  }

  return (
    <div className="space-y-1">
      {items.map((item, idx) => {
        const fullPath = uriToPath(item.uri);
        const displayPath = toRelativePath(fullPath, workspaceRoot);
        const fullLocation = formatLocation(item.uri, item.range.start.line, item.range.start.character);
        const displayLocation = `${displayPath}:${item.range.start.line + 1}:${item.range.start.character + 1}`;
        return (
          <div
            key={idx}
            className="flex items-center gap-2 text-xs p-2 rounded border border-zinc-700/50"
          >
            <span className="text-zinc-300 font-mono">{item.name}</span>
            <span className="text-zinc-600">({getSymbolKindName(item.kind)})</span>
            <code className="text-zinc-500 font-mono flex-1 truncate">{displayLocation}</code>
            <CopyButton text={fullLocation} label="Copy location" />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Renders incoming calls (callers of this function).
 */
function IncomingCallsResults({ calls, workspaceRoot }: { calls: IncomingCall[]; workspaceRoot: string }) {
  if (calls.length === 0) {
    return <div className="text-xs text-zinc-500">No incoming calls found</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">
        Called by {calls.length} function{calls.length !== 1 ? "s" : ""}
      </div>
      <div className="space-y-1">
        {calls.map((call, idx) => {
          const fullPath = uriToPath(call.from.uri);
          const displayPath = toRelativePath(fullPath, workspaceRoot);
          const fullLocation = formatLocation(call.from.uri, call.from.range.start.line, call.from.range.start.character);
          return (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-600">{idx === calls.length - 1 ? "\u2514\u2500" : "\u251c\u2500"}</span>
              <span className="text-zinc-300 font-mono">{call.from.name}</span>
              <span className="text-zinc-600">({getSymbolKindName(call.from.kind)})</span>
              <code className="text-zinc-500 font-mono truncate">{displayPath}:{call.from.range.start.line + 1}</code>
              <CopyButton text={fullLocation} label="Copy location" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders outgoing calls (functions this function calls).
 */
function OutgoingCallsResults({ calls, workspaceRoot }: { calls: OutgoingCall[]; workspaceRoot: string }) {
  if (calls.length === 0) {
    return <div className="text-xs text-zinc-500">No outgoing calls found</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">
        Calls {calls.length} function{calls.length !== 1 ? "s" : ""}
      </div>
      <div className="space-y-1">
        {calls.map((call, idx) => {
          const fullPath = uriToPath(call.to.uri);
          const displayPath = toRelativePath(fullPath, workspaceRoot);
          const fullLocation = formatLocation(call.to.uri, call.to.range.start.line, call.to.range.start.character);
          return (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-600">{idx === calls.length - 1 ? "\u2514\u2500" : "\u251c\u2500"}</span>
              <span className="text-zinc-300 font-mono">{call.to.name}</span>
              <span className="text-zinc-600">({getSymbolKindName(call.to.kind)})</span>
              <code className="text-zinc-500 font-mono truncate">{displayPath}:{call.to.range.start.line + 1}</code>
              <CopyButton text={fullLocation} label="Copy location" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
