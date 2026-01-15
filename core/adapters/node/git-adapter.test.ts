import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeGitAdapter } from './git-adapter';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

/** Integration tests for NodeGitAdapter using real git operations. */
describe('NodeGitAdapter', () => {
  let adapter: NodeGitAdapter;
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
    adapter = new NodeGitAdapter();
    // Use realpathSync to resolve symlinks (e.g., /tmp -> /private/tmp on macOS)
    // This ensures paths match what git returns in worktree list
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'git-adapter-test-')));
    repoPath = join(testDir, 'repo');

    // Initialize a test repository with a commit
    mkdirSync(repoPath);
    git(['init'], repoPath);
    git(['config', 'user.email', 'test@test.com'], repoPath);
    git(['config', 'user.name', 'Test User'], repoPath);
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n');
    git(['add', '.'], repoPath);
    git(['commit', '-m', 'Initial commit'], repoPath);
  });

  afterEach(() => rmSync(testDir, { recursive: true, force: true }));

  describe('createWorktree', () => {
    it('should create worktree at specific commit', () => {
      const commitSha = git(['rev-parse', 'HEAD'], repoPath);
      const worktreePath = join(testDir, 'worktree1');

      adapter.createWorktree(repoPath, worktreePath, { commit: commitSha });
      const worktrees = adapter.listWorktrees(repoPath);
      const created = worktrees.find(w => w.path === worktreePath);
      expect(created).toBeDefined();
      expect(created?.commit).toBe(commitSha);
    });

    it('should create worktree with new branch', () => {
      const worktreePath = join(testDir, 'worktree-branch');

      adapter.createWorktree(repoPath, worktreePath, { branch: 'feature-branch' });

      const worktrees = adapter.listWorktrees(repoPath);
      const created = worktrees.find(w => w.path === worktreePath);
      expect(created).toBeDefined();
      expect(created?.branch).toBe('feature-branch');
    });

    it('should throw on invalid commit', () => {
      const worktreePath = join(testDir, 'worktree-invalid');

      expect(() => {
        adapter.createWorktree(repoPath, worktreePath, { commit: 'invalid-sha' });
      }).toThrow();
    });
  });

  describe('removeWorktree', () => {
    it('should remove worktree normally', () => {
      const worktreePath = join(testDir, 'worktree-to-remove');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'to-remove' });

      adapter.removeWorktree(repoPath, worktreePath);

      const worktrees = adapter.listWorktrees(repoPath);
      const removed = worktrees.find(w => w.path === worktreePath);
      expect(removed).toBeUndefined();
    });

    it('should force remove worktree with local changes', () => {
      const worktreePath = join(testDir, 'worktree-dirty');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'dirty-branch' });
      writeFileSync(join(worktreePath, 'dirty.txt'), 'uncommitted'); // Make uncommitted changes
      adapter.removeWorktree(repoPath, worktreePath, { force: true });

      const worktrees = adapter.listWorktrees(repoPath);
      const removed = worktrees.find(w => w.path === worktreePath);
      expect(removed).toBeUndefined();
    });
  });

  describe('listWorktrees', () => {
    it('should list main worktree', () => {
      const worktrees = adapter.listWorktrees(repoPath);

      expect(worktrees.length).toBeGreaterThanOrEqual(1);
      const main = worktrees.find(w => w.path === repoPath);
      expect(main).toBeDefined();
    });

    it('should parse detached HEAD correctly', () => {
      const commitSha = git(['rev-parse', 'HEAD'], repoPath);
      const worktreePath = join(testDir, 'detached-worktree');
      adapter.createWorktree(repoPath, worktreePath, { commit: commitSha });

      const worktrees = adapter.listWorktrees(repoPath);
      const detached = worktrees.find(w => w.path === worktreePath);

      expect(detached).toBeDefined();
      expect(detached?.branch).toBeNull();
      expect(detached?.commit).toBe(commitSha);
    });

    it('should parse multiple worktrees', () => {
      adapter.createWorktree(repoPath, join(testDir, 'wt1'), { branch: 'branch1' });
      adapter.createWorktree(repoPath, join(testDir, 'wt2'), { branch: 'branch2' });

      const worktrees = adapter.listWorktrees(repoPath);

      expect(worktrees.length).toBe(3); // main + 2 created
    });
  });

  describe('getDefaultBranch', () => {
    it('should return main when it exists', () => {
      const defaultBranch = adapter.getDefaultBranch(repoPath);
      expect(['main', 'master']).toContain(defaultBranch);
    });

    it('should fall back to master if main does not exist', () => {
      const masterRepo = join(testDir, 'master-repo');
      mkdirSync(masterRepo);
      git(['init', '-b', 'master'], masterRepo);
      git(['config', 'user.email', 'test@test.com'], masterRepo);
      git(['config', 'user.name', 'Test User'], masterRepo);
      writeFileSync(join(masterRepo, 'file.txt'), 'content');
      git(['add', '.'], masterRepo);
      git(['commit', '-m', 'Initial'], masterRepo);
      const defaultBranch = adapter.getDefaultBranch(masterRepo);
      expect(defaultBranch).toBe('master');
    });
  });

  describe('getBranchCommit', () => {
    it('should return commit SHA for branch', () => {
      const expectedSha = git(['rev-parse', 'HEAD'], repoPath);
      const currentBranch = git(['branch', '--show-current'], repoPath);
      const sha = adapter.getBranchCommit(repoPath, currentBranch);
      expect(sha).toBe(expectedSha);
    });

    it('should throw for nonexistent branch', () => {
      expect(() => {
        adapter.getBranchCommit(repoPath, 'nonexistent-branch');
      }).toThrow();
    });
  });

  describe('checkoutCommit', () => {
    it('should checkout commit with detached HEAD', () => {
      const worktreePath = join(testDir, 'checkout-test');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'checkout-branch' });
      writeFileSync(join(worktreePath, 'new.txt'), 'new content');
      git(['add', '.'], worktreePath);
      git(['commit', '-m', 'Second commit'], worktreePath);
      const firstCommit = git(['rev-parse', 'HEAD~1'], worktreePath);
      adapter.checkoutCommit(worktreePath, firstCommit);
      const currentCommit = git(['rev-parse', 'HEAD'], worktreePath);
      expect(currentCommit).toBe(firstCommit);
    });
  });

  describe('checkoutBranch', () => {
    it('should checkout existing branch', () => {
      const worktreePath = join(testDir, 'branch-checkout');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'feature' });
      git(['branch', 'other-branch'], repoPath);
      adapter.checkoutBranch(worktreePath, 'other-branch');
      const currentBranch = git(['branch', '--show-current'], worktreePath);
      expect(currentBranch).toBe('other-branch');
    });

    it('should throw for nonexistent branch', () => {
      const worktreePath = join(testDir, 'branch-checkout-fail');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'temp-branch' });

      expect(() => {
        adapter.checkoutBranch(worktreePath, 'nonexistent');
      }).toThrow();
    });
  });

  describe('getMergeBase', () => {
    it('should find merge base between two branches', () => {
      const initialCommit = git(['rev-parse', 'HEAD'], repoPath);
      git(['branch', 'branch-a'], repoPath);
      git(['branch', 'branch-b'], repoPath);
      git(['checkout', 'branch-a'], repoPath);
      writeFileSync(join(repoPath, 'a.txt'), 'a');
      git(['add', '.'], repoPath);
      git(['commit', '-m', 'Commit on branch-a'], repoPath);
      git(['checkout', 'branch-b'], repoPath);
      writeFileSync(join(repoPath, 'b.txt'), 'b');
      git(['add', '.'], repoPath);
      git(['commit', '-m', 'Commit on branch-b'], repoPath);
      const mergeBase = adapter.getMergeBase(repoPath, 'branch-a', 'branch-b');
      expect(mergeBase).toBe(initialCommit);
    });

    it('should throw for invalid refs', () => {
      expect(() => {
        adapter.getMergeBase(repoPath, 'invalid-ref-1', 'invalid-ref-2');
      }).toThrow();
    });
  });

  describe('branchExists', () => {
    it('should return true for existing branch', () => {
      const currentBranch = git(['branch', '--show-current'], repoPath);
      expect(adapter.branchExists(repoPath, currentBranch)).toBe(true);
    });

    it('should return false for non-existent branch', () => {
      expect(adapter.branchExists(repoPath, 'nonexistent-branch-xyz')).toBe(false);
    });

    it('should return true for newly created branch', () => {
      git(['branch', 'test-branch-exists'], repoPath);
      expect(adapter.branchExists(repoPath, 'test-branch-exists')).toBe(true);
    });
  });

  describe('createBranch', () => {
    it('should create branch at HEAD', () => {
      const worktreePath = join(testDir, 'create-branch-test');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'temp-for-create' });

      adapter.createBranch(worktreePath, 'new-feature-branch');

      expect(adapter.branchExists(repoPath, 'new-feature-branch')).toBe(true);
    });

    it('should create branch at specified commit', () => {
      const headCommit = git(['rev-parse', 'HEAD'], repoPath);
      const worktreePath = join(testDir, 'create-branch-commit');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'temp-for-create2' });

      // Add a new commit
      writeFileSync(join(worktreePath, 'extra.txt'), 'extra');
      git(['add', '.'], worktreePath);
      git(['commit', '-m', 'Extra commit'], worktreePath);

      // Create branch at the original HEAD commit
      adapter.createBranch(worktreePath, 'branch-at-old-head', headCommit);

      const branchCommit = adapter.getBranchCommit(repoPath, 'branch-at-old-head');
      expect(branchCommit).toBe(headCommit);
    });

    it('should throw if branch already exists', () => {
      const worktreePath = join(testDir, 'create-branch-dup');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'temp-for-dup' });
      git(['branch', 'already-exists'], repoPath);

      expect(() => {
        adapter.createBranch(worktreePath, 'already-exists');
      }).toThrow();
    });
  });

  describe('getCurrentBranch', () => {
    it('should return branch name when on a branch', () => {
      const worktreePath = join(testDir, 'current-branch-test');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'my-current-branch' });

      const currentBranch = adapter.getCurrentBranch(worktreePath);
      expect(currentBranch).toBe('my-current-branch');
    });

    it('should return null when in detached HEAD state', () => {
      const commitSha = git(['rev-parse', 'HEAD'], repoPath);
      const worktreePath = join(testDir, 'detached-current');
      adapter.createWorktree(repoPath, worktreePath, { commit: commitSha });

      const currentBranch = adapter.getCurrentBranch(worktreePath);
      expect(currentBranch).toBeNull();
    });

    it('should return correct branch after checkout', () => {
      const worktreePath = join(testDir, 'branch-switch-test');
      adapter.createWorktree(repoPath, worktreePath, { branch: 'initial-branch' });
      git(['branch', 'target-branch'], repoPath);

      adapter.checkoutBranch(worktreePath, 'target-branch');

      const currentBranch = adapter.getCurrentBranch(worktreePath);
      expect(currentBranch).toBe('target-branch');
    });
  });
});
