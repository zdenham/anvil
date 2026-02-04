import * as fs from 'fs/promises';
import * as path from 'path';
import type { PlanService, PlanInfo } from '../../types.js';
import type { EmitEvent } from '../index.js';

export function createPlanService(mortDir: string, emitEvent: EmitEvent): PlanService {
  const plansIndexPath = path.join(mortDir, 'plans-index.json');

  async function readPlansIndex(): Promise<Record<string, PlanInfo>> {
    try {
      const content = await fs.readFile(plansIndexPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  return {
    async get(planId: string): Promise<PlanInfo | null> {
      const index = await readPlansIndex();
      return index[planId] ?? null;
    },

    async list(): Promise<PlanInfo[]> {
      const index = await readPlansIndex();
      return Object.values(index);
    },

    async getByRepo(repoId: string): Promise<PlanInfo[]> {
      const all = await this.list();
      return all.filter(p => p.repoId === repoId);
    },

    async readContent(planId: string): Promise<string> {
      const plan = await this.get(planId);
      if (!plan) throw new Error(`Plan not found: ${planId}`);

      // Plan content is stored in the repository at relativePath
      // This requires knowing the worktree path - may need adjustment
      throw new Error('readContent requires worktree path - not yet implemented');
    },

    async archive(planId: string): Promise<void> {
      emitEvent('plan:archive', { planId });
    },
  };
}
