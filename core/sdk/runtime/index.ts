import type { AnvilSDK } from '../types.js';
import { createGitService } from './services/git.js';
import { createThreadService } from './services/threads.js';
import { createPlanService } from './services/plans.js';
import { createUIService } from './services/ui.js';
import { createLogService } from './services/log.js';

export type EmitEvent = (event: string, payload: unknown) => void;

export function createSDK(
  anvilDir: string,
  emitEvent: EmitEvent
): AnvilSDK {
  return {
    git: createGitService(),
    threads: createThreadService(anvilDir, emitEvent),
    plans: createPlanService(anvilDir, emitEvent),
    ui: createUIService(emitEvent),
    log: createLogService(emitEvent),
  };
}
