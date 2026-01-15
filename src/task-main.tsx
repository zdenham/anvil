import { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, type UnlistenFn } from "@tauri-apps/api/event";
import "./index.css";
import { TaskWorkspace } from "./components/workspace";
import { setupIncomingBridge, setupOutgoingBridge } from "./lib/event-bridge";
import { setupEntityListeners, taskService, threadService, eventBus, type OpenTaskPayload } from "./entities";
import { logger, setLogSource } from "./lib/logger-client";
import { initWebErrorCapture } from "./lib/web-error-capture";
import { initializeTriggers } from "./lib/triggers";

// Set log source before any logging occurs
setLogSource("task");

// Capture browser errors early
initWebErrorCapture("task");

// Error Boundary to catch React errors and log them
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class TaskErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("[TaskErrorBoundary] React error caught:", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="h-full w-full flex flex-col items-center justify-center bg-red-950 text-white p-8">
          <div className="text-2xl font-bold mb-4">Something went wrong</div>
          <div className="text-sm text-red-300 max-w-md text-center mb-4">
            {this.state.error?.message || "An unexpected error occurred"}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

interface PendingTask {
  thread_id: string;
  task_id: string;
  prompt?: string;
  repo_name?: string;
}

// Get window label for debugging (avoid module-level evaluation issues with HMR)
function getWindowLabel(): string {
  if (typeof window === 'undefined') return 'ssr';
  // Access __TAURI__ using bracket notation to avoid type errors
  const tauriGlobal = (window as unknown as Record<string, unknown>).__TAURI__;
  if (!tauriGlobal || typeof tauriGlobal !== 'object') return 'unknown';
  const webviewWindow = (tauriGlobal as Record<string, unknown>).webviewWindow;
  if (!webviewWindow || typeof webviewWindow !== 'object') return 'unknown';
  const label = (webviewWindow as Record<string, unknown>).label;
  return typeof label === 'string' ? label : 'unknown';
}

logger.log(`[task-main] ====== MODULE LOADING ======`);

// Initialize trigger system for @ file mentions
initializeTriggers();

// Module-level state for cleanup
let bridgeCleanup: UnlistenFn[] = [];
let cleanupRegistered = false;
let bootstrapComplete = false;

/**
 * Bootstrap sequence for task-main.
 * Sets up incoming bridge, hydrates stores, and registers entity listeners.
 */
async function bootstrap() {
  logger.log("[task-main] Starting bootstrap...");

  // Set up outgoing bridge to broadcast events (e.g., thread:updated when marking as read)
  setupOutgoingBridge();

  // Set up incoming bridge to receive events
  bridgeCleanup = await setupIncomingBridge();

  // Register cleanup handler once
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    getCurrentWindow().onCloseRequested(async () => {
      logger.log("[task-main] Window closing - cleaning up bridge listeners");
      for (const fn of bridgeCleanup) {
        try {
          fn();
        } catch (error) {
          logger.error("[task-main] Cleanup error:", error);
        }
      }
    });
  }

  // Hydrate stores
  await Promise.all([
    taskService.hydrate(),
    threadService.hydrate(),
  ]);

  // Set up entity listeners after bridge and stores are ready
  setupEntityListeners();

  bootstrapComplete = true;
  logger.log("[task-main] Bootstrap complete");
}

function TaskPanel() {
  const windowLabel = getWindowLabel();
  logger.log(`[TaskPanel:${windowLabel}] ====== COMPONENT MOUNTING ======`);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(bootstrapComplete);
  const pendingThreadIdRef = useRef<string | null>(null);

  // Log unmount
  useEffect(() => {
    return () => {
      logger.log(`[TaskPanel:${windowLabel}] !!!!!!!! COMPONENT UNMOUNTING !!!!!!!!`);
    };
  }, []);

  // Pull pending task from Rust on mount (Pull Model for HMR resilience)
  useEffect(() => {
    if (!bootstrapComplete) {
      logger.warn(`[TaskPanel:${windowLabel}] Bootstrap not complete, waiting...`);
      return;
    }

    setBridgeReady(true);
    logger.log(`[TaskPanel:${windowLabel}] Bootstrap already complete, pulling pending task...`);

    // PULL MODEL: Get pending task from Rust (survives HMR reloads)
    // This is the primary way to get task data - events are backup
    const fetchPendingTask = async () => {
      try {
        const pendingTask = await invoke<PendingTask | null>("get_pending_task");
        logger.log(`[TaskPanel:${windowLabel}] Pull model - got pending task:`, pendingTask);

        if (pendingTask) {
          // Ensure task is in store
          try {
            await taskService.refreshTask(pendingTask.task_id);
          } catch (err) {
            logger.warn(`[TaskPanel:${windowLabel}] Failed to refresh task (may already exist):`, err);
          }

          // Set state from pending task
          setThreadId(pendingTask.thread_id);
          setTaskId(pendingTask.task_id);

          // Emit ready signal
          logger.log(`[TaskPanel:${windowLabel}] Pull model - emitting task-panel-ready`);
          emit("task-panel-ready", { threadId: pendingTask.thread_id });
        }
      } catch (err) {
        logger.error(`[TaskPanel:${windowLabel}] Failed to get pending task:`, err);
      }

      // If there's a pending task from event listener, emit ready now
      if (pendingThreadIdRef.current) {
        logger.log(
          `[TaskPanel:${windowLabel}] Bridge ready, emitting task-panel-ready for pending:`,
          pendingThreadIdRef.current
        );
        emit("task-panel-ready", { threadId: pendingThreadIdRef.current });
        pendingThreadIdRef.current = null;
      }
    };

    fetchPendingTask();
  }, []);

  // Listen for open-task events via eventBus (no async cleanup races)
  useEffect(() => {
    logger.log(`[TaskPanel:${windowLabel}] ====== REGISTERING open-task listener NOW ======`);
    logger.log(`[TaskPanel:${windowLabel}] Current state - threadId:`, threadId, "taskId:", taskId, "bridgeReady:", bridgeReady);

    const handleOpenTask = async (payload: OpenTaskPayload) => {
      const { threadId: id, taskId: tId } = payload;
      logger.log(`[TaskPanel:${windowLabel}] >>>>>> RECEIVED open-task event! <<<<<<`, { threadId: id, taskId: tId });

      // Ensure task is in store (fallback for race condition with task:created event)
      // The entity listeners handle the normal case via eventBus,
      // but if open-task arrives before listeners are ready, we refresh here
      try {
        await taskService.refreshTask(tId);
      } catch (err) {
        logger.warn(`[TaskPanel:${windowLabel}] Failed to refresh task (may already exist):`, err);
      }

      // Set thread and task IDs (both are required)
      setThreadId(id);
      setTaskId(tId);

      // Signal that we're ready to receive events for this task
      if (bootstrapComplete) {
        logger.log(`[TaskPanel:${windowLabel}] Bootstrap complete, emitting task-panel-ready immediately`);
        emit("task-panel-ready", { threadId: id });
      } else {
        logger.log(`[TaskPanel:${windowLabel}] Bootstrap not complete, deferring task-panel-ready`);
        pendingThreadIdRef.current = id;
      }
    };

    eventBus.on("open-task", handleOpenTask);
    logger.log(`[TaskPanel:${windowLabel}] ====== open-task listener REGISTERED ======`);

    return () => {
      eventBus.off("open-task", handleOpenTask);
    };
  }, []);

  logger.log(`[TaskPanel:${windowLabel}] Render check:`, { threadId, taskId, bridgeReady });

  // Wait for both: thread/task info AND bridge/store hydration
  if (!threadId || !taskId || !bridgeReady) {
    logger.log(`[TaskPanel:${windowLabel}] ====== RENDERING WAITING STATE ======`, {
      hasThreadId: !!threadId,
      hasTaskId: !!taskId,
      bridgeReady,
    });
    return (
      <div className="h-full w-full flex items-center justify-center bg-neutral-900" />
    );
  }

  logger.log(`[TaskPanel:${windowLabel}] ====== RENDERING TaskWorkspace ======`, { taskId, threadId });
  return (
    <TaskErrorBoundary>
      {/* Key forces remount when task changes, resetting all internal state */}
      <TaskWorkspace key={taskId} taskId={taskId} initialThreadId={threadId} />
    </TaskErrorBoundary>
  );
}

// HMR safeguard: prevent duplicate React roots
const rootElement = document.getElementById("root") as HTMLElement;

// Clear any existing content (handles HMR reloads)
rootElement.innerHTML = "";

// Start bootstrap and render when ready
bootstrap()
  .then(() => {
    ReactDOM.createRoot(rootElement).render(<TaskPanel />);
  })
  .catch((error) => {
    logger.error("[task-main] Bootstrap failed:", error);
  });
