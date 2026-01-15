# Sub-Plan 07: Permission Input Display Component

## Scope

Create the component that formats and displays tool input in a human-readable way.

## Dependencies

- **None** - This is a pure presentational component with no store dependencies

## Files to Create

### `src/components/permission/permission-input-display.tsx` (~60 lines)

```typescript
import { useMemo } from "react";

interface PermissionInputDisplayProps {
  toolName: string;
  toolInput: Record<string, unknown>;
}

interface FormattedInput {
  primary: string;
  secondary?: string;
  type: "command" | "path" | "json" | "diff";
}

/**
 * Formats tool input for human-readable display.
 * Handles common tool patterns (Bash commands, file paths, etc.)
 */
export function PermissionInputDisplay({ toolName, toolInput }: PermissionInputDisplayProps) {
  const formatted = useMemo((): FormattedInput => {
    // Bash: show command
    if (toolName === "Bash" && typeof toolInput.command === "string") {
      return { primary: toolInput.command, type: "command" };
    }

    // File operations: show path
    if (typeof toolInput.file_path === "string") {
      return { primary: toolInput.file_path, type: "path" };
    }

    // Glob: show pattern
    if (toolName === "Glob" && typeof toolInput.pattern === "string") {
      return { primary: toolInput.pattern, type: "path" };
    }

    // Grep: show pattern and path
    if (toolName === "Grep" && typeof toolInput.pattern === "string") {
      const path = typeof toolInput.path === "string" ? toolInput.path : "";
      return {
        primary: toolInput.pattern,
        secondary: path ? `in ${path}` : undefined,
        type: "command"
      };
    }

    // Edit: show diff-style old_string/new_string
    if (toolName === "Edit" && typeof toolInput.file_path === "string") {
      const filePath = toolInput.file_path;
      const oldStr = typeof toolInput.old_string === "string" ? toolInput.old_string : "";
      const newStr = typeof toolInput.new_string === "string" ? toolInput.new_string : "";

      // Format as unified diff style for readability
      const diffDisplay = [
        `--- ${filePath}`,
        `+++ ${filePath}`,
        ...oldStr.split("\n").map((line: string) => `- ${line}`),
        ...newStr.split("\n").map((line: string) => `+ ${line}`),
      ].join("\n");

      return { primary: diffDisplay, type: "diff" as const };
    }

    // Default: show JSON
    return { primary: JSON.stringify(toolInput, null, 2), type: "json" };
  }, [toolName, toolInput]);

  return (
    <div className="mt-2 rounded bg-surface-800 p-3 font-mono text-sm overflow-x-auto max-h-48 overflow-y-auto">
      {formatted.type === "command" && (
        <div className="text-amber-400">$ {formatted.primary}</div>
      )}
      {formatted.type === "path" && (
        <div className="text-blue-400">{formatted.primary}</div>
      )}
      {formatted.type === "json" && (
        <pre className="whitespace-pre-wrap text-surface-300">
          {formatted.primary}
        </pre>
      )}
      {formatted.type === "diff" && (
        <pre className="whitespace-pre-wrap">
          {formatted.primary.split("\n").map((line, i) => (
            <div
              key={i}
              className={
                line.startsWith("-") ? "text-red-400 bg-red-950/30" :
                line.startsWith("+") ? "text-green-400 bg-green-950/30" :
                "text-surface-400"
              }
            >
              {line}
            </div>
          ))}
        </pre>
      )}
      {formatted.secondary && (
        <div className="text-surface-400 mt-1">{formatted.secondary}</div>
      )}
    </div>
  );
}
```

## Verification

```bash
pnpm tsc --noEmit
```

## Estimated Time

15-20 minutes

## Notes

- Pure component with no side effects
- Handles common tool patterns with specialized formatting
- Falls back to JSON for unknown tools
- Constrained height with scrolling for long inputs
