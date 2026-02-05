import type { QuickActionEvent } from './runner-spawn.js';

/**
 * EventCollector provides query and assertion methods for testing
 * quick action events emitted via stdout.
 */
export class EventCollector {
  constructor(public readonly events: QuickActionEvent[]) {}

  /**
   * Get all events of a specific type.
   */
  getByType(eventType: string): QuickActionEvent[] {
    return this.events.filter(e => e.event === eventType);
  }

  /**
   * Get the first event of a specific type.
   */
  first(eventType: string): QuickActionEvent | undefined {
    return this.events.find(e => e.event === eventType);
  }

  /**
   * Get the last event of a specific type.
   */
  last(eventType: string): QuickActionEvent | undefined {
    const matching = this.getByType(eventType);
    return matching[matching.length - 1];
  }

  /**
   * Count events, optionally filtered by type.
   */
  count(eventType?: string): number {
    if (eventType) {
      return this.getByType(eventType).length;
    }
    return this.events.length;
  }

  /**
   * Check if an event of the given type exists.
   */
  has(eventType: string): boolean {
    return this.events.some(e => e.event === eventType);
  }

  /**
   * Assert that an event of the given type was emitted.
   * Optionally checks payload matches expected value.
   * Throws if assertion fails.
   */
  expectEvent(eventType: string, expectedPayload?: unknown): void {
    const event = this.first(eventType);
    if (!event) {
      const available = [...new Set(this.events.map(e => e.event))].join(', ');
      throw new Error(
        `Expected event '${eventType}' but it was not emitted.\n` +
        `Available events: ${available || '(none)'}`
      );
    }

    if (expectedPayload !== undefined) {
      // Deep compare payload
      const payloadStr = JSON.stringify(event.payload);
      const expectedStr = JSON.stringify(expectedPayload);

      if (payloadStr !== expectedStr) {
        throw new Error(
          `Event '${eventType}' payload mismatch.\n` +
          `Expected: ${expectedStr}\n` +
          `Actual: ${payloadStr}`
        );
      }
    }
  }

  /**
   * Assert that an event of the given type was emitted with payload matching pattern.
   * Uses partial matching - expected fields must match, extra fields are ignored.
   */
  expectEventMatching(eventType: string, partialPayload: Record<string, unknown>): void {
    const event = this.first(eventType);
    if (!event) {
      const available = [...new Set(this.events.map(e => e.event))].join(', ');
      throw new Error(
        `Expected event '${eventType}' but it was not emitted.\n` +
        `Available events: ${available || '(none)'}`
      );
    }

    const payload = event.payload as Record<string, unknown>;
    for (const [key, expectedValue] of Object.entries(partialPayload)) {
      const actualValue = payload[key];
      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        throw new Error(
          `Event '${eventType}' payload field '${key}' mismatch.\n` +
          `Expected: ${JSON.stringify(expectedValue)}\n` +
          `Actual: ${JSON.stringify(actualValue)}`
        );
      }
    }
  }

  /**
   * Assert that events were emitted in the specified order.
   * Only checks the sequence of event types, not their payloads.
   */
  expectEventSequence(eventTypes: string[]): void {
    let lastIndex = -1;

    for (const eventType of eventTypes) {
      const index = this.events.findIndex((e, i) => i > lastIndex && e.event === eventType);
      if (index === -1) {
        const remaining = this.events.slice(lastIndex + 1).map(e => e.event);
        throw new Error(
          `Expected event '${eventType}' in sequence but not found.\n` +
          `Remaining events after index ${lastIndex}: ${remaining.join(', ') || '(none)'}`
        );
      }
      lastIndex = index;
    }
  }

  /**
   * Assert that an event of the given type was NOT emitted.
   */
  expectNoEvent(eventType: string): void {
    const event = this.first(eventType);
    if (event) {
      throw new Error(
        `Expected no event '${eventType}' but it was emitted.\n` +
        `Payload: ${JSON.stringify(event.payload)}`
      );
    }
  }

  /**
   * Assert that an error event was emitted.
   * Optionally checks error message matches pattern.
   */
  expectError(messagePattern?: string | RegExp): void {
    const errorEvent = this.first('error');
    if (!errorEvent) {
      throw new Error(
        `Expected error event but none was emitted.\n` +
        `Events: ${this.events.map(e => e.event).join(', ') || '(none)'}`
      );
    }

    if (messagePattern) {
      const payload = errorEvent.payload as { message?: string };
      const message = payload.message || '';

      if (typeof messagePattern === 'string') {
        if (!message.includes(messagePattern)) {
          throw new Error(
            `Error message does not contain expected text.\n` +
            `Expected to contain: ${messagePattern}\n` +
            `Actual: ${message}`
          );
        }
      } else {
        if (!messagePattern.test(message)) {
          throw new Error(
            `Error message does not match pattern.\n` +
            `Pattern: ${messagePattern}\n` +
            `Actual: ${message}`
          );
        }
      }
    }
  }

  /**
   * Assert that no error events were emitted.
   */
  expectNoError(): void {
    const errorEvent = this.first('error');
    if (errorEvent) {
      const payload = errorEvent.payload as { message?: string };
      throw new Error(
        `Expected no error but got: ${payload.message || JSON.stringify(errorEvent.payload)}`
      );
    }
  }

  /**
   * Get all log events.
   */
  getLogs(): Array<{ level: string; message: string; data?: unknown }> {
    return this.getByType('log').map(e => e.payload as { level: string; message: string; data?: unknown });
  }

  /**
   * Assert a log message was emitted at the specified level.
   */
  expectLog(level: 'info' | 'warn' | 'error' | 'debug', messagePattern?: string | RegExp): void {
    const logs = this.getLogs();
    const matching = logs.filter(l => l.level === level);

    if (matching.length === 0) {
      throw new Error(
        `Expected log at level '${level}' but none found.\n` +
        `Available logs: ${logs.map(l => `[${l.level}] ${l.message}`).join(', ') || '(none)'}`
      );
    }

    if (messagePattern) {
      const found = matching.some(l => {
        if (typeof messagePattern === 'string') {
          return l.message.includes(messagePattern);
        }
        return messagePattern.test(l.message);
      });

      if (!found) {
        throw new Error(
          `No log at level '${level}' matches pattern.\n` +
          `Pattern: ${messagePattern}\n` +
          `${level} logs: ${matching.map(l => l.message).join(', ')}`
        );
      }
    }
  }

  /**
   * Create an EventCollector from a list of events.
   */
  static from(events: QuickActionEvent[]): EventCollector {
    return new EventCollector(events);
  }
}
