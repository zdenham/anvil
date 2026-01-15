# State Management & Hooks

Data layer for streaming agent messages and managing conversation state.

**Prerequisites:** `01-types-and-utilities.md`

## Files Owned

```
src/
├── stores/
│   └── conversation-store.ts   # Zustand store for conversation state
├── lib/
│   └── conversation-service.ts # Service for CRUD operations on conversation files
└── hooks/
    ├── use-conversation.ts         # Combined load + state hook (main API)
    ├── use-agent-stream.ts         # Low-level Tauri shell stdout subscription
    ├── use-scroll-anchor.ts        # Auto-scroll behavior
    ├── use-reduced-motion.ts       # Reduced motion preference
    └── use-relative-time.ts        # Auto-updating relative time
```

## Key Principles

- **Disk always wins**: On mount, load persisted state from `.mort/conversations/{id}/` - this is the source of truth
- **Zustand for state**: All conversation state lives in zustand store, not local React state
- **Service for operations**: Explicit CRUD methods, not implicit hooks
- **Hooks are thin**: Hooks only trigger service calls and select from store

---

## Implementation

### 1. Create conversation-store.ts (Zustand)

Centralized state for conversation data:

```typescript
// src/stores/conversation-store.ts
import { create } from "zustand";
import type {
  AgentMessage,
  FileChangeMessage,
} from "@/lib/types/agent-messages";

export interface ConversationMetadata {
  id: string;
  taskId: string;
  agentType: string;
  workingDirectory: string;
  status: "running" | "completed" | "error";
  createdAt: number;
  updatedAt: number;
  git?: {
    branch: string;
  };
  turns: Array<{
    index: number;
    prompt: string;
    startedAt: number;
    completedAt: number | null;
  }>;
}

export interface ConversationState {
  /** Current conversation ID */
  conversationId: string | null;
  /** All messages from the conversation (excluding file changes) */
  messages: AgentMessage[];
  /** File changes keyed by path (last write wins) */
  fileChanges: Map<string, FileChangeMessage>;
  /** Current conversation status */
  status: "idle" | "loading" | "running" | "completed" | "error";
  /** Error message if status is "error" */
  error?: string;
  /** Conversation metadata from metadata.json */
  metadata?: ConversationMetadata;
}

interface ConversationActions {
  /** Set conversation state after loading from disk */
  setConversation: (
    id: string,
    data: {
      messages: AgentMessage[];
      fileChanges: Map<string, FileChangeMessage>;
      metadata: ConversationMetadata;
    }
  ) => void;
  /** Append a single message (from streaming) */
  appendMessage: (msg: AgentMessage) => void;
  /** Set/update a file change (last write wins) */
  setFileChange: (change: FileChangeMessage) => void;
  /** Update status (and optionally error) */
  setStatus: (status: ConversationState["status"], error?: string) => void;
  /** Reset to initial state */
  reset: () => void;
}

const initialState: ConversationState = {
  conversationId: null,
  messages: [],
  fileChanges: new Map(),
  status: "idle",
};

export const useConversationStore = create<ConversationState & ConversationActions>(
  (set) => ({
    ...initialState,

    setConversation: (id, { messages, fileChanges, metadata }) =>
      set({
        conversationId: id,
        messages,
        fileChanges,
        metadata,
        status: metadata.status === "running" ? "running" : metadata.status,
        error: undefined,
      }),

    appendMessage: (msg) =>
      set((state) => ({
        messages: [...state.messages, msg],
      })),

    setFileChange: (change) =>
      set((state) => ({
        fileChanges: new Map(state.fileChanges).set(change.path, change),
      })),

    setStatus: (status, error) =>
      set({ status, error }),

    reset: () => set(initialState),
  })
);

// Selectors for common access patterns
export const selectMessages = (state: ConversationState) => state.messages;
export const selectFileChanges = (state: ConversationState) => state.fileChanges;
export const selectStatus = (state: ConversationState) => state.status;
export const selectIsStreaming = (state: ConversationState) =>
  state.status === "running";
```

### 2. Create conversation-service.ts

Service class for CRUD operations on conversation files:

```typescript
// src/lib/conversation-service.ts
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  useConversationStore,
  type ConversationMetadata,
} from "@/stores/conversation-store";
import type {
  AgentMessage,
  FileChangeMessage,
} from "@/lib/types/agent-messages";
import { parseJsonl } from "@/lib/utils/jsonl";
import { buildFileChangesMap } from "@/lib/utils/file-changes";

interface LoadedConversation {
  messages: AgentMessage[];
  fileChanges: Map<string, FileChangeMessage>;
  metadata: ConversationMetadata;
}

/**
 * Service for conversation CRUD operations.
 *
 * Manages loading from disk (source of truth) and real-time streaming.
 * All state updates go through the zustand store.
 */
class ConversationService {
  private unlistenStdout: UnlistenFn | null = null;
  private unlistenExit: UnlistenFn | null = null;

  /**
   * Load conversation from disk (SOURCE OF TRUTH).
   * DISK ALWAYS WINS: This is the authoritative state.
   */
  async load(conversationId: string, workingDirectory: string): Promise<void> {
    const store = useConversationStore.getState();
    store.setStatus("loading");

    try {
      const data = await this.fetchFromDisk(conversationId, workingDirectory);
      store.setConversation(conversationId, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load conversation";
      store.setStatus("error", message);
      throw err;
    }
  }

  /**
   * Fetch raw conversation data from disk.
   * Does not update store - use load() for that.
   */
  async fetchFromDisk(
    conversationId: string,
    workingDirectory: string
  ): Promise<LoadedConversation> {
    const conversationPath = await join(
      workingDirectory,
      ".mort",
      "conversations",
      conversationId
    );

    // Load metadata (required)
    const metadataPath = await join(conversationPath, "metadata.json");
    const metadataContent = await readTextFile(metadataPath);
    const metadata = JSON.parse(metadataContent) as ConversationMetadata;

    // Load messages (optional - may not exist yet)
    const messagesPath = await join(conversationPath, "messages.jsonl");
    let messages: AgentMessage[] = [];
    if (await exists(messagesPath)) {
      const messagesContent = await readTextFile(messagesPath);
      messages = parseJsonl(messagesContent);
    }

    // Load file changes (optional)
    const changesPath = await join(conversationPath, "changes.jsonl");
    let fileChanges = new Map<string, FileChangeMessage>();
    if (await exists(changesPath)) {
      const changesContent = await readTextFile(changesPath);
      const changesList = parseJsonl(changesContent).filter(
        (msg): msg is FileChangeMessage => msg.type === "file_change"
      );
      fileChanges = buildFileChangesMap(changesList);
    }

    return { messages, fileChanges, metadata };
  }

  /**
   * Subscribe to real-time stdout stream for low-latency display.
   * NOTE: Streaming is for display only, not persistence.
   */
  async subscribeToStream(conversationId: string): Promise<void> {
    // Cleanup existing subscription
    await this.unsubscribeFromStream();

    const store = useConversationStore.getState();

    // Listen for stdout events (JSONL lines)
    this.unlistenStdout = await listen<string>(
      `agent-stdout-${conversationId}`,
      (event) => {
        try {
          const msg = JSON.parse(event.payload) as AgentMessage;
          this.handleMessage(msg);
        } catch (err) {
          console.warn("Failed to parse agent message:", event.payload);
        }
      }
    );

    // Listen for process exit
    this.unlistenExit = await listen<number>(
      `agent-exit-${conversationId}`,
      (event) => {
        const exitCode = event.payload;
        const currentStatus = useConversationStore.getState().status;

        if (exitCode !== 0 && currentStatus !== "completed") {
          store.setStatus("error", `Agent process exited with code ${exitCode}`);
        }
      }
    );
  }

  /**
   * Handle incoming message from stream.
   */
  private handleMessage(msg: AgentMessage): void {
    const store = useConversationStore.getState();

    if (msg.type === "file_change") {
      store.setFileChange(msg as FileChangeMessage);
    } else {
      store.appendMessage(msg);
    }

    // Derive status from terminal messages
    if (msg.type === "complete") {
      store.setStatus("completed");
    } else if (msg.type === "error") {
      store.setStatus("error", (msg as { message: string }).message);
    } else if (store.status === "loading") {
      store.setStatus("running");
    }
  }

  /**
   * Unsubscribe from stdout stream.
   */
  async unsubscribeFromStream(): Promise<void> {
    if (this.unlistenStdout) {
      this.unlistenStdout();
      this.unlistenStdout = null;
    }
    if (this.unlistenExit) {
      this.unlistenExit();
      this.unlistenExit = null;
    }
  }

  /**
   * Reset conversation state.
   */
  async reset(): Promise<void> {
    await this.unsubscribeFromStream();
    useConversationStore.getState().reset();
  }

  /**
   * Get current conversation ID.
   */
  getCurrentId(): string | null {
    return useConversationStore.getState().conversationId;
  }
}

// Singleton instance
export const conversationService = new ConversationService();
```

### 3. Create use-conversation.ts

Combined hook that handles loading + state access in one API:

```typescript
// src/hooks/use-conversation.ts
import { useEffect, useCallback } from "react";
import { useConversationStore, type ConversationState } from "@/stores/conversation-store";
import { conversationService } from "@/lib/conversation-service";

export interface UseConversationResult {
  messages: ConversationState["messages"];
  fileChanges: ConversationState["fileChanges"];
  status: ConversationState["status"];
  error: ConversationState["error"];
  metadata: ConversationState["metadata"];
  isStreaming: boolean;
  reload: () => Promise<void>;
}

/**
 * Combined hook for conversation loading and state access.
 *
 * - Loads from disk on mount (DISK ALWAYS WINS)
 * - Subscribes to real-time stream if running
 * - Provides reload function for retry
 */
export function useConversation(
  conversationId: string | null,
  workingDirectory: string
): UseConversationResult {
  // Load and subscribe on mount
  useEffect(() => {
    if (!conversationId) {
      conversationService.reset();
      return;
    }

    // DISK ALWAYS WINS: Load persisted state first
    conversationService
      .load(conversationId, workingDirectory)
      .then(() => {
        // Then subscribe to real-time updates if running
        const status = useConversationStore.getState().status;
        if (status === "running") {
          conversationService.subscribeToStream(conversationId);
        }
      })
      .catch((err) => {
        console.error("Failed to load conversation:", err);
      });

    return () => {
      conversationService.unsubscribeFromStream();
    };
  }, [conversationId, workingDirectory]);

  // Reload function for retry
  const reload = useCallback(async () => {
    if (conversationId) {
      await conversationService.load(conversationId, workingDirectory);
    }
  }, [conversationId, workingDirectory]);

  // Select state from store
  const state = useConversationStore((s) => ({
    messages: s.messages,
    fileChanges: s.fileChanges,
    status: s.status,
    error: s.error,
    metadata: s.metadata,
  }));

  return {
    ...state,
    isStreaming: state.status === "running",
    reload,
  };
}

/**
 * Lightweight hook for just checking streaming status.
 */
export function useIsStreaming(): boolean {
  return useConversationStore((state) => state.status === "running");
}
```

### 4. Create use-agent-stream.ts (Low-level subscription)

For cases where direct stream access is needed:

```typescript
// src/hooks/use-agent-stream.ts
import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentMessage } from "@/lib/types/agent-messages";

export interface UseAgentStreamOptions {
  /** Called for each parsed message from stdout */
  onMessage: (msg: AgentMessage) => void;
  /** Called when the agent process exits */
  onClose?: (exitCode: number) => void;
  /** Called on stream errors */
  onError?: (error: Error) => void;
}

/**
 * Low-level hook to subscribe to stdout stream from a running agent process.
 *
 * NOTE: Most components should use useConversationLoader + useConversationState
 * instead, which manages state in the zustand store. Use this hook only for
 * specialized streaming scenarios.
 */
export function useAgentStream(
  conversationId: string | null,
  options: UseAgentStreamOptions
): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!conversationId) return;

    let unlistenStdout: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;

    const setup = async () => {
      // Listen for stdout events (JSONL lines)
      unlistenStdout = await listen<string>(
        `agent-stdout-${conversationId}`,
        (event) => {
          try {
            const msg = JSON.parse(event.payload) as AgentMessage;
            optionsRef.current.onMessage(msg);
          } catch (err) {
            console.warn("Failed to parse agent message:", event.payload);
          }
        }
      );

      // Listen for process exit
      unlistenExit = await listen<number>(
        `agent-exit-${conversationId}`,
        (event) => {
          optionsRef.current.onClose?.(event.payload);
        }
      );
    };

    setup().catch((err) => {
      console.error("Failed to setup agent stream listener:", err);
      optionsRef.current.onError?.(err);
    });

    return () => {
      unlistenStdout?.();
      unlistenExit?.();
    };
  }, [conversationId]);
}
```

### 5. Create use-scroll-anchor.ts

Manages auto-scroll behavior for the message list:

```typescript
// src/hooks/use-scroll-anchor.ts
import { useState, useCallback, useRef, useEffect, RefObject } from "react";

interface ScrollAnchorState {
  /** Whether the scroll position is at the bottom */
  isAtBottom: boolean;
  /** Scroll to the bottom of the container */
  scrollToBottom: () => void;
}

/**
 * Hook to manage scroll anchoring for chat interfaces.
 *
 * - Auto-scrolls to bottom when new content arrives (if already at bottom)
 * - Releases lock when user scrolls up
 * - Re-locks when user scrolls back to bottom
 */
export function useScrollAnchor(
  containerRef: RefObject<HTMLElement | null>
): ScrollAnchorState {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  // Threshold for "at bottom" detection (pixels from bottom)
  const SCROLL_THRESHOLD = 50;

  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
  }, [containerRef]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [containerRef]);

  // Handle scroll events
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const atBottom = checkIfAtBottom();
      if (atBottom !== isAtBottomRef.current) {
        isAtBottomRef.current = atBottom;
        setIsAtBottom(atBottom);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [containerRef, checkIfAtBottom]);

  return { isAtBottom, scrollToBottom };
}
```

### 6. Create use-reduced-motion.ts

Respect user preference for reduced motion:

```typescript
// src/hooks/use-reduced-motion.ts
import { useState, useEffect } from "react";

/**
 * Hook to detect user's reduced motion preference.
 */
export function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(mq.matches);

    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersReduced;
}
```

### 7. Create use-relative-time.ts

Auto-updating relative time display:

```typescript
// src/hooks/use-relative-time.ts
import { useState, useEffect } from "react";
import { formatRelativeTime } from "@/lib/utils/time-format";

/**
 * Hook that returns auto-updating relative time string.
 * Updates every 30 seconds while component is mounted.
 */
export function useRelativeTime(timestamp: number): string {
  const [relativeTime, setRelativeTime] = useState(() =>
    formatRelativeTime(timestamp)
  );

  useEffect(() => {
    // Update immediately
    setRelativeTime(formatRelativeTime(timestamp));

    // Update every 30 seconds
    const interval = setInterval(() => {
      setRelativeTime(formatRelativeTime(timestamp));
    }, 30000);

    return () => clearInterval(interval);
  }, [timestamp]);

  return relativeTime;
}
```

---

## Usage Example

```typescript
// In a component
import { useConversationLoader, useConversationState, useIsStreaming } from "@/hooks/use-conversation-loader";
import { conversationService } from "@/lib/conversation-service";

function ConversationView({ conversationId, workingDirectory }: Props) {
  // Load and subscribe on mount
  useConversationLoader(conversationId, workingDirectory);

  // Access state from store
  const { messages, fileChanges, status, error } = useConversationState();
  const isStreaming = useIsStreaming();

  // Manual reload (e.g., retry button)
  const handleRetry = () => {
    conversationService.load(conversationId, workingDirectory);
  };

  if (status === "loading") return <LoadingState />;
  if (status === "error") return <ErrorState error={error} onRetry={handleRetry} />;
  // ...
}
```

---

## Error Handling

### Agent Crash Recovery

When agent process exits unexpectedly:

1. `conversationService` receives exit event
2. Updates store status to "error" if exit code non-zero
3. Component can offer reload from disk

### Connection/IPC Errors

If Tauri shell connection fails:
- Log error to console
- State remains at "loading" or falls back to disk state
- Component can show warning banner

---

## Testing

1. **conversationService**: Test load, fetchFromDisk, stream subscription
2. **useConversationLoader**: Test mount/unmount triggers service calls
3. **useConversationStore**: Test state updates and selectors

```typescript
// Example test for conversation service
describe("conversationService", () => {
  it("loads from disk and updates store", async () => {
    // Mock Tauri fs APIs
    vi.mock("@tauri-apps/plugin-fs", () => ({
      readTextFile: vi.fn().mockResolvedValue('{"status":"completed"}'),
      exists: vi.fn().mockResolvedValue(true),
    }));

    await conversationService.load("test-id", "/project");

    const state = useConversationStore.getState();
    expect(state.conversationId).toBe("test-id");
    expect(state.status).toBe("completed");
  });
});
```

---

## Checklist

- [ ] Create `src/stores/conversation-store.ts` (zustand store)
- [ ] Create `src/lib/conversation-service.ts` (CRUD service)
- [ ] Create `src/hooks/use-conversation.ts` (combined load + state hook)
- [ ] Create `src/hooks/use-agent-stream.ts` (low-level stream hook)
- [ ] Create `src/hooks/use-scroll-anchor.ts`
- [ ] Create `src/hooks/use-reduced-motion.ts`
- [ ] Create `src/hooks/use-relative-time.ts`
- [ ] Create `src/stores/index.ts` barrel export
- [ ] Create `src/hooks/index.ts` barrel export
