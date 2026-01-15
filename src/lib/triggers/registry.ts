import { logger } from "@/lib/logger-client";
import type { TriggerHandler } from "./types";

export class TriggerRegistry {
  private handlers = new Map<string, TriggerHandler>();
  private static instance: TriggerRegistry | null = null;

  // Singleton accessor for app-wide use
  static getInstance(): TriggerRegistry {
    if (!TriggerRegistry.instance) {
      TriggerRegistry.instance = new TriggerRegistry();
    }
    return TriggerRegistry.instance;
  }

  // Reset for testing
  static resetInstance(): void {
    TriggerRegistry.instance = null;
  }

  register(handler: TriggerHandler): void {
    if (this.handlers.has(handler.config.char)) {
      logger.warn(
        `Overwriting existing handler for trigger char: ${handler.config.char}`
      );
    }
    this.handlers.set(handler.config.char, handler);
  }

  unregister(char: string): void {
    this.handlers.delete(char);
  }

  getHandler(char: string): TriggerHandler | undefined {
    return this.handlers.get(char);
  }

  isTrigger(char: string): boolean {
    return this.handlers.has(char);
  }

  getTriggerChars(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// Default singleton export for production use
export const triggerRegistry = TriggerRegistry.getInstance();
