import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Page } from '@playwright/test';
import { invokeWsCommand } from './wait-helpers';

export class RepoHarness {
  readonly repoPath: string;

  private constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  static async create(): Promise<RepoHarness> {
    const repoPath = mkdtempSync(join(tmpdir(), 'anvil-e2e-'));
    execSync('git init', { cwd: repoPath });
    execSync('git config user.email "test@test.com"', { cwd: repoPath });
    execSync('git config user.name "Test"', { cwd: repoPath });
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n');
    execSync('git add -A && git commit -m "initial commit"', { cwd: repoPath });

    return new RepoHarness(repoPath);
  }

  async register(page: Page): Promise<{ repoId: string; worktreeId: string }> {
    return invokeWsCommand<{ repoId: string; worktreeId: string }>(
      page,
      'validate_repository',
      { path: this.repoPath },
    );
  }

  async addFile(relativePath: string, content: string): Promise<void> {
    const fullPath = join(this.repoPath, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir !== this.repoPath) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content);
  }

  async commit(message: string): Promise<void> {
    execSync(`git add -A && git commit -m "${message}"`, { cwd: this.repoPath });
  }

  async cleanup(): Promise<void> {
    rmSync(this.repoPath, { recursive: true, force: true });
  }
}
