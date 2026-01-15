import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BranchService } from './branch-service';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

/** Integration tests for BranchService using real git operations. */
describe('BranchService', () => {
  let service: BranchService;
  let testDir: string;
  let repoPath: string;

  function git(args: string[], cwd: string): string {
    const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
    if (result.status !== 0) {
      throw new Error(`git ${args[0]} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  beforeEach(() => {
    service = new BranchService();
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'branch-service-test-')));
    repoPath = join(testDir, 'repo');

    mkdirSync(repoPath);
    git(['init'], repoPath);
    git(['config', 'user.email', 'test@test.com'], repoPath);
    git(['config', 'user.name', 'Test User'], repoPath);
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n');
    git(['add', '.'], repoPath);
    git(['commit', '-m', 'Initial commit'], repoPath);
  });

  afterEach(() => rmSync(testDir, { recursive: true, force: true }));

  describe('create', () => {
    it('should create branch at HEAD', () => {
      service.create(repoPath, 'new-branch', 'HEAD');

      const branches = git(['branch', '--list', 'new-branch'], repoPath);
      expect(branches).toContain('new-branch');
    });

    it('should create branch at specific commit', () => {
      writeFileSync(join(repoPath, 'second.txt'), 'second');
      git(['add', '.'], repoPath);
      git(['commit', '-m', 'Second commit'], repoPath);
      const firstCommit = git(['rev-parse', 'HEAD~1'], repoPath);

      service.create(repoPath, 'from-first', firstCommit);

      const branchCommit = git(['rev-parse', 'from-first'], repoPath);
      expect(branchCommit).toBe(firstCommit);
    });

    it('should throw when creating duplicate branch', () => {
      service.create(repoPath, 'duplicate-branch', 'HEAD');

      expect(() => {
        service.create(repoPath, 'duplicate-branch', 'HEAD');
      }).toThrow();
    });
  });

  describe('delete', () => {
    it('should delete merged branch', () => {
      git(['branch', 'to-delete'], repoPath);

      service.delete(repoPath, 'to-delete');

      const branches = git(['branch', '--list', 'to-delete'], repoPath);
      expect(branches).toBe('');
    });

    it('should throw when deleting unmerged branch without force', () => {
      git(['branch', 'unmerged'], repoPath);
      git(['checkout', 'unmerged'], repoPath);
      writeFileSync(join(repoPath, 'unmerged.txt'), 'content');
      git(['add', '.'], repoPath);
      git(['commit', '-m', 'Unmerged commit'], repoPath);
      git(['checkout', '-'], repoPath);

      expect(() => {
        service.delete(repoPath, 'unmerged');
      }).toThrow();
    });

    it('should force delete unmerged branch', () => {
      git(['branch', 'unmerged-force'], repoPath);
      git(['checkout', 'unmerged-force'], repoPath);
      writeFileSync(join(repoPath, 'unmerged.txt'), 'content');
      git(['add', '.'], repoPath);
      git(['commit', '-m', 'Unmerged commit'], repoPath);
      git(['checkout', '-'], repoPath);

      service.delete(repoPath, 'unmerged-force', { force: true });

      const branches = git(['branch', '--list', 'unmerged-force'], repoPath);
      expect(branches).toBe('');
    });

    it('should throw when deleting nonexistent branch', () => {
      expect(() => {
        service.delete(repoPath, 'nonexistent');
      }).toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing branch', () => {
      git(['branch', 'existing-branch'], repoPath);

      const result = service.exists(repoPath, 'existing-branch');

      expect(result).toBe(true);
    });

    it('should return false for non-existent branch', () => {
      const result = service.exists(repoPath, 'nonexistent-branch');

      expect(result).toBe(false);
    });

    it('should return true for current branch', () => {
      const currentBranch = git(['branch', '--show-current'], repoPath);

      const result = service.exists(repoPath, currentBranch);

      expect(result).toBe(true);
    });
  });

  describe('list', () => {
    it('should return all local branches', () => {
      git(['branch', 'branch-a'], repoPath);
      git(['branch', 'branch-b'], repoPath);

      const branches = service.list(repoPath);

      expect(branches).toContain('branch-a');
      expect(branches).toContain('branch-b');
      expect(branches.length).toBeGreaterThanOrEqual(3);
    });

    it('should return current branch in list', () => {
      const currentBranch = git(['branch', '--show-current'], repoPath);

      const branches = service.list(repoPath);

      expect(branches).toContain(currentBranch);
    });
  });

  describe('input validation', () => {
    it('should reject empty branch name', () => {
      expect(() => service.create(repoPath, '', 'HEAD')).toThrow('cannot be empty');
      expect(() => service.delete(repoPath, '')).toThrow('cannot be empty');
      expect(() => service.exists(repoPath, '')).toThrow('cannot be empty');
    });

    it('should reject branch name with double dots', () => {
      expect(() => service.create(repoPath, 'branch..name', 'HEAD'))
        .toThrow("contains '..'");
    });

    it('should reject branch name with tilde', () => {
      expect(() => service.create(repoPath, 'branch~name', 'HEAD'))
        .toThrow("contains '~'");
    });

    it('should reject branch name with caret', () => {
      expect(() => service.create(repoPath, 'branch^name', 'HEAD'))
        .toThrow("contains '^'");
    });

    it('should reject branch name with colon', () => {
      expect(() => service.create(repoPath, 'branch:name', 'HEAD'))
        .toThrow("contains ':'");
    });

    it('should reject branch name with backslash', () => {
      expect(() => service.create(repoPath, 'branch\\name', 'HEAD'))
        .toThrow("contains '\\'");
    });

    it('should reject branch name starting with dash', () => {
      expect(() => service.create(repoPath, '-branch', 'HEAD'))
        .toThrow("starts with '-'");
    });

    it('should reject branch name ending with .lock', () => {
      expect(() => service.create(repoPath, 'branch.lock', 'HEAD'))
        .toThrow("ends with '.lock'");
    });

    it('should reject branch name with @{', () => {
      expect(() => service.create(repoPath, 'branch@{name', 'HEAD'))
        .toThrow("contains '@{'");
    });

    it('should reject branch name with spaces', () => {
      expect(() => service.create(repoPath, 'branch name', 'HEAD'))
        .toThrow('contains spaces');
    });

    it('should reject branch name with control characters', () => {
      expect(() => service.create(repoPath, 'branch\x00name', 'HEAD'))
        .toThrow('contains control characters');
      expect(() => service.create(repoPath, 'branch\x1fname', 'HEAD'))
        .toThrow('contains control characters');
    });

    it('should reject command injection attempts with spaces', () => {
      // Command injection with spaces is rejected by space validation
      expect(() => service.create(repoPath, '; rm -rf /', 'HEAD'))
        .toThrow('contains spaces');
      expect(() => service.create(repoPath, '| cat /etc/passwd', 'HEAD'))
        .toThrow('contains spaces');
    });

    it('should safely handle shell metacharacters via spawnSync array args', () => {
      // These branch names don't violate git ref format rules, but command
      // injection is still prevented because we use spawnSync with array args
      // (no shell expansion). Git will just create branches with these literal names.
      service.create(repoPath, '$(whoami)', 'HEAD');
      expect(service.exists(repoPath, '$(whoami)')).toBe(true);

      service.create(repoPath, '`id`', 'HEAD');
      expect(service.exists(repoPath, '`id`')).toBe(true);

      // Clean up
      service.delete(repoPath, '$(whoami)');
      service.delete(repoPath, '`id`');
    });
  });
});
