/**
 * Event emitter helper for UI isolation tests.
 *
 * Provides utilities to emit events to the mitt event bus,
 * simulating backend/agent events without Tauri.
 */

import { vi, type Mock } from "vitest";
import { eventBus, EventName, type AppEvents, type ThreadState } from "@/entities/events";

// ============================================================================
// Utilities
// ============================================================================

/**
 * Wait for React state updates to flush.
 * Use after emitting events to ensure UI has processed them.
 */
export async function waitForReact(ms = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Flush all pending promises and timers.
 * More aggressive than waitForReact, useful for complex async flows.
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// TestEvents Class
// ============================================================================

export class TestEvents {
  /**
   * Emit an event directly to the mitt bus.
   * This simulates what would happen when Tauri broadcasts an event.
   */
  static emit<E extends keyof AppEvents>(name: E, payload: AppEvents[E]): void {
    eventBus.emit(name, payload);
  }

  /**
   * Emit an event and wait for React to process it.
   */
  static async emitAndWait<E extends keyof AppEvents>(name: E, payload: AppEvents[E]): Promise<void> {
    this.emit(name, payload);
    await waitForReact();
  }

  // ==========================================================================
  // Task Events
  // ==========================================================================

  /**
   * Emit task:created and wait for React to process.
   */
  static async taskCreated(taskId: string): Promise<void> {
    await this.emitAndWait(EventName.TASK_CREATED, { taskId });
  }

  /**
   * Emit task:updated and wait for React to process.
   */
  static async taskUpdated(taskId: string): Promise<void> {
    await this.emitAndWait(EventName.TASK_UPDATED, { taskId });
  }

  /**
   * Emit task:deleted and wait for React to process.
   */
  static async taskDeleted(taskId: string): Promise<void> {
    await this.emitAndWait(EventName.TASK_DELETED, { taskId });
  }

  /**
   * Emit task:status-changed and wait for React to process.
   */
  static async taskStatusChanged(
    taskId: string,
    status: "draft" | "backlog" | "todo" | "in-progress" | "in-review" | "done" | "cancelled"
  ): Promise<void> {
    await this.emitAndWait(EventName.TASK_STATUS_CHANGED, { taskId, status });
  }

  // ==========================================================================
  // Thread Events
  // ==========================================================================

  /**
   * Emit thread:created and wait for React to process.
   */
  static async threadCreated(threadId: string, taskId: string): Promise<void> {
    await this.emitAndWait(EventName.THREAD_CREATED, { threadId, taskId });
  }

  /**
   * Emit thread:updated and wait for React to process.
   */
  static async threadUpdated(threadId: string, taskId: string): Promise<void> {
    await this.emitAndWait(EventName.THREAD_UPDATED, { threadId, taskId });
  }

  /**
   * Emit thread:status-changed and wait for React to process.
   */
  static async threadStatusChanged(
    threadId: string,
    status: "idle" | "running" | "completed" | "error" | "paused"
  ): Promise<void> {
    await this.emitAndWait(EventName.THREAD_STATUS_CHANGED, { threadId, status });
  }

  // ==========================================================================
  // Agent Events
  // ==========================================================================

  /**
   * Emit agent:spawned and wait for React to process.
   */
  static async agentSpawned(threadId: string, taskId: string): Promise<void> {
    await this.emitAndWait(EventName.AGENT_SPAWNED, { threadId, taskId });
  }

  /**
   * Emit agent:state with thread state snapshot.
   */
  static async agentState(threadId: string, state: ThreadState): Promise<void> {
    await this.emitAndWait(EventName.AGENT_STATE, { threadId, state });
  }

  /**
   * Emit agent:completed and wait for React to process.
   */
  static async agentCompleted(threadId: string, exitCode = 0, costUsd?: number): Promise<void> {
    await this.emitAndWait(EventName.AGENT_COMPLETED, { threadId, exitCode, costUsd });
  }

  /**
   * Emit agent:error and wait for React to process.
   */
  static async agentError(threadId: string, error: string): Promise<void> {
    await this.emitAndWait(EventName.AGENT_ERROR, { threadId, error });
  }

  // ==========================================================================
  // Simulation Helpers
  // ==========================================================================

  /**
   * Simulate a complete agent lifecycle.
   *
   * @example
   * await TestEvents.simulateAgentRun("thread-123", "task-abc", [
   *   { role: "assistant", content: "Analyzing..." },
   *   { role: "assistant", content: "Found the issue." },
   * ]);
   */
  static async simulateAgentRun(
    threadId: string,
    taskId: string,
    messages: ThreadState["messages"]
  ): Promise<void> {
    // Spawn
    await this.agentSpawned(threadId, taskId);

    // Stream messages
    const accumulatedMessages: ThreadState["messages"] = [];
    for (const msg of messages) {
      accumulatedMessages.push(msg);
      await this.agentState(threadId, {
        messages: [...accumulatedMessages],
        fileChanges: [],
        workingDirectory: "/test/worktree",
        status: "running",
        timestamp: Date.now(),
        toolStates: {},
      });
    }

    // Complete
    await this.agentCompleted(threadId);
  }

  /**
   * Simulate an agent run that ends in error.
   */
  static async simulateAgentError(threadId: string, taskId: string, error: string): Promise<void> {
    await this.agentSpawned(threadId, taskId);
    await this.agentError(threadId, error);
  }

  // ==========================================================================
  // Repository Events
  // ==========================================================================

  /**
   * Emit repository:created and wait for React to process.
   */
  static async repositoryCreated(name: string): Promise<void> {
    await this.emitAndWait(EventName.REPOSITORY_CREATED, { name });
  }

  /**
   * Emit repository:updated and wait for React to process.
   */
  static async repositoryUpdated(name: string): Promise<void> {
    await this.emitAndWait(EventName.REPOSITORY_UPDATED, { name });
  }

  /**
   * Emit repository:deleted and wait for React to process.
   */
  static async repositoryDeleted(name: string): Promise<void> {
    await this.emitAndWait(EventName.REPOSITORY_DELETED, { name });
  }

  // ==========================================================================
  // Action Events
  // ==========================================================================

  /**
   * Emit action-requested and wait for React to process.
   */
  static async actionRequested(taskId: string, markdown: string, defaultResponse: string): Promise<void> {
    await this.emitAndWait(EventName.ACTION_REQUESTED, { taskId, markdown, defaultResponse });
  }

  // ==========================================================================
  // Settings Events
  // ==========================================================================

  /**
   * Emit settings:updated and wait for React to process.
   */
  static async settingsUpdated(key: string, value: unknown): Promise<void> {
    await this.emitAndWait(EventName.SETTINGS_UPDATED, { key, value });
  }

  // ==========================================================================
  // Listener Utilities
  // ==========================================================================

  /**
   * Subscribe to an event and return a spy function.
   * Useful for asserting that events were emitted with expected payloads.
   *
   * @example
   * const spy = TestEvents.spy(EventName.TASK_UPDATED);
   * // ... trigger some action
   * expect(spy).toHaveBeenCalledWith({ taskId: "task-123" });
   */
  static spy<E extends keyof AppEvents>(eventName: E): Mock<(payload: AppEvents[E]) => void> {
    const mockFn = vi.fn();
    eventBus.on(eventName, mockFn as (payload: AppEvents[E]) => void);
    return mockFn;
  }

  /**
   * Wait for a specific event to be emitted.
   *
   * @example
   * const promise = TestEvents.waitFor(EventName.TASK_CREATED);
   * // ... trigger task creation
   * const payload = await promise;
   */
  static waitFor<E extends keyof AppEvents>(
    eventName: E,
    timeoutMs = 1000
  ): Promise<AppEvents[E]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${eventName}`));
      }, timeoutMs);

      const handler = (payload: AppEvents[E]) => {
        clearTimeout(timeout);
        eventBus.off(eventName, handler);
        resolve(payload);
      };

      eventBus.on(eventName, handler);
    });
  }

  /**
   * Clear all event listeners from the event bus.
   * Call this in beforeEach/afterEach to prevent listener leaks.
   */
  static clearAllListeners(): void {
    eventBus.all.clear();
  }
}
