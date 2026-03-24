import * as fs from 'fs/promises';
import * as path from 'path';
import type { PlanService, PlanInfo } from '../../types.js';
import type { EmitEvent } from '../index.js';

/**
 * Internal plan index entry with worktreePath for file access.
 * The worktreePath is needed to resolve the plan content file path.
 */
interface PlansIndexEntry {
  id: string;
  repoId: string;
  worktreeId: string;
  worktreePath: string;  // Needed to resolve plan content path
  relativePath: string;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}

export function createPlanService(anvilDir: string, emitEvent: EmitEvent): PlanService {
  const plansIndexPath = path.join(anvilDir, 'plans-index.json');

  async function readPlansIndex(): Promise<Record<string, PlansIndexEntry>> {
    try {
      const content = await fs.readFile(plansIndexPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  function toPlanInfo(entry: PlansIndexEntry): PlanInfo {
    return {
      id: entry.id,
      repoId: entry.repoId,
      worktreeId: entry.worktreeId,
      relativePath: entry.relativePath,
      isRead: entry.isRead,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  return {
    async get(planId: string): Promise<PlanInfo | null> {
      const index = await readPlansIndex();
      const entry = index[planId];
      return entry ? toPlanInfo(entry) : null;
    },

    async list(): Promise<PlanInfo[]> {
      const index = await readPlansIndex();
      return Object.values(index).map(toPlanInfo);
    },

    async getByRepo(repoId: string): Promise<PlanInfo[]> {
      const all = await this.list();
      return all.filter(p => p.repoId === repoId);
    },

    async readContent(planId: string): Promise<string> {
      const index = await readPlansIndex();
      const entry = index[planId];
      if (!entry) {
        throw new Error(`Plan not found: ${planId}`);
      }

      // Plan content is stored in the worktree at relativePath
      const planPath = path.join(entry.worktreePath, entry.relativePath);
      return fs.readFile(planPath, 'utf-8');
    },

    async archive(planId: string): Promise<void> {
      emitEvent('plan:archive', { planId });
    },

    async markUnread(planId: string): Promise<void> {
      emitEvent('plan:markUnread', { planId });
    },
  };
}
