import * as fs from 'fs/promises';
import * as path from 'path';
import type { ThreadService, ThreadInfo } from '../../types.js';
import type { EmitEvent } from '../index.js';

export function createThreadService(mortDir: string, emitEvent: EmitEvent): ThreadService {
  const threadsDir = path.join(mortDir, 'threads');

  async function readThreadMeta(threadId: string): Promise<ThreadInfo | null> {
    try {
      const metaPath = path.join(threadsDir, threadId, 'meta.json');
      const content = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(content);
      return {
        id: threadId,
        repoId: meta.repoId,
        worktreeId: meta.worktreeId,
        status: meta.status,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        isRead: meta.isRead ?? true,
        turnCount: meta.turnCount ?? 0,
      };
    } catch {
      return null;
    }
  }

  return {
    async get(threadId: string): Promise<ThreadInfo | null> {
      return readThreadMeta(threadId);
    },

    async list(): Promise<ThreadInfo[]> {
      try {
        const entries = await fs.readdir(threadsDir, { withFileTypes: true });
        const threads: ThreadInfo[] = [];
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const thread = await readThreadMeta(entry.name);
            if (thread) threads.push(thread);
          }
        }
        return threads;
      } catch {
        return [];
      }
    },

    async getByRepo(repoId: string): Promise<ThreadInfo[]> {
      const all = await this.list();
      return all.filter(t => t.repoId === repoId);
    },

    async getUnread(): Promise<ThreadInfo[]> {
      const all = await this.list();
      return all.filter(t => !t.isRead);
    },

    async archive(threadId: string): Promise<void> {
      emitEvent('thread:archive', { threadId });
    },

    async markRead(threadId: string): Promise<void> {
      emitEvent('thread:markRead', { threadId });
    },

    async markUnread(threadId: string): Promise<void> {
      emitEvent('thread:markUnread', { threadId });
    },
  };
}
