# Zod at Boundaries

Use Zod schemas for runtime validation only where data crosses trust boundaries. Use plain TypeScript types for internal code structure.

## Why This Matters

Runtime validation has real costs:

1. **Bundle size** - Zod adds ~12-15kb minified
2. **Runtime overhead** - Validation isn't free, especially on hot paths
3. **Verbosity** - Simple types become more complex to define
4. **False confidence** - Validating internal types implies they could be wrong (they can't)

But at trust boundaries, these costs are worth it. Data from disk, network, or IPC can be malformed, corrupted, or unexpected. Runtime validation catches these errors with clear messages instead of cryptic failures deep in your code.

## The Rule

**Use Zod when data originates outside your TypeScript compilation unit.**

This means:
- Files on disk (JSON, config files, persisted state)
- Network responses (APIs, webhooks)
- IPC messages (Tauri commands, child process output)
- User input (forms, CLI args)
- Environment variables

**Use plain TypeScript when the type describes code structure:**

This means:
- Interfaces with methods (adapters, services)
- Callback/function signatures
- React component props
- Internal function return types
- Simple type aliases

## The Heuristic

Ask: "Can this data be wrong at runtime due to external factors?"

- **Yes** → Use Zod
- **No** → Use TypeScript

If TypeScript already guarantees correctness at compile time, runtime validation is redundant.

## Do

```typescript
// Persisted state loaded from disk - use Zod
const TaskMetadataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  status: z.enum(["draft", "backlog", "todo", "in-progress", "done"]),
  createdAt: z.number(),
});
type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

// Loading from disk - validate
const raw = await fs.readFile(metadataPath, "utf-8");
const metadata = TaskMetadataSchema.parse(JSON.parse(raw));
```

```typescript
// Config from JSON file - use Zod
const RepositorySettingsSchema = z.object({
  schemaVersion: z.number(),
  name: z.string(),
  sourcePath: z.string(),
  defaultBranch: z.string(),
});
type RepositorySettings = z.infer<typeof RepositorySettingsSchema>;
```

```typescript
// IPC from child process - use Zod
const AgentEventSchema = z.object({
  type: z.literal("event"),
  name: z.string(),
  payload: z.unknown(),
});
```

## Don't

```typescript
// BAD: Adapter interfaces can't be validated at runtime
const FileSystemAdapterSchema = z.object({
  readFile: z.function(),  // This doesn't validate anything useful
  writeFile: z.function(),
});

// GOOD: Use plain TypeScript interface
interface FileSystemAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}
```

```typescript
// BAD: Component props are compile-time only
const DiffViewerPropsSchema = z.object({
  fileChanges: z.array(FileChangeSchema),
  workingDirectory: z.string(),
});

// GOOD: Plain interface, TypeScript handles this
interface DiffViewerProps {
  fileChanges: FileChange[];
  workingDirectory: string;
}
```

```typescript
// BAD: Simple type aliases gain nothing from Zod
const TaskIdSchema = z.string();
type TaskId = z.infer<typeof TaskIdSchema>;  // Just... string

// GOOD: Plain type alias
type TaskId = string;
```

```typescript
// BAD: Callback types can't be runtime validated
const AgentStreamCallbacksSchema = z.object({
  onState: z.function().optional(),
  onComplete: z.function().optional(),
});

// GOOD: Plain interface
interface AgentStreamCallbacks {
  onState?: (state: ThreadState) => void;
  onComplete?: () => void;
}
```

## Naming Convention

When using Zod, define the schema first with a `Schema` suffix, then infer the type:

```typescript
// Schema is the source of truth
const TaskMetadataSchema = z.object({ ... });

// Type is derived
type TaskMetadata = z.infer<typeof TaskMetadataSchema>;
```

This makes it clear which types have runtime validation available.

## Where to Put Schemas

Schemas live alongside their types:

- `core/types/tasks.ts` - TaskMetadataSchema, TaskSchema
- `src/entities/repositories/types.ts` - RepositorySettingsSchema
- `src/entities/threads/types.ts` - ThreadMetadataSchema

When a type needs validation, add the schema to the same file and change the type to `z.infer<>`.

## Summary

| Data Source | Use Zod? | Why |
|-------------|----------|-----|
| JSON files on disk | Yes | Can be corrupted, wrong version, manually edited |
| API responses | Yes | External system, schema can drift |
| IPC messages | Yes | Serialization boundaries, version mismatches |
| User input | Yes | Users make mistakes |
| Function parameters | No | TypeScript validates at compile time |
| Component props | No | Internal code, already type-checked |
| Adapter interfaces | No | Describes code structure, not data |
| Type aliases | No | No structure to validate |

## Related

- [agents.md](../agents.md) - TypeScript rules and general practices
- [disk-as-truth.md](./disk-as-truth.md) - Pattern for reading/writing persisted state
