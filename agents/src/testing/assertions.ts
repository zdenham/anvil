import type {
  AgentRunOutput,
  ThreadState,
  FileChange,
  ToolExecutionState,
} from "./types.js";
import type { MockHubServer } from "./mock-hub-server.js";
import type { StateMessage, EventMessage } from "../lib/hub/types.js";

export class AgentAssertions {
  constructor(private output: AgentRunOutput) {}

  /**
   * Assert that a specific event was emitted.
   * Optionally validate the event payload with a predicate.
   */
  hasEvent(name: string, predicate?: (payload: unknown) => boolean): this {
    const event = this.output.events.find((e) => e.name === name);
    if (!event) {
      throw new Error(
        `Expected event "${name}" not found. Emitted events: [${this.output.events.map((e) => e.name).join(", ")}]`
      );
    }
    if (predicate && !predicate(event.payload)) {
      throw new Error(
        `Event "${name}" found but payload predicate failed. Payload: ${JSON.stringify(event.payload)}`
      );
    }
    return this;
  }

  /**
   * Assert that no event with the given name was emitted.
   */
  hasNoEvent(name: string): this {
    const event = this.output.events.find((e) => e.name === name);
    if (event) {
      throw new Error(
        `Expected no event "${name}" but it was emitted with payload: ${JSON.stringify(event.payload)}`
      );
    }
    return this;
  }

  /**
   * Assert events were emitted in the specified order.
   * Events may have other events between them; this checks relative ordering.
   */
  hasEventsInOrder(names: string[]): this {
    const eventNames = this.output.events.map((e) => e.name as string);
    let lastIndex = -1;
    for (const name of names) {
      const index = eventNames.indexOf(name, lastIndex + 1);
      if (index === -1) {
        throw new Error(
          `Event "${name}" not found after position ${lastIndex}. ` +
            `Event sequence: [${eventNames.join(", ")}]`
        );
      }
      lastIndex = index;
    }
    return this;
  }

  /**
   * Assert final state matches the provided predicate.
   */
  finalState(predicate: (state: ThreadState) => boolean): this {
    const lastState = this.output.states[this.output.states.length - 1];
    if (!lastState) {
      throw new Error("No state messages received during agent run");
    }
    if (!predicate(lastState.state)) {
      throw new Error(
        `Final state predicate failed. State: ${JSON.stringify(lastState.state)}`
      );
    }
    return this;
  }

  /**
   * Assert agent exited with code 0 (success).
   */
  succeeded(): this {
    if (this.output.exitCode !== 0) {
      throw new Error(
        `Expected exit code 0, got ${this.output.exitCode}. Stderr: ${this.output.stderr || "(empty)"}`
      );
    }
    return this;
  }

  /**
   * Assert agent failed with a non-zero exit code.
   */
  failed(): this {
    if (this.output.exitCode === 0) {
      throw new Error("Expected non-zero exit code, but agent succeeded");
    }
    return this;
  }

  /**
   * Assert final state has error status.
   * Optionally validate the error message with a predicate.
   */
  errored(errorPredicate?: (error: string | undefined) => boolean): this {
    const lastState = this.output.states[this.output.states.length - 1];
    if (!lastState || lastState.state.status !== "error") {
      throw new Error(
        `Expected error status, got: ${lastState?.state.status ?? "no state received"}`
      );
    }
    if (errorPredicate && !errorPredicate(lastState.state.error)) {
      throw new Error(
        `Error predicate failed. Error message: ${lastState.state.error ?? "(undefined)"}`
      );
    }
    return this;
  }

  /**
   * Assert agent was killed due to timeout.
   * Expects exit code -1 and timeout message in stderr.
   */
  timedOut(): this {
    if (this.output.exitCode !== -1) {
      throw new Error(
        `Expected timeout (exit code -1), got: ${this.output.exitCode}`
      );
    }
    if (!this.output.stderr.includes("[Killed: timeout")) {
      throw new Error(
        `Expected timeout message in stderr. Stderr: ${this.output.stderr || "(empty)"}`
      );
    }
    return this;
  }

  /**
   * Assert agent made file changes in its final state.
   * Optionally validate the changes with a predicate.
   */
  hasFileChanges(predicate?: (changes: FileChange[]) => boolean): this {
    const lastState = this.output.states[this.output.states.length - 1];
    const changes = lastState?.state.fileChanges ?? [];
    if (changes.length === 0) {
      throw new Error("Expected file changes but none were found in final state");
    }
    if (predicate && !predicate(changes)) {
      throw new Error(
        `File changes predicate failed. Changes: ${JSON.stringify(changes)}`
      );
    }
    return this;
  }

  /**
   * Assert agent made no file changes.
   */
  hasNoFileChanges(): this {
    const lastState = this.output.states[this.output.states.length - 1];
    const changes = lastState?.state.fileChanges ?? [];
    if (changes.length > 0) {
      throw new Error(
        `Expected no file changes but found: ${JSON.stringify(changes)}`
      );
    }
    return this;
  }

  /**
   * Assert agent used all of the specified tools.
   * Checks toolName field in tool states (not the keys, which are UUIDs).
   */
  usedTools(toolNames: string[]): this {
    const usedToolNames = new Set<string>();

    for (const state of this.output.states) {
      const toolStates = state.state.toolStates ?? {};
      for (const toolState of Object.values(toolStates) as ToolExecutionState[]) {
        if (toolState.toolName) {
          usedToolNames.add(toolState.toolName);
        }
      }
    }

    const missing = toolNames.filter((name) => !usedToolNames.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Tools not used: [${missing.join(", ")}]. ` +
        `Used tools: [${Array.from(usedToolNames).join(", ")}]`
      );
    }
    return this;
  }

  /**
   * Assert agent did not use any of the specified tools.
   */
  didNotUseTools(toolNames: string[]): this {
    const usedToolNames = new Set<string>();

    for (const state of this.output.states) {
      const toolStates = state.state.toolStates ?? {};
      for (const toolState of Object.values(toolStates) as ToolExecutionState[]) {
        if (toolState.toolName) {
          usedToolNames.add(toolState.toolName);
        }
      }
    }

    const found = toolNames.filter((name) => usedToolNames.has(name));
    if (found.length > 0) {
      throw new Error(`Expected tools not to be used but found: [${found.join(", ")}]`);
    }
    return this;
  }

  /**
   * Assert a log message exists at the specified level.
   * Optionally match the message content with a regex pattern.
   */
  hasLog(
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    messagePattern?: RegExp
  ): this {
    const log = this.output.logs.find((l) => {
      if (l.level !== level) return false;
      if (messagePattern && !messagePattern.test(l.message)) return false;
      return true;
    });
    if (!log) {
      const patternDesc = messagePattern ? ` matching ${messagePattern}` : "";
      throw new Error(
        `Expected ${level} log${patternDesc} not found. ` +
          `Log count by level: DEBUG=${this.countLogs("DEBUG")}, ` +
          `INFO=${this.countLogs("INFO")}, WARN=${this.countLogs("WARN")}, ` +
          `ERROR=${this.countLogs("ERROR")}`
      );
    }
    return this;
  }

  /**
   * Assert no error-level logs were emitted.
   */
  hasNoErrorLogs(): this {
    const errorLogs = this.output.logs.filter((l) => l.level === "ERROR");
    if (errorLogs.length > 0) {
      throw new Error(
        `Expected no error logs but found ${errorLogs.length}: ` +
          errorLogs.map((l) => l.message).join("; ")
      );
    }
    return this;
  }

  /**
   * Assert agent completed within the specified duration.
   */
  completedWithin(maxMs: number): this {
    if (this.output.durationMs > maxMs) {
      throw new Error(
        `Expected completion within ${maxMs}ms, took ${this.output.durationMs}ms`
      );
    }
    return this;
  }

  /**
   * Get the raw output for custom assertions.
   */
  getOutput(): AgentRunOutput {
    return this.output;
  }

  private countLogs(level: string): number {
    return this.output.logs.filter((l) => l.level === level).length;
  }
}

/**
 * Create fluent assertions for agent test output.
 *
 * @example
 * assertAgent(output)
 *   .succeeded()
 *   .hasEvent("thread:created")
 *   .completedWithin(30000);
 */
export function assertAgent(output: AgentRunOutput): AgentAssertions {
  return new AgentAssertions(output);
}

// ============ Socket-based assertion helpers ============

/**
 * Assert that the MockHubServer received a state matching the predicate.
 *
 * @param hub - The MockHubServer instance
 * @param threadId - The thread ID to filter messages by
 * @param predicate - Function to test each state
 * @throws Error if no matching state is found
 *
 * @example
 * assertReceivedState(hub, "thread-123", (state) => state.status === "completed");
 */
export function assertReceivedState(
  hub: MockHubServer,
  threadId: string,
  predicate: (state: unknown) => boolean
): void {
  const messages = hub.getMessagesForThread(threadId);
  const stateMessages = messages.filter(
    (m): m is StateMessage => m.type === "state"
  );

  const matchingState = stateMessages.find((msg) => predicate(msg.state));

  if (!matchingState) {
    const stateCount = stateMessages.length;
    const stateSummary = stateMessages
      .slice(-5) // Show last 5 states for debugging
      .map((s) => JSON.stringify(s.state))
      .join("\n  ");

    throw new Error(
      `No state matching predicate found for thread ${threadId}.\n` +
        `Total state messages: ${stateCount}\n` +
        `Last ${Math.min(5, stateCount)} states:\n  ${stateSummary || "(none)"}`
    );
  }
}

/**
 * Assert that the MockHubServer received an event with the specified name.
 *
 * @param hub - The MockHubServer instance
 * @param threadId - The thread ID to filter messages by
 * @param eventName - The event name to look for
 * @param payloadPredicate - Optional function to validate the event payload
 * @throws Error if no matching event is found
 *
 * @example
 * assertReceivedEvent(hub, "thread-123", "thread:created");
 * assertReceivedEvent(hub, "thread-123", "file:changed", (p) => p.path === "/foo/bar.ts");
 */
export function assertReceivedEvent(
  hub: MockHubServer,
  threadId: string,
  eventName: string,
  payloadPredicate?: (payload: unknown) => boolean
): void {
  const messages = hub.getMessagesForThread(threadId);
  const eventMessages = messages.filter(
    (m): m is EventMessage => m.type === "event"
  );

  const matchingEvent = eventMessages.find((msg) => {
    if (msg.name !== eventName) return false;
    if (payloadPredicate && !payloadPredicate(msg.payload)) return false;
    return true;
  });

  if (!matchingEvent) {
    const eventNames = eventMessages.map((e) => e.name);
    const uniqueNames = [...new Set(eventNames)];

    throw new Error(
      `Event "${eventName}" not found for thread ${threadId}.\n` +
        `Received events: [${uniqueNames.join(", ") || "(none)"}]`
    );
  }
}

/**
 * Assert that the MockHubServer received a registration message from the thread.
 *
 * @param hub - The MockHubServer instance
 * @param threadId - The thread ID to check
 * @throws Error if no registration was received
 *
 * @example
 * assertReceivedRegistration(hub, "thread-123");
 */
export function assertReceivedRegistration(
  hub: MockHubServer,
  threadId: string
): void {
  const messages = hub.getMessagesForThread(threadId);
  const registration = messages.find((m) => m.type === "register");

  if (!registration) {
    throw new Error(
      `No registration message received for thread ${threadId}.\n` +
        `Total messages for thread: ${messages.length}`
    );
  }
}

/**
 * Assert that the MockHubServer received events in the specified order.
 *
 * @param hub - The MockHubServer instance
 * @param threadId - The thread ID to filter messages by
 * @param eventNames - Array of event names in expected order
 * @throws Error if events are not found in the expected order
 *
 * @example
 * assertReceivedEventsInOrder(hub, "thread-123", ["thread:started", "tool:executed", "thread:completed"]);
 */
export function assertReceivedEventsInOrder(
  hub: MockHubServer,
  threadId: string,
  eventNames: string[]
): void {
  const messages = hub.getMessagesForThread(threadId);
  const eventMessages = messages.filter(
    (m): m is EventMessage => m.type === "event"
  );

  const receivedNames = eventMessages.map((e) => e.name);
  let lastIndex = -1;

  for (const name of eventNames) {
    const index = receivedNames.indexOf(name, lastIndex + 1);
    if (index === -1) {
      throw new Error(
        `Event "${name}" not found after position ${lastIndex}.\n` +
          `Event sequence: [${receivedNames.join(", ")}]`
      );
    }
    lastIndex = index;
  }
}

/**
 * Get the final state sent by an agent to the MockHubServer.
 *
 * @param hub - The MockHubServer instance
 * @param threadId - The thread ID to get state for
 * @returns The state from the last state message, or undefined if no states received
 *
 * @example
 * const finalState = getFinalState(hub, "thread-123");
 * expect(finalState?.status).toBe("completed");
 */
export function getFinalState(
  hub: MockHubServer,
  threadId: string
): unknown | undefined {
  const messages = hub.getMessagesForThread(threadId);
  const stateMessages = messages.filter(
    (m): m is StateMessage => m.type === "state"
  );

  if (stateMessages.length === 0) {
    return undefined;
  }

  return stateMessages[stateMessages.length - 1].state;
}

/**
 * Get all events of a specific type sent by an agent.
 *
 * @param hub - The MockHubServer instance
 * @param threadId - The thread ID to filter by
 * @param eventName - Optional event name to filter by
 * @returns Array of event messages
 *
 * @example
 * const toolEvents = getEvents(hub, "thread-123", "tool:executed");
 */
export function getEvents(
  hub: MockHubServer,
  threadId: string,
  eventName?: string
): EventMessage[] {
  const messages = hub.getMessagesForThread(threadId);
  const eventMessages = messages.filter(
    (m): m is EventMessage => m.type === "event"
  );

  if (eventName) {
    return eventMessages.filter((e) => e.name === eventName);
  }

  return eventMessages;
}
