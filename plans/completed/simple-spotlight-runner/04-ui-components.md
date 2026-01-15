# 04 - UI Components

**Parallelizable:** Yes (depends only on types from 01, but can stub)
**Estimated scope:** 4 files created

## Overview

Create React components for the simple task window UI.

## Tasks

### 1. Create params hook

**File:** `src/components/simple-task/use-simple-task-params.ts`

```typescript
import { useEffect, useState } from "react";
import { logger } from "@/lib/logger-client";

interface SimpleTaskParams {
  taskId: string;
  threadId: string;
  prompt?: string;
}

/**
 * Extracts task parameters from the window URL.
 * Query params: ?taskId=xxx&threadId=xxx&prompt=xxx
 */
export function useSimpleTaskParams(): SimpleTaskParams | null {
  const [params, setParams] = useState<SimpleTaskParams | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const taskId = searchParams.get("taskId");
    const threadId = searchParams.get("threadId");
    const prompt = searchParams.get("prompt") ?? undefined;

    if (taskId && threadId) {
      setParams({ taskId, threadId, prompt });
    } else {
      logger.error("[useSimpleTaskParams] Missing taskId or threadId in URL");
    }
  }, []);

  return params;
}
```

### 2. Create header component

**File:** `src/components/simple-task/simple-task-header.tsx`

```typescript
import { getCurrentWindow } from "@tauri-apps/api/window";

interface SimpleTaskHeaderProps {
  taskId: string;
  status: "running" | "completed" | "error" | "idle";
}

export function SimpleTaskHeader({ taskId, status }: SimpleTaskHeaderProps) {
  const handleClose = async () => {
    await getCurrentWindow().close();
  };

  return (
    <div className="simple-task-header">
      <span className="task-id">{taskId.slice(0, 8)}...</span>
      <span className={`status-badge status-${status}`}>{status}</span>
      <button onClick={handleClose} className="close-button">×</button>
    </div>
  );
}
```

### 3. Create input component

**File:** `src/components/simple-task/simple-task-input.tsx`

```typescript
import { useState, useCallback, type KeyboardEvent } from "react";

interface SimpleTaskInputProps {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
}

export function SimpleTaskInput({ onSubmit, disabled }: SimpleTaskInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(() => {
    if (value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue("");
    }
  }, [value, disabled, onSubmit]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className="simple-task-input">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? "Agent is running..." : "Type a message (⌘+Enter to send)"}
      />
      <button onClick={handleSubmit} disabled={disabled || !value.trim()}>
        Send
      </button>
    </div>
  );
}
```

### 4. Create main window component

**File:** `src/components/simple-task/simple-task-window.tsx`

```typescript
import { useSimpleTaskParams } from "./use-simple-task-params";
import { useThreadStore } from "@/entities/threads/store";
import { resumeSimpleAgent } from "@/lib/simple-agent-service";
import { SimpleTaskHeader } from "./simple-task-header";
import { SimpleTaskInput } from "./simple-task-input";
import { MessageList } from "@/components/thread/message-list";

export function SimpleTaskWindow() {
  const params = useSimpleTaskParams();

  if (!params) {
    return <div className="simple-task-loading">Loading...</div>;
  }

  const { taskId, threadId } = params;
  const activeState = useThreadStore((s) => s.threadStates[threadId]);
  const activeMetadata = useThreadStore((s) => s.threads[threadId]);

  const messages = activeState?.messages ?? [];
  const status = activeMetadata?.status ?? "idle";

  const handleSubmit = async (prompt: string) => {
    await resumeSimpleAgent(taskId, threadId, prompt);
  };

  return (
    <div className="simple-task-window">
      <SimpleTaskHeader taskId={taskId} status={status} />
      <div className="simple-task-messages">
        <MessageList messages={messages} />
      </div>
      <SimpleTaskInput onSubmit={handleSubmit} disabled={status === "running"} />
    </div>
  );
}
```

### 5. Add styles (optional)

**File:** `src/components/simple-task/simple-task.css`

Basic styles for the simple task window. Can be minimal initially.

## Verification

```bash
pnpm typecheck
```

Components should compile. Visual verification happens after full integration.
