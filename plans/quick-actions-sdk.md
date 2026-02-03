# Quick Actions SDK Implementation Plan

## Overview

Transform the hardcoded quick actions system into a user-extensible SDK that allows end users to write custom TypeScript quick actions with access to Mort internals.

### Goals
1. Users can write TypeScript functions that execute as quick actions
2. Quick actions receive context (thread/plan info, state) and SDK services
3. User-defined quick actions are configurable via UI with hotkeys (Cmd+0-9)
4. Quick actions navigate horizontally (left/right arrows) instead of vertically
5. Actions have context awareness (show in "plan", "thread", or "empty" contexts)

---

## Architecture Overview

### Project-Based Quick Actions

Quick actions are organized into **user-managed projects** rather than individual scripts. Each project:
- Is a standalone directory with its own `package.json` and build configuration
- Can contain multiple quick actions
- Builds itself to vanilla JavaScript (no tsx runtime dependency)
- Exports a manifest of available actions

This approach gives users full control over their toolchain while keeping Mort's runtime simple.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri Frontend                            │
├──────────────────────────────────────────────────────────────────┤
│  Quick Actions UI (horizontal navigation, hotkey registration)   │
│                              │                                   │
│                              ▼                                   │
│  Quick Action Entity & Service (load/save/order)                 │
│                              │                                   │
│                              ▼                                   │
│  Quick Action Executor (spawn Node process on built JS)          │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Node.js Runtime (vanilla JS)                  │
├──────────────────────────────────────────────────────────────────┤
│  User's Pre-built Quick Action (dist/actions/*.js)               │
│  - Receives: QuickActionContext, MortSDK                         │
│  - Can call SDK methods (git, threads, plans, input)             │
│  - Returns: void or result object                                │
│                              │                                   │
│                              ▼                                   │
│  MortSDK (bundled with user's project or injected at runtime)    │
│  - GitService (via shell commands)                               │
│  - ThreadService (via filesystem)                                │
│  - PlanService (via filesystem)                                  │
│  - InputService (via stdout events → Tauri)                      │
└──────────────────────────────────────────────────────────────────┘
```

### Default Quick Actions Project Structure

Mort initializes a single default project at `~/.mort/quick-actions/` on first launch:

```
~/.mort/quick-actions/                 # Default project (auto-initialized)
├── package.json                       # Pre-configured, ready to use
├── tsconfig.json                      # TypeScript config with SDK paths
├── build.ts                           # Build script that generates manifest
├── src/
│   └── actions/
│       ├── example.ts                 # Example action (ships with template)
│       ├── archive-and-next.ts        # User adds actions here
│       └── start-fresh.ts
├── dist/                              # Build output (created after npm run build)
│   ├── manifest.json                  # Generated manifest of actions
│   └── actions/
│       ├── example.js
│       ├── archive-and-next.js
│       └── start-fresh.js
├── node_modules/
│   └── @mort/sdk/                     # SDK types (copied during init)
└── README.md                          # Documentation for writing actions
```

### Registration Flow

Mort ships with a **default quick actions project** at `~/.mort/quick-actions/`. On first launch:

1. Mort initializes the default project structure (if it doesn't exist)
2. User adds new `.ts` files to `~/.mort/quick-actions/src/actions/`
3. User runs `npm run build` (or Mort offers a "Rebuild" button in settings)
4. Mort reads the updated `dist/manifest.json` and shows new actions
5. When executed, Mort runs the pre-built JS files with Node.js

This "batteries included" approach means users can start writing actions immediately without any project setup. Advanced users can still register additional external projects if needed.

### Why This Approach?

| Aspect | Project-Based (New) | Single Script (Previous) |
|--------|---------------------|--------------------------|
| **Build toolchain** | User's choice (esbuild, tsc, etc.) | Mort must bundle tsx |
| **Runtime dependency** | Just Node.js | Node.js + tsx |
| **Startup latency** | Fast (pre-built JS) | Slower (JIT transpilation) |
| **npm packages** | Full support (bundled) | Limited |
| **Maintainability** | User manages their project | Mort manages individual scripts |
| **Portability** | Can share entire project | Must share individual files |
| **Type safety** | Full (at build time) | Runtime only |

---

## Phase 1: Quick Action Entity & Storage

### 1.1 Types Definition

**File: `core/types/quick-actions.ts`**

```typescript
import { z } from 'zod';

// Context where a quick action is available
export const QuickActionContextSchema = z.enum([
  'thread',    // Active thread view
  'plan',      // Active plan view
  'empty',     // No active thread/plan (fresh prompt)
  'all',       // Available in all contexts
]);
export type QuickActionContext = z.infer<typeof QuickActionContextSchema>;

// Quick action metadata stored on disk
export const QuickActionMetadataSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  scriptPath: z.string(),              // Absolute path to .ts file
  contexts: z.array(QuickActionContextSchema),
  hotkey: z.number().min(0).max(9).optional(), // 0-9 for Cmd+0 to Cmd+9
  order: z.number().default(0),        // For manual ordering
  enabled: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type QuickActionMetadata = z.infer<typeof QuickActionMetadataSchema>;

// Input for creating a quick action
export interface CreateQuickActionInput {
  title: string;
  description?: string;
  scriptPath: string;
  contexts: QuickActionContext[];
  hotkey?: number;
}

// Input for updating a quick action
export interface UpdateQuickActionInput {
  title?: string;
  description?: string;
  scriptPath?: string;
  contexts?: QuickActionContext[];
  hotkey?: number;
  order?: number;
  enabled?: boolean;
}
```

### 1.2 Storage Structure

The default quick actions project lives directly at `~/.mort/quick-actions/`:

```
~/.mort/
├── quick-actions/                   # Default project (auto-initialized)
│   ├── package.json
│   ├── tsconfig.json
│   ├── build.ts
│   ├── src/
│   │   └── actions/
│   │       ├── example.ts           # Ships with template
│   │       └── my-action.ts         # User adds actions here
│   ├── dist/
│   │   ├── manifest.json            # Build output: action metadata
│   │   └── actions/
│   │       ├── example.js
│   │       └── my-action.js
│   └── node_modules/@mort/sdk/      # SDK types
└── quick-actions-registry.json      # User overrides (hotkeys, order)
```

### 1.3 Project Manifest Format

Each project must output a `dist/manifest.json` describing its actions:

```typescript
// Generated by build script, lives at dist/manifest.json
interface QuickActionManifest {
  version: 1;
  sdkVersion: string;        // SDK version used to build, e.g. "1.0.0"
  actions: Array<{
    slug: string;            // Human-readable identifier within project, e.g. "archive-and-next"
    title: string;           // Display name
    description?: string;
    entryPoint: string;      // Relative path to JS file, e.g. "actions/archive-and-next.js"
    contexts: ('thread' | 'plan' | 'empty' | 'all')[];
  }>;
}
```

Note: The `slug` is a human-readable identifier used in the manifest. When Mort registers the action, it assigns a UUID as the internal `id`. This allows display names and slugs to conflict across projects while maintaining unique identification.

### 1.4 Registry Format

The registry tracks user overrides for the default project:

```typescript
import { z } from 'zod';

// Zod schema for disk validation
export const QuickActionsRegistrySchema = z.object({
  // User overrides for individual actions
  // Key is the action's UUID (assigned by Mort on registration)
  actionOverrides: z.record(z.string(), z.object({
    hotkey: z.number().min(0).max(9).optional(),
    customOrder: z.number().optional(),
    enabled: z.boolean().optional(),
  })),
});

export type QuickActionsRegistry = z.infer<typeof QuickActionsRegistrySchema>;
```

**Ordering logic:**
1. Actions with `customOrder` set are sorted by that value first
2. Actions without `customOrder` are sorted lexicographically by title
3. This allows users to pin specific actions to the front while new actions auto-sort

### 1.5 Quick Action Store

**File: `src/entities/quick-actions/store.ts`**

```typescript
import { create } from 'zustand';
import type { QuickActionMetadata } from '@core/types/quick-actions.js';

interface QuickActionsState {
  actions: Record<string, QuickActionMetadata>;  // Keyed by ID for O(1) lookups
  _hydrated: boolean;

  // Selectors
  getAction: (id: string) => QuickActionMetadata | undefined;
  getByHotkey: (hotkey: number) => QuickActionMetadata | undefined;
  getForContext: (context: 'thread' | 'plan' | 'empty') => QuickActionMetadata[];
  getAll: () => QuickActionMetadata[];

  // Mutations (called by service)
  hydrate: (actions: Record<string, QuickActionMetadata>) => void;
  _applyCreate: (action: QuickActionMetadata) => void;
  _applyUpdate: (id: string, action: QuickActionMetadata) => void;
  _applyDelete: (id: string) => void;
  _applyReorder: (orderedIds: string[]) => void;
}

export const useQuickActionsStore = create<QuickActionsState>((set, get) => ({
  actions: {},
  _hydrated: false,

  getAction: (id) => get().actions[id],
  getByHotkey: (hotkey) => Object.values(get().actions).find(a => a.hotkey === hotkey && a.enabled),
  getForContext: (context) => Object.values(get().actions)
    .filter(a => a.enabled && (a.contexts.includes(context) || a.contexts.includes('all')))
    .sort((a, b) => a.order - b.order),
  getAll: () => Object.values(get().actions).sort((a, b) => a.order - b.order),

  hydrate: (actions) => set({ actions, _hydrated: true }),
  _applyCreate: (action) => set((s) => ({ actions: { ...s.actions, [action.id]: action } })),
  _applyUpdate: (id, action) => set((s) => ({ actions: { ...s.actions, [id]: action } })),
  _applyDelete: (id) => set((s) => {
    const { [id]: _, ...rest } = s.actions;
    return { actions: rest };
  }),
  _applyReorder: (orderedIds) => set((s) => {
    const updated = { ...s.actions };
    orderedIds.forEach((id, index) => {
      if (updated[id]) updated[id] = { ...updated[id], order: index };
    });
    return { actions: updated };
  }),
}));
```

### 1.6 Quick Action Listeners

**File: `src/entities/quick-actions/listeners.ts`**

```typescript
import { eventBus } from '@/entities/events';
import { quickActionService } from './service';

export function setupQuickActionListeners(): void {
  // When registry changes on disk, refresh from disk
  eventBus.on('quick-actions:registry-changed', async () => {
    await quickActionService.hydrate();
  });

  // When manifest is rebuilt, refresh from disk
  eventBus.on('quick-actions:manifest-changed', async () => {
    await quickActionService.hydrate();
  });
}
```

### 1.6 Quick Action Service

**File: `src/entities/quick-actions/service.ts`**

```typescript
export const quickActionService = {
  async hydrate(): Promise<void>;
  get(id: string): QuickActionMetadata | undefined;
  getAll(): QuickActionMetadata[];
  getForContext(context: QuickActionContext): QuickActionMetadata[];
  getByHotkey(hotkey: number): QuickActionMetadata | undefined;
  async create(input: CreateQuickActionInput): Promise<QuickActionMetadata>;
  async update(id: string, input: UpdateQuickActionInput): Promise<QuickActionMetadata>;
  async delete(id: string): Promise<void>;
  async reorder(orderedIds: string[]): Promise<void>;
  async execute(id: string, context: QuickActionExecutionContext): Promise<QuickActionResult>;
};
```

---

## Phase 2: SDK Type Definitions (User-Facing)

### 2.1 SDK Types Package

Create types that users import when writing quick actions.

**File: `core/sdk/types.ts`**

```typescript
// ═══════════════════════════════════════════════════════════════════
// Context passed to quick action scripts
// ═══════════════════════════════════════════════════════════════════

// Note: Named "ExecutionContext" to avoid collision with QuickActionContext enum in core/types/quick-actions.ts
export interface QuickActionExecutionContext {
  /** The context type where this action was invoked */
  contextType: 'thread' | 'plan' | 'empty';

  /** Current thread ID (if in thread context) */
  threadId?: string;

  /** Current plan ID (if in plan context) */
  planId?: string;

  /** Active repository info */
  repository: {
    id: string;
    name: string;
    path: string;
  } | null;

  /** Active worktree info */
  worktree: {
    id: string;
    path: string;
    branch: string | null;
  } | null;

  /** Current thread state (if thread context) */
  threadState?: {
    status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
    messageCount: number;
    fileChanges: Array<{ path: string; operation: string }>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// SDK Services available to quick actions
// ═══════════════════════════════════════════════════════════════════

export interface MortSDK {
  /** Git operations */
  git: GitService;

  /** Thread operations */
  threads: ThreadService;

  /** Plan operations */
  plans: PlanService;

  /** UI control */
  ui: UIService;

  /** Logging */
  log: LogService;
}

export interface GitService {
  /** Get current branch */
  getCurrentBranch(worktreePath: string): Promise<string | null>;

  /** Get default branch (main/master) */
  getDefaultBranch(repoPath: string): Promise<string>;

  /** Get HEAD commit */
  getHeadCommit(repoPath: string): Promise<string>;

  /** Check if branch exists */
  branchExists(repoPath: string, branch: string): Promise<boolean>;

  /** List all branches */
  listBranches(repoPath: string): Promise<string[]>;

  /** Get diff from base commit */
  getDiff(repoPath: string, baseCommit: string): Promise<string>;
}

export interface ThreadService {
  /** Get thread metadata */
  get(threadId: string): Promise<ThreadInfo | null>;

  /** List all threads */
  list(): Promise<ThreadInfo[]>;

  /** Get threads for repository */
  getByRepo(repoId: string): Promise<ThreadInfo[]>;

  /** Get unread threads */
  getUnread(): Promise<ThreadInfo[]>;

  /** Archive a thread */
  archive(threadId: string): Promise<void>;

  /** Mark thread as read/unread */
  markRead(threadId: string): Promise<void>;
  markUnread(threadId: string): Promise<void>;
}

export interface ThreadInfo {
  id: string;
  repoId: string;
  worktreeId: string;
  status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  isRead: boolean;
  turnCount: number;
}

export interface PlanService {
  /** Get plan metadata */
  get(planId: string): Promise<PlanInfo | null>;

  /** List all plans */
  list(): Promise<PlanInfo[]>;

  /** Get plans for repository */
  getByRepo(repoId: string): Promise<PlanInfo[]>;

  /** Read plan content (markdown) */
  readContent(planId: string): Promise<string>;

  /** Archive a plan */
  archive(planId: string): Promise<void>;
}

export interface PlanInfo {
  id: string;
  repoId: string;
  worktreeId: string;
  relativePath: string;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UIService {
  /** Set the content of the input field */
  setInputContent(content: string): Promise<void>;

  /** Append content to the input field */
  appendInputContent(content: string): Promise<void>;

  /** Clear the input field */
  clearInput(): Promise<void>;

  /** Focus the input field */
  focusInput(): Promise<void>;

  /** Navigate to a thread */
  navigateToThread(threadId: string): Promise<void>;

  /** Navigate to a plan */
  navigateToPlan(planId: string): Promise<void>;

  /**
   * Navigate to next unread item.
   * If no unread items exist, navigates to empty state (closes current view).
   */
  navigateToNextUnread(): Promise<void>;

  /** Show a toast notification */
  showToast(message: string, type?: 'info' | 'success' | 'error'): Promise<void>;

  /** Close current panel (navigate to empty state) */
  closePanel(): Promise<void>;
}

export interface LogService {
  /** Log info message */
  info(message: string, data?: Record<string, unknown>): void;

  /** Log warning */
  warn(message: string, data?: Record<string, unknown>): void;

  /** Log error */
  error(message: string, data?: Record<string, unknown>): void;

  /** Log debug (only in dev) */
  debug(message: string, data?: Record<string, unknown>): void;
}

// ═══════════════════════════════════════════════════════════════════
// Quick Action Definition
// ═══════════════════════════════════════════════════════════════════

export type QuickActionFn = (
  context: QuickActionExecutionContext,
  sdk: MortSDK
) => Promise<void> | void;

export interface QuickActionDefinition {
  /** Unique ID within the project */
  id: string;

  /** Display title */
  title: string;

  /** Optional description */
  description?: string;

  /** Contexts where this action is available */
  contexts: ('thread' | 'plan' | 'empty' | 'all')[];

  /** The action implementation */
  execute: QuickActionFn;
}

/** Helper to define a quick action with type safety */
export function defineAction(def: QuickActionDefinition): QuickActionDefinition {
  return def;
}
```

### 2.2 Default Project Template

The default project at `~/.mort/quick-actions/` ships with these files:

#### package.json
```json
{
  "name": "mort-quick-actions",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsx build.ts",
    "watch": "tsx build.ts --watch"
  },
  "dependencies": {
    "@mort/sdk": "^1.0.0"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

#### src/actions/archive-and-next.ts
```typescript
import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'archive-and-next',
  title: 'Archive & Next',
  description: 'Archive current item and go to next unread',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.archive(context.threadId);
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.archive(context.planId);
    }

    await sdk.ui.navigateToNextUnread();
    sdk.log.info('Archived and navigated to next unread');
  },
});
```

#### build.ts (example build script)
```typescript
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const actionsDir = './src/actions';
const outDir = './dist';

// Build all action files
const actionFiles = fs.readdirSync(actionsDir).filter(f => f.endsWith('.ts'));

for (const file of actionFiles) {
  await esbuild.build({
    entryPoints: [path.join(actionsDir, file)],
    outdir: path.join(outDir, 'actions'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['@mort/sdk'],  // SDK injected at runtime
  });
}

// Generate manifest by importing built files
const manifest = {
  version: 1,
  actions: [],
};

for (const file of actionFiles) {
  const jsFile = file.replace('.ts', '.js');
  const module = await import(path.join(outDir, 'actions', jsFile));
  const action = module.default;

  manifest.actions.push({
    id: action.id,
    title: action.title,
    description: action.description,
    entryPoint: `actions/${jsFile}`,
    contexts: action.contexts,
  });
}

fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log(`Built ${manifest.actions.length} actions`);
```

---

## Phase 3: SDK Runtime Implementation

### 3.1 Node-Side SDK Implementation

**File: `core/sdk/index.ts`**

The SDK implementation that runs in the Node.js process when a quick action executes. It reads directly from the `.mort` directory using the same storage format as Mort's frontend, enabling code reuse via shared transformers.

```typescript
import type { FileSystemAdapter } from '../adapters/fs-adapter.js';
import type { GitAdapter } from '../adapters/git-adapter.js';
import type { MortSDK, QuickActionExecutionContext } from './types.js';
// Shared transformers used by both frontend and SDK
import { threadFromDisk, planFromDisk } from '../transformers/index.js';

// Adapters are injected for testability (following the adapters pattern)
export function createSDK(
  mortDir: string,
  fs: FileSystemAdapter,
  git: GitAdapter,
  emitEvent: (event: string, payload: unknown) => void
): MortSDK {
  return {
    git: createGitService(git),
    // Thread/Plan services read directly from ~/.mort using shared transformers
    threads: createThreadService(mortDir, fs, threadFromDisk),
    plans: createPlanService(mortDir, fs, planFromDisk),
    ui: createUIService(emitEvent),
    log: createLogService(emitEvent),  // Routes to main Mort logger
  };
}
```

The `threadFromDisk` and `planFromDisk` transformers are shared with the frontend adapters, ensuring consistent data parsing across the codebase.

### 3.2 Quick Action Executor (Tauri Side)

**File: `src/lib/quick-action-executor.ts`**

```typescript
import { Command, Child } from '@tauri-apps/plugin-shell';
import { z } from 'zod';
import type { ResolvedQuickAction } from '@core/types/quick-actions.js';
import { threadService } from '@/entities/threads/service';
import { planService } from '@/entities/plans/service';
import { treeMenuService } from '@/stores/tree-menu/service';
import path from 'path';

const ACTION_TIMEOUT_MS = 30_000; // 30 seconds

export interface QuickActionExecutionContext {
  contextType: 'thread' | 'plan' | 'empty';
  threadId?: string;
  planId?: string;
  repoId?: string;
  worktreeId?: string;
}

export interface QuickActionResult {
  success: boolean;
  error?: { message: string; stack?: string };
  timedOut?: boolean;
}

// Zod schema for SDK events (trust boundary - IPC from child process)
const SDKEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('ui:setInput'),
    payload: z.string(),
  }),
  z.object({
    event: z.literal('ui:appendInput'),
    payload: z.string(),
  }),
  z.object({
    event: z.literal('ui:clearInput'),
    payload: z.undefined().optional(),
  }),
  z.object({
    event: z.literal('ui:focusInput'),
    payload: z.undefined().optional(),
  }),
  z.object({
    event: z.literal('ui:navigate'),
    payload: z.object({
      type: z.enum(['thread', 'plan', 'nextUnread', 'empty']),
      id: z.string().optional(),
    }),
  }),
  z.object({
    event: z.literal('ui:toast'),
    payload: z.object({
      message: z.string(),
      type: z.enum(['info', 'success', 'error']).optional(),
    }),
  }),
  z.object({
    event: z.literal('ui:closePanel'),
    payload: z.undefined().optional(),
  }),
  z.object({
    event: z.literal('thread:archive'),
    payload: z.object({ threadId: z.string() }),
  }),
  z.object({
    event: z.literal('thread:markRead'),
    payload: z.object({ threadId: z.string() }),
  }),
  z.object({
    event: z.literal('thread:markUnread'),
    payload: z.object({ threadId: z.string() }),
  }),
  z.object({
    event: z.literal('plan:archive'),
    payload: z.object({ planId: z.string() }),
  }),
  z.object({
    event: z.literal('log'),
    payload: z.object({
      level: z.enum(['info', 'warn', 'error', 'debug']),
      message: z.string(),
      data: z.record(z.unknown()).optional(),
    }),
  }),
  z.object({
    event: z.literal('error'),
    payload: z.string(),
  }),
]);

type SDKEvent = z.infer<typeof SDKEventSchema>;

export async function executeQuickAction(
  action: ResolvedQuickAction,
  execContext: QuickActionExecutionContext
): Promise<QuickActionResult> {
  // Build context object
  const context = buildContext(execContext);

  // Resolve path to the built JS file
  const actionJsPath = path.join(action.projectPath, 'dist', action.entryPoint);

  // Spawn Node process (not tsx - running pre-built JS)
  const runnerPath = await resolveQuickActionRunner();
  const command = Command.create('node', [
    runnerPath,
    '--action', actionJsPath,
    '--context', JSON.stringify(context),
    '--mort-dir', mortDir,
  ]);

  let child: Child;
  let errorOutput = '';

  // Handle stdout events from SDK (same pattern as agent runner)
  command.stdout.on('data', (line) => {
    try {
      const parsed = JSON.parse(line);
      const result = SDKEventSchema.safeParse(parsed);
      if (result.success) {
        handleSDKEvent(result.data);
      }
    } catch {
      // Not JSON, ignore (could be console.log from user action)
    }
  });

  // Capture stderr for error reporting
  command.stderr.on('data', (line) => {
    errorOutput += line + '\n';
  });

  // Execute with timeout
  const executionPromise = new Promise<QuickActionResult>((resolve) => {
    command.on('close', (data) => {
      if (data.code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: { message: errorOutput || 'Action failed', stack: errorOutput },
        });
      }
    });

    command.on('error', (err) => {
      resolve({
        success: false,
        error: { message: err.message, stack: err.stack },
      });
    });
  });

  const timeoutPromise = new Promise<QuickActionResult>((resolve) => {
    setTimeout(() => {
      resolve({ success: false, timedOut: true, error: { message: 'Action timed out after 30 seconds' } });
    }, ACTION_TIMEOUT_MS);
  });

  child = await command.spawn();

  const result = await Promise.race([executionPromise, timeoutPromise]);

  // Kill process if it timed out
  if (result.timedOut) {
    await child.kill();
  }

  return result;
}

// SDK events are handled by calling entity services (which write to disk)
// This follows the disk-as-truth pattern - services write to disk, then
// emit events through the event-bridge for cross-window broadcast
async function handleSDKEvent(event: SDKEvent): Promise<void> {
  switch (event.event) {
    // Entity operations - call services (writes to disk, emits through event-bridge)
    case 'thread:archive':
      await threadService.archive(event.payload.threadId);
      break;
    case 'thread:markRead':
      await threadService.markRead(event.payload.threadId);
      break;
    case 'thread:markUnread':
      await threadService.markUnread(event.payload.threadId);
      break;
    case 'plan:archive':
      await planService.archive(event.payload.planId);
      break;

    // UI operations - handled locally (no disk persistence needed)
    case 'ui:setInput':
      useInputStore.getState().setContent(event.payload);
      break;
    case 'ui:appendInput':
      useInputStore.getState().appendContent(event.payload);
      break;
    case 'ui:clearInput':
      useInputStore.getState().clearContent();
      break;
    case 'ui:focusInput':
      useInputStore.getState().requestFocus();
      break;
    case 'ui:navigate':
      await handleNavigation(event.payload);
      break;
    case 'ui:toast':
      toast[event.payload.type ?? 'info'](event.payload.message);
      break;
    case 'ui:closePanel':
      await treeMenuService.setSelectedItem(null);
      break;

    // Logging - route to main logger
    case 'log':
      logger[event.payload.level](event.payload.message, event.payload.data);
      break;
  }
}

async function handleNavigation(payload: { type: string; id?: string }): Promise<void> {
  switch (payload.type) {
    case 'thread':
      if (payload.id) await treeMenuService.setSelectedItem(payload.id);
      break;
    case 'plan':
      if (payload.id) await treeMenuService.setSelectedItem(payload.id);
      break;
    case 'nextUnread':
      const nextItem = await findNextUnreadItem();
      if (nextItem) {
        await treeMenuService.setSelectedItem(nextItem.id);
      } else {
        await treeMenuService.setSelectedItem(null); // Navigate to empty state
      }
      break;
    case 'empty':
      await treeMenuService.setSelectedItem(null);
      break;
  }
}
```

### 3.3 Quick Action Runner (Node Entry Point)

**File: `core/sdk/runner.ts`**

This is a lightweight runner that Mort invokes to execute pre-built JS actions. It:
1. Receives the path to the built JS file
2. Creates the SDK instance with injected adapters
3. Validates the context using Zod
4. Imports and executes the action

```typescript
#!/usr/bin/env node
import { parseArgs } from 'util';
import { z } from 'zod';
import { createSDK } from './index.js';
import { NodeFSAdapter } from '../adapters/node/fs-adapter.js';
import { NodeGitAdapter } from '../adapters/node/git-adapter.js';

// Zod schema for CLI context validation (trust boundary)
const QuickActionExecutionContextSchema = z.object({
  contextType: z.enum(['thread', 'plan', 'empty']),
  threadId: z.string().optional(),
  planId: z.string().optional(),
  repository: z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
  }).nullable(),
  worktree: z.object({
    id: z.string(),
    path: z.string(),
    branch: z.string().nullable(),
  }).nullable(),
  threadState: z.object({
    status: z.enum(['idle', 'running', 'completed', 'error', 'cancelled']),
    messageCount: z.number(),
    fileChanges: z.array(z.object({
      path: z.string(),
      operation: z.string(),
    })),
  }).optional(),
});

const { values } = parseArgs({
  options: {
    action: { type: 'string' },    // Path to built JS file
    context: { type: 'string' },   // JSON context
  },
});

async function main() {
  const actionPath = values.action!;

  // Validate context from CLI args (trust boundary - requires Zod validation)
  const context = QuickActionExecutionContextSchema.parse(JSON.parse(values.context!));

  // Create adapters (instantiated here, injected into SDK for testability)
  const fs = new NodeFSAdapter();
  const git = new NodeGitAdapter();

  // Create SDK with injected adapters and event emitter that writes to stdout
  const sdk = createSDK(
    process.env.MORT_DIR!,
    fs,
    git,
    (event, payload) => {
      console.log(JSON.stringify({ event, payload }));
    }
  );

  // Import the pre-built action module
  const module = await import(actionPath);
  const actionDef = module.default;

  if (!actionDef || typeof actionDef.execute !== 'function') {
    throw new Error(`Action must export a default with an 'execute' function`);
  }

  await actionDef.execute(context, sdk);
}

main().catch((err) => {
  console.error(JSON.stringify({ event: 'error', payload: err.message }));
  process.exit(1);
});
```

Note: The runner uses `#!/usr/bin/env node` (not tsx) because it executes pre-built JavaScript.

---

## Phase 4: SDK Distribution

The SDK needs to be available to user projects for both:
1. **Type definitions** (at development time) - so users get autocomplete and type checking
2. **Runtime implementation** (at execution time) - the actual SDK functions

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **A. Publish to npm** | Standard workflow, versioning, easy updates | Requires npm account, publish process, version management |
| **B. Local file path** | Simple, no publish needed | Fragile paths, manual version sync |
| **C. Static .d.ts file** | Zero runtime dependency, very simple | No runtime - SDK must be injected |
| **D. Git submodule/subtree** | Version controlled | Complex for users |

### Recommended: Option C - Static Type Definitions + Runtime Injection

This is the simplest approach that avoids npm publishing complexity:

1. **Types**: Ship a static `@mort/sdk.d.ts` file that users copy or reference
2. **Runtime**: The SDK implementation is injected by Mort's runner at execution time

#### How It Works

**Type definitions (development time):**

The SDK is copied directly into the default project's `node_modules/` during initialization:
```
~/.mort/quick-actions/
└── node_modules/
    └── @mort/sdk/
        ├── index.d.ts      # Type definitions
        ├── index.js        # Minimal runtime (just defineAction)
        └── package.json    # Package manifest
```

This means users get standard TypeScript resolution without any special `tsconfig.json` paths - just `import { defineAction } from '@mort/sdk'` works out of the box.

**Runtime (execution time):**
The Mort runner injects the SDK as a global or passes it to the action:

```typescript
// In runner.ts - SDK is created and passed, not imported by user code
const sdk = createSDK(mortDir, emitEvent);
await actionDef.execute(context, sdk);
```

User's action code never actually imports the SDK at runtime - it just uses the types:
```typescript
// User's action - types only, no actual import at runtime
import type { QuickActionExecutionContext, MortSDK } from '@mort/sdk';
import { defineAction } from '@mort/sdk';

export default defineAction({
  // ...
  execute(context: QuickActionExecutionContext, sdk: MortSDK) {
    // sdk is injected at runtime, not imported
  }
});
```

#### SDK Files Shipped to node_modules/@mort/sdk/

**package.json:**
```json
{
  "name": "@mort/sdk",
  "version": "1.0.0",
  "types": "index.d.ts",
  "main": "index.js"
}
```

**index.d.ts:**
Contains all the type definitions from Phase 2 - this is the primary artifact users interact with for TypeScript support.

**index.js:**
Minimal runtime that exports only `defineAction`:
```javascript
export function defineAction(def) {
  return def;
}
```

The `defineAction` helper is the only runtime code in the SDK package - it's a simple pass-through that returns the definition object unchanged. The actual SDK implementation (git, threads, ui, etc.) is **injected at runtime** by Mort's runner when the action executes. User code never imports the real SDK - only types.

#### Bootstrap Integration

On first launch, Mort:
1. Creates the default project at `~/.mort/quick-actions/`
2. Copies the SDK into `~/.mort/quick-actions/node_modules/@mort/sdk/`
3. The project is immediately ready to use (after `npm install` for build deps)

This keeps the SDK in sync with the Mort version without requiring npm publishing.

### Alternative: Publish to npm (Future)

If we want a more standard workflow later:

```bash
npm install @mort/sdk --save-dev
```

The package would contain:
- Type definitions
- `defineAction` helper
- Documentation

For now, the static file approach is simpler and avoids npm publishing overhead.

---

## Phase 5: Default Project & Initialization

### 5.1 Default Quick Actions Project

Mort ships with a **pre-configured quick actions project** that gets initialized at `~/.mort/quick-actions/` on first launch. This removes the friction of project setup - users can immediately start adding actions.

**Default project structure:**
```
~/.mort/quick-actions/
├── package.json           # Pre-configured, ready to use
├── tsconfig.json          # TypeScript config with @mort/sdk paths
├── build.ts               # Build script that generates manifest
├── src/
│   └── actions/
│       └── example.ts     # Example action showing the pattern
├── dist/                  # Build output (created after first build)
│   ├── manifest.json
│   └── actions/
│       └── example.js
└── README.md              # Documentation for writing actions
```

### 5.2 Bootstrap Initialization (Idempotent)

The quick actions project is created during Mort's bootstrap process, following the established migrations pattern. This ensures:
- First-time users get the project created automatically
- Existing users get SDK updates through migrations
- The process is idempotent (safe to run multiple times)

```typescript
// In bootstrap/migrations
export const quickActionsProjectMigration: Migration = {
  id: 'quick-actions-project-v1',

  async up(mortDir: string): Promise<void> {
    const projectPath = path.join(mortDir, 'quick-actions');

    // Create project directory if it doesn't exist
    if (!await fs.exists(projectPath)) {
      await copyTemplateProject(projectPath);
      return;
    }

    // Project exists - check if SDK needs updating
    const currentSdkVersion = await readSdkVersion(projectPath);
    const bundledSdkVersion = BUNDLED_SDK_VERSION;

    if (semver.lt(currentSdkVersion, bundledSdkVersion)) {
      // Update SDK files only (preserve user's actions)
      await updateSdkFiles(projectPath);
    }
  },
};
```

**What gets updated on SDK version bumps:**
- `node_modules/@mort/sdk/` (types + defineAction helper)
- `build.ts` (if build script changes)
- Does NOT overwrite user's `src/actions/` or `dist/`

### 5.2.1 Node.js Detection

Mort requires Node.js to be installed on the user's system. On first attempt to execute a quick action (or during project initialization), Mort should check for Node.js availability:

```typescript
async function checkNodeAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
  try {
    const result = await Command.create('node', ['--version']).execute();
    if (result.code === 0) {
      return { available: true, version: result.stdout.trim() };
    }
    return { available: false, error: 'Node.js command failed' };
  } catch (e) {
    return {
      available: false,
      error: 'Node.js not found. Please install Node.js to use quick actions.'
    };
  }
}
```

If Node.js is not available:
- Show a toast/modal explaining that Node.js is required
- Provide a link to https://nodejs.org for installation
- Disable quick action functionality until Node.js is detected

### 5.3 User Workflow

**Adding a new action:**
1. Create a new file: `~/.mort/quick-actions/src/actions/my-action.ts`
2. Write the action using the `defineAction` helper
3. Run `npm run build` (or click "Rebuild" in Mort settings)
4. Action appears in the quick actions UI

**Example - creating a new action:**
```typescript
// ~/.mort/quick-actions/src/actions/archive-all-read.ts
import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'archive-all-read',
  title: 'Archive All Read',
  description: 'Archive all read threads in current repo',
  contexts: ['empty'],

  async execute(context, sdk) {
    const threads = await sdk.threads.list();
    const readThreads = threads.filter(t => t.isRead && t.repoId === context.repository?.id);

    for (const thread of readThreads) {
      await sdk.threads.archive(thread.id);
    }

    await sdk.ui.showToast(`Archived ${readThreads.length} threads`, 'success');
  },
});
```

### 5.4 Build Integration in UI

The settings page provides a "Rebuild Actions" button that:
1. Runs `npm run build` in the quick actions directory
2. Shows build output/errors in a modal
3. Reloads the manifest on success

```typescript
// In settings UI
async function handleRebuild(): Promise<void> {
  setBuilding(true);

  const result = await invoke('run_quick_actions_build', {
    projectPath: quickActionsPath,
  });

  if (result.success) {
    await quickActionService.reloadManifest();
    toast.success('Actions rebuilt successfully');
  } else {
    showBuildErrorModal(result.stderr);
  }

  setBuilding(false);
}
```

### 5.5 Project Validation

When a user registers a project, Mort validates:

1. **Directory exists** - The path points to a valid directory
2. **Has dist/manifest.json** - Project has been built
3. **Manifest is valid** - Conforms to expected schema
4. **Entry points exist** - All referenced JS files exist in dist/

**Implementation: `src/lib/quick-action-validator.ts`**

```typescript
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: QuickActionManifest;
}

export async function validateQuickActionProject(
  projectPath: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check directory exists
  if (!await fs.exists(projectPath)) {
    return { valid: false, errors: ['Directory does not exist'], warnings };
  }

  // Check manifest exists
  const manifestPath = path.join(projectPath, 'dist', 'manifest.json');
  if (!await fs.exists(manifestPath)) {
    return {
      valid: false,
      errors: ['No dist/manifest.json found. Run `npm run build` first.'],
      warnings,
    };
  }

  // Parse and validate manifest
  let manifest: QuickActionManifest;
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(content);
  } catch (e) {
    return {
      valid: false,
      errors: ['Invalid manifest.json: ' + e.message],
      warnings,
    };
  }

  // Validate manifest schema
  const schemaResult = QuickActionManifestSchema.safeParse(manifest);
  if (!schemaResult.success) {
    return {
      valid: false,
      errors: ['Invalid manifest schema: ' + schemaResult.error.message],
      warnings,
    };
  }

  // Check all entry points exist
  for (const action of manifest.actions) {
    const entryPath = path.join(projectPath, 'dist', action.entryPoint);
    if (!await fs.exists(entryPath)) {
      errors.push(`Missing entry point: ${action.entryPoint}`);
    }
  }

  // Check for common issues
  if (!await fs.exists(path.join(projectPath, 'package.json'))) {
    warnings.push('No package.json found - is this a valid project?');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: errors.length === 0 ? manifest : undefined,
  };
}
```

### 5.6 Manual Refresh

When users rebuild their project, they manually trigger a refresh in Mort:

1. User runs `npm run build` in their quick actions project
2. User clicks "Refresh Actions" button in Mort settings
3. Mort re-reads `dist/manifest.json` and updates the action list

This keeps the implementation simple - no file watchers needed.

```typescript
// In quick-action-service.ts
async refreshActions(): Promise<void> {
  const projectPath = path.join(mortDir, 'quick-actions');
  const validation = await validateQuickActionProject(projectPath);

  if (!validation.valid) {
    throw new Error(validation.errors.join('\n'));
  }

  // Re-register all actions from manifest
  await this.loadFromManifest(validation.manifest!);
}
```

---

## Phase 6: UI Components

### 6.1 Updated Quick Actions Panel

**File: `src/components/control-panel/suggested-actions-panel.tsx`**

Key changes:
- Horizontal navigation (left/right arrows)
- Hotkey display (Cmd+0-9)
- Compact horizontal layout
- "Configure" CTA link to settings
- Execution spinner with action name
- Hotkeys disabled during execution

```typescript
export function QuickActionsPanel({ contextType }: { contextType: 'thread' | 'plan' | 'empty' }) {
  const actions = useQuickActions(contextType);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { isExecuting, executingAction, execute } = useQuickActionExecutor();

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isExecuting) return; // Disable navigation during execution

    if (e.key === 'ArrowLeft') {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (e.key === 'ArrowRight') {
      setSelectedIndex(Math.min(actions.length - 1, selectedIndex + 1));
    }
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-surface-400">Quick Actions</span>
        <Link to="/settings/quick-actions" className="text-xs text-accent-500 hover:underline">
          Configure
        </Link>
      </div>

      {isExecuting ? (
        <div className="flex items-center gap-2 text-sm text-surface-300">
          <Spinner size="sm" />
          <span>{executingAction?.title}...</span>
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto">
          {actions.map((action, index) => (
            <QuickActionChip
              key={action.id}
              action={action}
              isSelected={selectedIndex === index}
              onClick={() => execute(action)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

### 6.2 Quick Action Chip Component

**File: `src/components/quick-actions/quick-action-chip.tsx`**

```typescript
interface QuickActionChipProps {
  action: QuickActionMetadata | BuiltInAction;
  isSelected: boolean;
  onClick: () => void;
}

export function QuickActionChip({ action, isSelected, onClick }: QuickActionChipProps) {
  const hotkey = 'hotkey' in action ? action.hotkey : undefined;

  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-sm whitespace-nowrap",
        "border border-surface-600 transition-colors",
        isSelected
          ? "bg-surface-700 text-surface-100 border-accent-500"
          : "bg-surface-800 text-surface-300 hover:bg-surface-700"
      )}
    >
      <span>{action.title}</span>
      {hotkey !== undefined && (
        <kbd className="ml-2 text-xs text-surface-500">⌘{hotkey}</kbd>
      )}
    </button>
  );
}
```

### 6.3 Quick Actions Settings Page

**File: `src/components/settings/quick-actions-settings.tsx`**

UI for managing quick actions:
- List of registered quick actions
- Add new quick action (title, script path, contexts, hotkey)
- Edit existing quick actions
- Drag-to-reorder
- Enable/disable toggle
- Delete action

```typescript
export function QuickActionsSettings() {
  const actions = useQuickActionsStore((s) => s.actions);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Quick Actions</h2>
        <Button onClick={handleAddNew}>Add Quick Action</Button>
      </div>

      <DndContext onDragEnd={handleReorder}>
        <SortableContext items={actions.map(a => a.id)}>
          {actions.map((action) => (
            <QuickActionListItem
              key={action.id}
              action={action}
              onEdit={() => setEditingId(action.id)}
              onDelete={() => handleDelete(action.id)}
              onToggle={() => handleToggle(action.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {editingId && (
        <QuickActionEditModal
          action={actions.find(a => a.id === editingId)}
          onSave={handleSave}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
```

### 6.4 App-Local Hotkey Registration

**File: `src/hooks/useQuickActionHotkeys.ts`**

Hotkeys are registered locally within the app (not system-wide global hotkeys). They only trigger when the app window is focused.

```typescript
export function useQuickActionHotkeys() {
  const actions = useQuickActionsStore((s) => s.actions);
  const executeAction = useQuickActionExecutor();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+0-9 (app-local, only when window is focused)
      if (e.metaKey && /^[0-9]$/.test(e.key)) {
        const hotkey = parseInt(e.key);
        const action = actions.find(a => a.hotkey === hotkey && a.enabled);

        if (action) {
          e.preventDefault();
          executeAction(action);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions, executeAction]);
}
```

---

## Phase 7: Event Bridge for UI Control

### 7.1 SDK Event Flow

SDK events follow the established event-bridge pattern for proper cross-window broadcast:

```
SDK stdout → executor → entity service (writes to disk) → eventBus → event-bridge → Tauri emit → all windows
```

**Entity operations** (archive, markRead, etc.) are handled by calling the appropriate entity service, which:
1. Writes to disk (disk-as-truth)
2. Emits events through the event-bridge for cross-window broadcast
3. Other windows receive the event and refresh from disk

**UI operations** (setInput, toast, focus) are handled locally since they don't need cross-window sync.

This is implemented in the executor's `handleSDKEvent` function (see Phase 3.2).

### 7.2 Input Store for External Control

**File: `src/stores/input-store.ts`**

The input store manages the current active input content and focus state:

```typescript
import { create } from 'zustand';

interface InputState {
  // Current active input content
  content: string;
  setContent: (content: string) => void;
  appendContent: (content: string) => void;
  clearContent: () => void;

  // For focusing from outside
  focusRequested: boolean;
  requestFocus: () => void;
  clearFocusRequest: () => void;
}

export const useInputStore = create<InputState>((set, get) => ({
  content: '',
  setContent: (content) => set({ content }),
  appendContent: (content) => set({ content: get().content + content }),
  clearContent: () => set({ content: '' }),

  focusRequested: false,
  requestFocus: () => set({ focusRequested: true }),
  clearFocusRequest: () => set({ focusRequested: false }),
}));
```

### 7.3 Draft Store (Persistent)

**File: `src/entities/drafts/store.ts`**

Drafts are stored separately from threads/plans and persisted to disk at `~/.mort/drafts.json`. This keeps draft state isolated and survives app restarts.

```typescript
// Storage: ~/.mort/drafts.json
interface DraftsFile {
  // Key is thread/plan UUID, value is draft content
  threads: Record<string, string>;
  plans: Record<string, string>;
  empty: string;  // Draft for empty state
}
```

**File: `src/entities/drafts/service.ts`**

```typescript
export const draftService = {
  async hydrate(): Promise<void>;

  // Thread drafts
  getThreadDraft(threadId: string): string;
  saveThreadDraft(threadId: string, content: string): Promise<void>;
  clearThreadDraft(threadId: string): Promise<void>;

  // Plan drafts
  getPlanDraft(planId: string): string;
  savePlanDraft(planId: string, content: string): Promise<void>;
  clearPlanDraft(planId: string): Promise<void>;

  // Empty state draft
  getEmptyDraft(): string;
  saveEmptyDraft(content: string): Promise<void>;
  clearEmptyDraft(): Promise<void>;
};
```

**Draft behavior:**
- When navigating away from a thread/plan, save current input as draft
- When navigating to a thread/plan, restore draft if exists
- When a message is sent, clear the draft for that context
- Quick actions that navigate should trigger draft save/restore automatically
- Drafts persist across app restarts

---

## Phase 8: Default Actions (SDK-Based)

The existing quick actions (Archive, Mark Unread, Next Unread, etc.) are **implemented using the SDK** and shipped as part of the default project template. This dogfoods the SDK and ensures all actions go through the same system - no special "built-in" code paths.

### 8.1 Default Actions in Template

**File: `core/sdk/template/src/actions/archive.ts`**

```typescript
import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'archive',
  title: 'Archive',
  description: 'Complete and file away',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.archive(context.threadId);
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.archive(context.planId);
    }
    sdk.log.info('Archived item');
  },
});
```

**File: `core/sdk/template/src/actions/mark-unread.ts`**

```typescript
import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'mark-unread',
  title: 'Mark Unread',
  description: 'Return to inbox for later',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.markUnread(context.threadId);
    }
    // Plans don't have read/unread status currently
  },
});
```

**File: `core/sdk/template/src/actions/next-unread.ts`**

```typescript
import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'next-unread',
  title: 'Next Unread',
  description: 'Proceed to next unread item',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    await sdk.ui.navigateToNextUnread();
  },
});
```

### 8.2 Actions Provider

**File: `src/hooks/useQuickActions.ts`**

Since all actions (including defaults) come from the SDK project, the hook simply returns actions from the store filtered by context:

```typescript
export function useQuickActions(contextType: 'thread' | 'plan' | 'empty') {
  const actions = useQuickActionsStore((s) => s.getForContext(contextType));

  // All actions are SDK-based, ordered by user preference
  return actions;
}
```

### 8.3 Default Project Pre-Built

The default project template ships **pre-built** so users have working actions immediately without needing to run `npm install` or `npm run build`. The template includes:

```
~/.mort/quick-actions/
├── package.json
├── tsconfig.json
├── build.ts
├── src/actions/           # Source files (for user reference/modification)
│   ├── archive.ts
│   ├── mark-unread.ts
│   ├── next-unread.ts
│   └── example.ts         # Example showing SDK usage patterns
├── dist/                  # Pre-built output (ships with template)
│   ├── manifest.json
│   └── actions/
│       ├── archive.js
│       ├── mark-unread.js
│       ├── next-unread.js
│       └── example.js
└── node_modules/
    └── @mort/sdk/          # Only types + defineAction helper (tiny, ships with template)
        ├── package.json
        ├── index.d.ts      # Type definitions
        └── index.js        # Just defineAction()
```

The `node_modules/@mort/sdk/` directory is small (just types + one helper function) and ships with the template. Users can immediately use the default actions.

When users want to add custom actions or modify defaults:
1. Run `npm install` (one-time, installs build dependencies like esbuild/tsx)
2. Edit/add files in `src/actions/`
3. Run `npm run build`
4. Click "Refresh Actions" in Mort settings

---

## Implementation Order

### Step 1: Core Types & Entity
- [ ] Create `core/types/quick-actions.ts` with Zod schemas (project, manifest, registry)
- [ ] Create `src/entities/quick-actions/store.ts` (use Record, not array)
- [ ] Create `src/entities/quick-actions/service.ts`
- [ ] Create `src/entities/quick-actions/listeners.ts`
- [ ] Add to entity hydration in `src/entities/index.ts`

### Step 2: SDK Type Definitions
- [ ] Create `core/sdk/types.ts` with all interfaces
- [ ] Create `core/sdk/index.d.ts` (distributable types)
- [ ] Create `core/sdk/index.js` (minimal runtime with `defineAction`)
- [ ] Create package.json for `@mort/sdk`

### Step 3: SDK Runtime Implementation
- [ ] Create `core/sdk/runtime/index.ts` (SDK factory)
- [ ] Create `core/sdk/runner.ts` (Node entry point for executing actions)
- [ ] Implement Git, Thread, Plan services
- [ ] Implement UI and Log services

### Step 4: Default Project & Initialization
- [ ] Create bundled template project (package.json, tsconfig, build.ts, example action, README)
- [ ] Implement first-launch initialization (copy template to ~/.mort/quick-actions/)
- [ ] Create `src/lib/quick-action-validator.ts`
- [ ] Implement "Rebuild Actions" button in settings

### Step 5: Quick Action Executor
- [ ] Create `src/lib/quick-action-executor.ts`
- [ ] Handle SDK events from stdout
- [ ] Integrate with shell environment setup

### Step 6: UI Updates
- [ ] Update `suggested-actions-panel.tsx` for horizontal navigation
- [ ] Create `QuickActionChip` component
- [ ] Create settings page for action configuration (hotkeys, order)
- [ ] Implement drag-to-reorder

### Step 7: Hotkeys & Event Bridge
- [ ] Create `useQuickActionHotkeys` hook (app-local, not global)
- [ ] Create `input-store.ts` for external input control
- [ ] Setup event listeners for SDK UI events

### Step 8: Built-in Migration
- [ ] Create `built-in.ts` with existing actions
- [ ] Create `useQuickActions` hook
- [ ] Update UI to use combined actions

### Step 9: Testing & Polish
- [ ] Test full flow: init project → build → register → execute
- [ ] Test all SDK services
- [ ] Test hotkey combinations
- [ ] Test horizontal navigation
- [ ] Test manual refresh
- [ ] Error handling and edge cases

---

## Files to Create

| File | Description |
|------|-------------|
| **Core Types** | |
| `core/types/quick-actions.ts` | Quick action type definitions (project, manifest, registry) |
| **SDK Distribution (copied to ~/.mort/quick-actions/node_modules/@mort/sdk/)** | |
| `core/sdk/dist/index.d.ts` | Type definitions for user projects |
| `core/sdk/dist/index.js` | Minimal runtime (`defineAction` helper) |
| `core/sdk/dist/package.json` | Package manifest for TypeScript resolution |
| **SDK Runtime (used by Mort's runner)** | |
| `core/sdk/types.ts` | Full SDK type definitions |
| `core/sdk/runtime/index.ts` | SDK factory implementation |
| `core/sdk/runner.ts` | Node entry point for executing actions |
| `core/sdk/services/git.ts` | Git service implementation |
| `core/sdk/services/threads.ts` | Thread service implementation |
| `core/sdk/services/plans.ts` | Plan service implementation |
| `core/sdk/services/ui.ts` | UI service implementation |
| `core/sdk/services/log.ts` | Log service implementation |
| **Default Project Template (bundled, copied to ~/.mort/quick-actions/)** | |
| `core/sdk/template/package.json` | Pre-configured package.json |
| `core/sdk/template/tsconfig.json` | TypeScript config with SDK paths |
| `core/sdk/template/build.ts` | Build script that generates manifest |
| `core/sdk/template/src/actions/example.ts` | Example action |
| `core/sdk/template/README.md` | Documentation for writing actions |
| `src/lib/quick-actions-init.ts` | First-launch initialization logic |
| **Frontend** | |
| `src/entities/quick-actions/types.ts` | Re-export from core |
| `src/entities/quick-actions/store.ts` | Zustand store (uses Record, not array) |
| `src/entities/quick-actions/service.ts` | Quick action service |
| `src/entities/quick-actions/listeners.ts` | Event listeners for registry/manifest changes |
| `src/entities/quick-actions/built-in.ts` | Built-in actions |
| `src/lib/quick-action-executor.ts` | Execution from Tauri |
| `src/lib/quick-action-validator.ts` | Project validation |
| `src/stores/input-store.ts` | Input state for SDK control |
| `src/entities/drafts/store.ts` | Draft persistence store |
| `src/entities/drafts/service.ts` | Draft service (read/write to disk) |
| `src/hooks/useQuickActions.ts` | Combined actions hook |
| `src/hooks/useQuickActionHotkeys.ts` | Hotkey registration |
| `src/components/quick-actions/quick-action-chip.tsx` | Chip component |
| `src/components/settings/quick-actions-settings.tsx` | Settings page |

## Files to Modify

| File | Changes |
|------|---------|
| `src/entities/index.ts` | Add quick action hydration |
| `src/stores/quick-actions-store.ts` | Rename to UI state only |
| `src/components/control-panel/suggested-actions-panel.tsx` | Horizontal nav |
| `src/components/reusable/thread-input.tsx` | Connect to input store |
| `src/App.tsx` | Add hotkey provider |

---

## Design Decisions

1. **Default Project, Batteries Included**: Mort ships with a pre-configured quick actions project at `~/.mort/quick-actions/`. Users can immediately add actions without any setup. This reduces friction while still allowing full customization.

2. **Project-Based Architecture**: Quick actions are organized into projects rather than individual scripts. This gives users full control over their build toolchain (esbuild, tsc, swc, etc.) and eliminates tsx as a runtime dependency.

3. **Build-Time Validation**: Projects must be built before use. Mort validates the `dist/manifest.json` and entry points exist. Type checking happens at the user's build step, not at runtime.

4. **SDK Distribution**: Types are shipped as a static `.d.ts` file in the default project. The actual SDK implementation is injected at runtime by Mort's runner.

5. **Runtime Dependency**: Only Node.js required at runtime (not tsx). User projects build to vanilla JavaScript. **Mort does not bundle Node.js** - users must have Node.js installed on their system. Mort should detect if Node.js is missing and provide a helpful error message.

6. **Sandboxing**: No sandboxing - scripts run with same trust as user code.

7. **Error Display**: Toast notification with "View logs" link. **Partial failures are not rolled back** - if an action fails mid-execution, the partial state remains. Atomicity and cleanup are out of scope for this plan; actions are responsible for their own error handling.

8. **Hotkeys**: App-local only (not system-wide global hotkeys). Only trigger when app window is focused. All actions share a single Cmd+0-9 hotkey pool (see decision #31).

9. **Manual Refresh**: Mort does **not** watch for manifest changes. Users manually trigger a refresh via the "Rebuild" button in settings. This keeps implementation simple.

10. **SDK Communication**: Bidirectional IPC via stdin/stdout JSON messaging. The Node process can emit events to Mort (UI commands, logs), and Mort can respond if needed. However, **state reads/writes (threads, plans, git) should read directly from disk** using the adapter pattern - IPC round-trips should be rare and reserved for UI control operations.

11. **Execution UX**: When a quick action is triggered, the UI shows a loading state but **does not block interaction**. The Node process signals completion by exiting gracefully. Users can continue using the app while actions run in the background.

12. **SDK Data Access**: The SDK receives the `.mort` directory path and reads directly from disk using the same storage format as Mort's Zustand stores. This enables code reuse via shared transformers (disk → usable format) following the existing adapter pattern. The SDK implementation should DRY with frontend adapters where possible.

13. **SDK Versioning**: The SDK includes a version number. Mort checks the SDK version in user projects and warns if out of date. Backwards compatibility is not guaranteed initially - users (or LLMs) can update their quick actions when SDK changes.

14. **Action IDs**: All actions (both user-defined and built-in) use UUID identifiers internally. Display names/titles can conflict freely. The manifest `id` field in user projects is a human-readable slug, but Mort assigns a UUID when registering the action.

15. **Logging**: SDK log calls (`sdk.log.info()`, etc.) route to Mort's main logger, appearing alongside other app logs.

16. **Context Scope**: The `'all'` context means the three main views: thread, plan, and empty. Quick actions are **not** shown on settings pages, logs pages, or when modals are open.

17. **Execution Feedback**: Small spinner in the quick actions bar with action name, disappears on completion. Simple and non-intrusive.

18. **No Concurrent Actions**: Users cannot trigger a new quick action while one is running. Hotkeys are temporarily disabled during execution to prevent race conditions and confusing state.

19. **Action Discovery**: Context-relevant actions are shown in the horizontal bar. A "Configure" CTA link appears next to the quick actions title, linking to settings where users can see all actions, assign hotkeys, and reorder.

20. **Hotkey Conflict Resolution**: When assigning a hotkey that's already in use, show an error with an option to override (reassign). User explicitly confirms the swap.

21. **Default Actions via SDK**: The existing built-in actions (Archive, Mark Unread, Next Unread, etc.) should be **implemented using the SDK** and shipped as part of the default project. This dogfoods the SDK and ensures feature parity. There are no "magic" built-in actions - everything goes through the same system.

22. **SDK Types Distribution**: Ship only a `types.d.ts` file for TypeScript support. The actual SDK implementation is injected at runtime by Mort's runner - user projects never import real SDK code, only type definitions.

23. **No Manifest Watching**: Mort does **not** watch for manifest changes automatically. Users manually trigger a refresh via the "Rebuild" button in settings or a refresh action. This keeps the implementation simple and avoids file watcher complexity.

24. **State Sync via Events**: When the SDK performs write operations (e.g., `sdk.threads.archive()`), it emits events through stdout only - **Mort handles the actual disk write**. This ensures a single source of truth and avoids race conditions. The frontend listens for these events, performs the mutation, and updates Zustand stores.

25. **Action Timeout**: Quick actions have a **30-second timeout** using `Promise.race()`. If the Node process doesn't exit within 30 seconds, Mort kills it and shows a timeout error.

26. **Error Detail Level**: When an action fails, show the **actual error message and stack trace** in the toast/error display. Users need actionable information to debug their actions.

27. **Action Ordering**: Actions are sorted **lexicographically by title** by default. Users can customize order in settings, which is persisted in the registry.

28. **Context Switching During Execution**: If a user navigates away while an action is running, the action continues executing. UI updates still apply when it completes. A **draft state** should be introduced for thread/plan inputs so in-progress content is preserved across navigation.

29. **`navigateToNextUnread()` Empty Case**: If there are no unread items, this method navigates to the **empty state** (closes the current thread/plan view).

30. **Bootstrap Initialization**: The quick actions project is created during bootstrap in an **idempotent** way. Future SDK version updates go through the established migrations pattern.

31. **Unified Hotkey Pool**: All actions (default and custom) share a single pool of Cmd+0-9 hotkeys. No reserved hotkeys - users assign all hotkeys themselves in settings. First-come-first-served, with conflict resolution UI.

32. **Draft Persistence**: Drafts are **persisted to disk** in their own store (e.g., `~/.mort/drafts.json`), keyed by thread/plan UUID. This keeps draft state separate from thread/plan entities and survives app restarts.

33. **SDK Write Operations**: The SDK **emits events only** for write operations - it does NOT write directly to disk. Mort handles all writes, ensuring a single source of truth. The event pattern (stdout JSON) notifies Mort to perform the actual mutation. This keeps the SDK simple and avoids race conditions.

34. **Empty State Actions**: Actions opt into showing in empty context via their `contexts` array. Default actions like Archive/Mark Unread don't include 'empty', but users can create actions specifically for the empty state (e.g., "Start Fresh Thread", "Open Last Thread").

35. **Settings Page Structure**: Quick actions settings is a **section within an existing settings page**, but uses a **modal UI** for editing/creating individual actions. This keeps navigation simple while providing focused editing experience.
