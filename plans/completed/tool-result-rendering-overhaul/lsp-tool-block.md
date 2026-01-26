# LSP Tool Block Implementation Plan

## Overview

The LSP (Language Server Protocol) tool block renders results from language server operations like "Go to definition", "Find references", "Hover information", etc. This implementation follows the BashToolBlock UI conventions established in the tool-result-rendering-overhaul plan.

---

## Anthropic API Data Structures

### Tool Use Block (Input)

The LSP tool receives input via `Anthropic.ToolUseBlock` from the SDK. The `input` field contains the operation parameters:

```typescript
// From @anthropic-ai/sdk/resources/messages
import type { ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";

// The tool_use block structure:
// {
//   type: "tool_use",
//   id: string,         // Unique tool call ID (e.g., "toolu_01abc...")
//   name: "LSP",        // Tool name
//   input: LSPInput     // Operation-specific parameters
// }

interface LSPInput {
  operation: "goToDefinition" | "findReferences" | "hover" | "documentSymbol" |
             "workspaceSymbol" | "goToImplementation" | "prepareCallHierarchy" |
             "incomingCalls" | "outgoingCalls";
  filePath: string;
  line: number;      // 1-based line number
  character: number; // 1-based character offset
}
```

### Tool Result Block (Output)

Results come via `Anthropic.ToolResultBlockParam`. The `content` field contains the result as a JSON string:

```typescript
// From @anthropic-ai/sdk/resources/messages
import type { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";

// The tool_result block structure:
// {
//   type: "tool_result",
//   tool_use_id: string,  // References the tool_use block ID
//   content: string,      // JSON-stringified result
//   is_error?: boolean    // True if operation failed
// }
```

The `content` string (accessed via `result` prop in ToolBlockProps) contains JSON with this structure:

```typescript
interface LSPResult {
  // Go to Definition / Type Definition / Implementation
  definitions?: Array<{
    uri: string;           // File URI (file:///path/to/file.ts)
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }>;

  // Find References
  references?: Array<{
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }>;

  // Hover
  hover?: {
    contents: string | { kind: string; value: string };  // Markdown or plain text
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };

  // Document Symbols
  symbols?: Array<{
    name: string;
    kind: number;          // LSP SymbolKind enum (1=File, 5=Class, 6=Method, 12=Function, etc.)
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    children?: Array<...>; // Nested symbols
  }>;

  // Workspace Symbols
  workspaceSymbols?: Array<{
    name: string;
    kind: number;
    location: {
      uri: string;
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
    };
  }>;

  // Call Hierarchy
  callHierarchyItems?: Array<{
    name: string;
    kind: number;
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }>;

  incomingCalls?: Array<{
    from: {
      name: string;
      kind: number;
      uri: string;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
    };
    fromRanges: Array<{ start: { line: number; character: number }; end: { line: number; character: number } }>;
  }>;

  outgoingCalls?: Array<{
    to: {
      name: string;
      kind: number;
      uri: string;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
    };
    fromRanges: Array<{ start: { line: number; character: number }; end: { line: number; character: number } }>;
  }>;

  // Error case
  error?: string;
}
```

---

## UI Layout

### First Line (Description with Collapse/Expand Control)

**Pattern:** Chevron + Description Text (with shimmer for in-progress)

```
▼ Go to definition                                    1.2s
```

- **Chevron:** `ExpandChevron` component (from `@/components/ui/expand-chevron`) for animated collapse/expand toggle - this is the visual indicator that clicking will expand/collapse the block
- **Text:** Human-readable operation name using `ShimmerText` (from `@/components/ui/shimmer-text`)
  - While running: shimmer animation with text like "Fetching definition..."
  - When complete: static text like "Go to definition"
- **Status:** `StatusIcon` (from `@/components/ui/status-icon`) for error state if `isError=true`
- **Duration:** Display on right side using `formatDuration` utility
- **NO icon on first line** - the chevron serves as the visual indicator for this line

### Second Line (Command/Details with Icon)

**Pattern:** Icon + file:line reference

```
   Code  src/components/App.tsx:42:10              [copy]
```

- **Icon:** `Code` from lucide-react (small, muted: `className="w-4 h-4 text-zinc-500 shrink-0"`) - the icon appears here on the second line, NOT on the first line
- **Content:** File path (extracted from `filePath`) with line and character (e.g., `src/App.tsx:42:10`) in `font-mono text-zinc-500`
- **Copy Button:** `CopyButton` (from `@/components/ui/copy-button`) to copy the `file:line:character` reference
- The second line is indented to align with the first line's text (past the chevron)

### Expanded Content (Results by Operation Type)

The expanded section displays results based on operation type. **All results use formatted displays - never raw JSON.**

---

## Operation Types & Result Formats

### 1. Go to Definition / Go to Type Definition / Go to Implementation

**Operations:** `goToDefinition`, `goToTypeDefinition`, `goToImplementation`

**Expanded Content Display:**
- Summary: "Found 1 definition" or "No definitions found"
- List of definition locations as styled cards:

```
┌─────────────────────────────────────────────────┐
│ src/types/index.ts:15:0                    [📋] │
└─────────────────────────────────────────────────┘
```

Each definition card shows:
- File path with line:character in `font-mono text-zinc-300`
- `CopyButton` for the `file:line` reference
- Cards use `border border-zinc-700/50 hover:border-zinc-600/50` styling

### 2. Find References

**Operation:** `findReferences`

**Expanded Content Display:**
- Summary: "Found 15 references in 8 files" or "No references found"
- If <= 10 references: flat list of reference cards (same style as definitions)
- If > 10 references: use `CollapsibleOutputBlock` (from `@/components/ui/collapsible-output-block`) with grouped display:

```
src/pages/Home.tsx (3 references)
  :8:5, :12:10, :25:3

src/pages/Dashboard.tsx (2 references)
  :12:5, :45:8
```

Group by file, show line:character references inline, with `CopyButton` for each file path.

### 3. Hover Information

**Operation:** `hover`

**Expanded Content Display:**
- If hover content is short (< 5 lines): display directly in a styled block
- If hover content is long: wrap in `CollapsibleOutputBlock` with `isLongContent={true}`

```
┌─────────────────────────────────────────────────┐
│ function App(props: AppProps): JSX.Element     │
│                                                 │
│ A functional component that renders the main   │
│ application UI.                                │
└─────────────────────────────────────────────────┘
```

- Display as formatted text in `font-mono text-zinc-300`
- If content is MarkupContent with `kind: "markdown"`, render with basic markdown formatting
- Include `CopyButton` for the hover text

### 4. Document Symbols

**Operation:** `documentSymbol`

**Expanded Content Display:**
- Summary: "Found 12 symbols"
- Group symbols by kind using human-readable names:

```
Functions (3)
  ├─ App                    :10
  ├─ handleClick            :25
  └─ useCustomHook          :42

Interfaces (2)
  ├─ AppProps               :5
  └─ ButtonProps            :8

Variables (1)
  └─ DEFAULT_CONFIG         :3
```

Map LSP SymbolKind numbers to display names:
```typescript
const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package",
  5: "Class", 6: "Method", 7: "Property", 8: "Field",
  9: "Constructor", 10: "Enum", 11: "Interface", 12: "Function",
  13: "Variable", 14: "Constant", 15: "String", 16: "Number",
  17: "Boolean", 18: "Array", 19: "Object", 20: "Key",
  21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter"
};
```

### 5. Workspace Symbols

**Operation:** `workspaceSymbol`

**Expanded Content Display:**
- Summary: "Found 8 symbols matching 'AppProps'"
- Group by file using `CollapsibleBlock` (from `@/components/ui/collapsible-block`) for each file:

```
▶ src/types/index.ts
    AppProps (Interface) :5
    AppPropsWithChildren (Interface) :15

▶ src/components/App.tsx
    AppProps (TypeAlias) :3
```

Each file group is collapsible. Show symbol name, kind badge, and line number.

### 6. Call Hierarchy (Prepare, Incoming, Outgoing)

**Operations:** `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`

**Expanded Content Display:**

For `prepareCallHierarchy`:
- Show the call hierarchy item: name, kind, file:line

For `incomingCalls` (functions that call this function):
- Summary: "Called by 5 functions"
- List callers with their locations:

```
Called by:
  ├─ handleSubmit (Function)     src/forms.tsx:42
  ├─ processData (Function)      src/utils.ts:15
  └─ MainComponent (Function)    src/App.tsx:28
```

For `outgoingCalls` (functions this function calls):
- Summary: "Calls 3 functions"
- List callees with their locations:

```
Calls:
  ├─ validateInput (Function)    src/validators.ts:10
  ├─ formatOutput (Function)     src/formatters.ts:25
  └─ logResult (Function)        src/logger.ts:5
```

Use tree-style formatting with `├─` and `└─` connectors. Each entry has a `CopyButton` for the file:line reference.

---

## Component Implementation

### File: `src/components/thread/tool-blocks/lsp-tool-block.tsx`

```typescript
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
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

  const lspInput = input as unknown as LSPInput;
  const operation = lspInput.operation || "LSP";
  const filePath = lspInput.filePath || "";
  const line = lspInput.line;
  const character = lspInput.character;

  const isRunning = status === "running";
  const parsed = parseLSPResult(result);

  const operationName = OPERATION_NAMES[operation] || operation;
  const runningText = OPERATION_RUNNING_TEXT[operation] || `${operationName}...`;

  // Format file reference for display
  const fileRef = line !== undefined && character !== undefined
    ? `${filePath}:${line}:${character}`
    : filePath;

  return (
    <div
      className="group py-0.5"
      aria-label={`LSP ${operationName}: ${fileRef}`}
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
        <div className="flex items-center gap-1 mt-0.5 ml-6">
          <Code className="w-4 h-4 text-zinc-500 shrink-0" />
          <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
            <span className="truncate">{fileRef}</span>
          </code>
          <CopyButton text={fileRef} label="Copy reference" alwaysVisible />
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
            <LSPResultDisplay operation={operation} result={parsed} threadId={threadId} toolId={id} />
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
}: {
  operation: string;
  result: LSPResult;
  threadId: string;
  toolId: string;
}) {
  switch (operation) {
    case "goToDefinition":
    case "goToTypeDefinition":
    case "goToImplementation":
      return <DefinitionResults definitions={result.definitions || []} />;

    case "findReferences":
      return <ReferencesResults references={result.references || []} threadId={threadId} toolId={toolId} />;

    case "hover":
      return <HoverResults hover={result.hover} threadId={threadId} toolId={toolId} />;

    case "documentSymbol":
      return <DocumentSymbolResults symbols={result.symbols || []} />;

    case "workspaceSymbol":
      return <WorkspaceSymbolResults symbols={result.workspaceSymbols || []} />;

    case "prepareCallHierarchy":
      return <CallHierarchyResults items={result.callHierarchyItems || []} />;

    case "incomingCalls":
      return <IncomingCallsResults calls={result.incomingCalls || []} />;

    case "outgoingCalls":
      return <OutgoingCallsResults calls={result.outgoingCalls || []} />;

    default:
      return <div className="text-xs text-zinc-500">Unknown operation type</div>;
  }
}

/**
 * Renders definition/implementation results.
 */
function DefinitionResults({ definitions }: { definitions: LocationResult[] }) {
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
          const location = formatLocation(def.uri, def.range.start.line, def.range.start.character);
          return (
            <div
              key={idx}
              className="flex items-center gap-2 text-xs p-2 rounded border border-zinc-700/50 hover:border-zinc-600/50"
            >
              <code className="font-mono text-zinc-300 flex-1 truncate">
                {location}
              </code>
              <CopyButton text={location} label="Copy location" />
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
}: {
  references: LocationResult[];
  threadId: string;
  toolId: string;
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
          {Object.entries(grouped).map(([filePath, refs]) => (
            <div key={filePath}>
              <div className="flex items-center gap-2 mb-1">
                <code className="text-xs font-mono text-zinc-400">{filePath}</code>
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
          ))}
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
                  <span className="text-zinc-600">{idx === syms.length - 1 ? "└─" : "├─"}</span>
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
function WorkspaceSymbolResults({ symbols }: { symbols: WorkspaceSymbolResult[] }) {
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
          <FileSymbolGroup key={filePath} filePath={filePath} symbols={syms} />
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
}: {
  filePath: string;
  symbols: WorkspaceSymbolResult[];
}) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      header={
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="sm" />
          <code className="text-xs font-mono text-zinc-400">{filePath}</code>
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
function CallHierarchyResults({ items }: { items: CallHierarchyItem[] }) {
  if (items.length === 0) {
    return <div className="text-xs text-zinc-500">No call hierarchy items</div>;
  }

  return (
    <div className="space-y-1">
      {items.map((item, idx) => {
        const location = formatLocation(item.uri, item.range.start.line, item.range.start.character);
        return (
          <div
            key={idx}
            className="flex items-center gap-2 text-xs p-2 rounded border border-zinc-700/50"
          >
            <span className="text-zinc-300 font-mono">{item.name}</span>
            <span className="text-zinc-600">({getSymbolKindName(item.kind)})</span>
            <code className="text-zinc-500 font-mono flex-1 truncate">{location}</code>
            <CopyButton text={location} label="Copy location" />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Renders incoming calls (callers of this function).
 */
function IncomingCallsResults({ calls }: { calls: IncomingCall[] }) {
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
          const location = formatLocation(call.from.uri, call.from.range.start.line, call.from.range.start.character);
          return (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-600">{idx === calls.length - 1 ? "└─" : "├─"}</span>
              <span className="text-zinc-300 font-mono">{call.from.name}</span>
              <span className="text-zinc-600">({getSymbolKindName(call.from.kind)})</span>
              <code className="text-zinc-500 font-mono truncate">{uriToPath(call.from.uri)}:{call.from.range.start.line + 1}</code>
              <CopyButton text={location} label="Copy location" />
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
function OutgoingCallsResults({ calls }: { calls: OutgoingCall[] }) {
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
          const location = formatLocation(call.to.uri, call.to.range.start.line, call.to.range.start.character);
          return (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-600">{idx === calls.length - 1 ? "└─" : "├─"}</span>
              <span className="text-zinc-300 font-mono">{call.to.name}</span>
              <span className="text-zinc-600">({getSymbolKindName(call.to.kind)})</span>
              <code className="text-zinc-500 font-mono truncate">{uriToPath(call.to.uri)}:{call.to.range.start.line + 1}</code>
              <CopyButton text={location} label="Copy location" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Need React import for useState in FileSymbolGroup
import * as React from "react";
```

---

## Component API & Props

### Props (from ToolBlockProps in `src/components/thread/tool-blocks/index.ts`)

```typescript
interface ToolBlockProps {
  /** Unique tool use ID (from Anthropic.ToolUseBlock.id) */
  id: string;
  /** Tool name (from Anthropic.ToolUseBlock.name) */
  name: string;
  /** Tool input parameters (from Anthropic.ToolUseBlock.input) */
  input: Record<string, unknown>;
  /** Tool result string (from Anthropic.ToolResultBlockParam.content) */
  result?: string;
  /** Whether result was an error (from Anthropic.ToolResultBlockParam.is_error) */
  isError?: boolean;
  /** Current execution status */
  status: ToolStatus;  // "running" | "complete" | "error" | "pending"
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether this block is focused for keyboard navigation */
  isFocused?: boolean;
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
}
```

---

## Reusable UI Components Used

| Component | Import Path | Usage |
|-----------|-------------|-------|
| `ExpandChevron` | `@/components/ui/expand-chevron` | Animated chevron on first line for collapse/expand toggle |
| `ShimmerText` | `@/components/ui/shimmer-text` | First line description text with loading animation while `status === "running"` |
| `StatusIcon` | `@/components/ui/status-icon` | Error indicator icon (red X) when `isError === true` |
| `CopyButton` | `@/components/ui/copy-button` | Copy-to-clipboard for file:line references, hover content |
| `CollapsibleOutputBlock` | `@/components/ui/collapsible-output-block` | Gradient overlay + expand/collapse for long content (references > 10, long hover text) |
| `CollapsibleBlock` | `@/components/ui/collapsible-block` | Nested collapsible sections for workspace symbols grouped by file |
| `Code` (lucide-react) | `lucide-react` | Icon on second line next to file:line reference |

---

## Integration with Tool Block Registry

In `src/components/thread/tool-blocks/index.ts`:

```typescript
import { LSPToolBlock } from "./lsp-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  lsp: LSPToolBlock,
  // ... other tools
};
```

---

## Styling Conventions

Follow the established patterns from BashToolBlock:

- **Container:** `className="group py-0.5"` for consistent spacing
- **Background:** Zinc/gray tones (no background on container, borders on content cards)
- **Two-line header layout:**
  - **First line:** Chevron + description text (with shimmer animation when running) + duration on right. NO icon on the first line - the chevron serves as the visual indicator.
  - **Second line:** Icon + command/details in monospace font. Indented with `ml-6` to align past the chevron.
- **Text colors:**
  - Primary: `text-zinc-200` or `text-zinc-300` for main content (first line description)
  - Secondary: `text-zinc-400` or `text-zinc-500` for metadata (second line details)
  - Muted: `text-zinc-600` for less important info
  - Error: `text-red-400` for error messages
- **Borders:** `border-zinc-700/50` with hover state `border-zinc-600/50`
- **Cards:** `rounded border border-zinc-700/50 hover:border-zinc-600/50 p-2`
- **Fonts:** `font-mono` for code/paths (second line), regular font for prose (first line description)
- **Icons:** `w-4 h-4 text-zinc-500 shrink-0` for the second line icon (`Code` icon)

---

## Error Handling

1. **Invalid JSON result:** Display raw result text in error style
2. **Operation failure:** Display error message from `result.error` or generic "LSP operation failed"
3. **Empty results:** Show appropriate "No X found" message for each operation type
4. **Malformed input:** Gracefully handle missing `filePath`, `line`, `character` fields

---

## Accessibility

1. **ARIA labels:** `aria-label` on root div with operation and file info
2. **Keyboard navigation:** Tab-accessible expand/collapse, Enter/Space to toggle
3. **Screen reader text:** `sr-only` status announcements ("operation in progress", "completed", "failed")
4. **Data attributes:** `data-testid` and `data-tool-status` for testing
5. **Focus management:** `tabIndex={0}` on clickable header

---

## Testing Notes

- Test with each operation type (definition, references, hover, symbols, call hierarchy)
- Test with empty results (0 matches) for each operation
- Test with large result sets (>10 references, many symbols)
- Test error states (invalid JSON, operation failures)
- Verify `CopyButton` works for all copyable content
- Verify expand/collapse state persists via `useToolExpandStore`
- Test keyboard navigation (Tab, Enter, Space)
- Test with real LSP server output data to validate result parsing
