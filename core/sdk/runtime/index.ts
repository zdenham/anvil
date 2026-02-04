import type { MortSDK } from '../types.js';
import { createGitService } from './services/git.js';
import { createThreadService } from './services/threads.js';
import { createPlanService } from './services/plans.js';
import { createUIService } from './services/ui.js';
import { createLogService } from './services/log.js';

export type EmitEvent = (event: string, payload: unknown) => void;

export function createSDK(
  mortDir: string,
  emitEvent: EmitEvent
): MortSDK {
  return {
    git: createGitService(),
    threads: createThreadService(mortDir, emitEvent),
    plans: createPlanService(mortDir, emitEvent),
    ui: createUIService(emitEvent),
    log: createLogService(emitEvent),
  };
}
