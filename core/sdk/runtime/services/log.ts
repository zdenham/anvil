import type { LogService } from '../../types.js';
import type { EmitEvent } from '../index.js';

export function createLogService(emitEvent: EmitEvent): LogService {
  return {
    info(message: string, data?: Record<string, unknown>): void {
      emitEvent('log', { level: 'info', message, data });
    },

    warn(message: string, data?: Record<string, unknown>): void {
      emitEvent('log', { level: 'warn', message, data });
    },

    error(message: string, data?: Record<string, unknown>): void {
      emitEvent('log', { level: 'error', message, data });
    },

    debug(message: string, data?: Record<string, unknown>): void {
      emitEvent('log', { level: 'debug', message, data });
    },
  };
}
