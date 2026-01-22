import { describe, it, expect } from 'vitest';
import {
  ThreadTurnSchema,
  ThreadMetadataSchema,
  type ThreadTurn,
  type ThreadMetadata,
} from '../threads.js';
import {
  PlanMetadataSchema,
  type PlanMetadata,
} from '../plans.js';
import {
  RelationTypeSchema,
  PlanThreadRelationSchema,
  RELATION_TYPE_PRECEDENCE,
  getHighestPrecedenceType,
  type RelationType,
  type PlanThreadRelation,
} from '../relations.js';
import {
  WorktreeStateSchema,
  RepositorySettingsSchema,
} from '../repositories.js';
import { EventName } from '../events.js';

// ============================================================================
// 1. ThreadTurnSchema Validation Tests
// ============================================================================

describe('ThreadTurnSchema', () => {
  it('should accept valid ThreadTurn with all fields', () => {
    const validTurn = {
      index: 0,
      prompt: 'Test prompt',
      startedAt: Date.now(),
      completedAt: Date.now(),
      exitCode: 0,
      costUsd: 0.05,
    };
    expect(() => ThreadTurnSchema.parse(validTurn)).not.toThrow();
  });

  it('should accept ThreadTurn with null completedAt', () => {
    const turn = {
      index: 1,
      prompt: 'In progress',
      startedAt: Date.now(),
      completedAt: null,
    };
    expect(() => ThreadTurnSchema.parse(turn)).not.toThrow();
  });

  it('should accept ThreadTurn without optional exitCode and costUsd', () => {
    const turn = {
      index: 0,
      prompt: 'Test',
      startedAt: Date.now(),
      completedAt: Date.now(),
    };
    const parsed = ThreadTurnSchema.parse(turn);
    expect(parsed.exitCode).toBeUndefined();
    expect(parsed.costUsd).toBeUndefined();
  });

  it('should reject ThreadTurn with missing required fields', () => {
    expect(() => ThreadTurnSchema.parse({ index: 0 })).toThrow();
    expect(() => ThreadTurnSchema.parse({ prompt: 'test' })).toThrow();
  });

  it('should reject ThreadTurn with invalid types', () => {
    expect(() => ThreadTurnSchema.parse({
      index: 'zero',
      prompt: 'test',
      startedAt: Date.now(),
      completedAt: null,
    })).toThrow();
  });
});

// ============================================================================
// 2. ThreadMetadataSchema Validation Tests
// ============================================================================

describe('ThreadMetadataSchema', () => {
  const validThread = {
    id: crypto.randomUUID(),
    repoId: crypto.randomUUID(),
    worktreeId: crypto.randomUUID(),
    status: 'idle' as const,
    turns: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('should accept valid ThreadMetadata with required fields only', () => {
    expect(() => ThreadMetadataSchema.parse(validThread)).not.toThrow();
  });

  it('should accept all valid status values', () => {
    const statuses = ['idle', 'running', 'completed', 'error', 'paused', 'cancelled'];
    statuses.forEach(status => {
      expect(() => ThreadMetadataSchema.parse({ ...validThread, status })).not.toThrow();
    });
  });

  it('should reject invalid status values', () => {
    expect(() => ThreadMetadataSchema.parse({ ...validThread, status: 'invalid' })).toThrow();
  });

  it('should accept ThreadMetadata with git info', () => {
    const withGit = {
      ...validThread,
      git: {
        branch: 'feature/test',
        initialCommitHash: 'abc123',
        commitHash: 'def456',
      },
    };
    expect(() => ThreadMetadataSchema.parse(withGit)).not.toThrow();
  });

  it('should default isRead to true via transform', () => {
    const parsed = ThreadMetadataSchema.parse(validThread);
    expect(parsed.isRead).toBe(true);
  });

  it('should preserve explicit isRead value', () => {
    const parsed = ThreadMetadataSchema.parse({ ...validThread, isRead: false });
    expect(parsed.isRead).toBe(false);
  });

  it('should require valid UUIDs for id, repoId, worktreeId', () => {
    expect(() => ThreadMetadataSchema.parse({ ...validThread, id: 'not-a-uuid' })).toThrow();
    expect(() => ThreadMetadataSchema.parse({ ...validThread, repoId: 'not-a-uuid' })).toThrow();
    expect(() => ThreadMetadataSchema.parse({ ...validThread, worktreeId: 'not-a-uuid' })).toThrow();
  });

  it('should accept optional changedFilePaths array', () => {
    const withFiles = { ...validThread, changedFilePaths: ['src/foo.ts', 'src/bar.ts'] };
    const parsed = ThreadMetadataSchema.parse(withFiles);
    expect(parsed.changedFilePaths).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('should accept optional pid as number or null', () => {
    expect(() => ThreadMetadataSchema.parse({ ...validThread, pid: 12345 })).not.toThrow();
    expect(() => ThreadMetadataSchema.parse({ ...validThread, pid: null })).not.toThrow();
  });
});

// ============================================================================
// 3. PlanMetadataSchema Validation Tests
// ============================================================================

describe('PlanMetadataSchema', () => {
  const validPlan = {
    id: crypto.randomUUID(),
    repoId: crypto.randomUUID(),
    worktreeId: crypto.randomUUID(),
    relativePath: 'feature/add-auth.md',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('should accept valid PlanMetadata with required fields', () => {
    expect(() => PlanMetadataSchema.parse(validPlan)).not.toThrow();
  });

  it('should default isRead to false', () => {
    const parsed = PlanMetadataSchema.parse(validPlan);
    expect(parsed.isRead).toBe(false);
  });

  it('should accept optional parentId as valid UUID', () => {
    const nested = { ...validPlan, parentId: crypto.randomUUID() };
    expect(() => PlanMetadataSchema.parse(nested)).not.toThrow();
  });

  it('should reject invalid parentId', () => {
    expect(() => PlanMetadataSchema.parse({ ...validPlan, parentId: 'invalid' })).toThrow();
  });

  it('should require valid UUIDs for id, repoId, worktreeId', () => {
    expect(() => PlanMetadataSchema.parse({ ...validPlan, id: 'bad' })).toThrow();
    expect(() => PlanMetadataSchema.parse({ ...validPlan, repoId: 'bad' })).toThrow();
    expect(() => PlanMetadataSchema.parse({ ...validPlan, worktreeId: 'bad' })).toThrow();
  });

  it('should require relativePath as string', () => {
    const { relativePath, ...noPlan } = validPlan;
    expect(() => PlanMetadataSchema.parse(noPlan)).toThrow();
  });
});

// ============================================================================
// 4. PlanThreadRelationSchema Validation Tests
// ============================================================================

describe('PlanThreadRelationSchema', () => {
  const validRelation = {
    planId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    type: 'created' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('should accept valid relation with all fields', () => {
    expect(() => PlanThreadRelationSchema.parse(validRelation)).not.toThrow();
  });

  it('should accept all valid relation types', () => {
    const types = ['created', 'modified', 'mentioned'];
    types.forEach(type => {
      expect(() => PlanThreadRelationSchema.parse({ ...validRelation, type })).not.toThrow();
    });
  });

  it('should reject invalid relation type', () => {
    expect(() => PlanThreadRelationSchema.parse({ ...validRelation, type: 'invalid' })).toThrow();
  });

  it('should require valid UUIDs for planId and threadId', () => {
    expect(() => PlanThreadRelationSchema.parse({ ...validRelation, planId: 'bad' })).toThrow();
    expect(() => PlanThreadRelationSchema.parse({ ...validRelation, threadId: 'bad' })).toThrow();
  });
});

// ============================================================================
// 5. RelationTypeSchema Validation Tests
// ============================================================================

describe('RelationTypeSchema', () => {
  it('should accept "created"', () => {
    expect(RelationTypeSchema.parse('created')).toBe('created');
  });

  it('should accept "modified"', () => {
    expect(RelationTypeSchema.parse('modified')).toBe('modified');
  });

  it('should accept "mentioned"', () => {
    expect(RelationTypeSchema.parse('mentioned')).toBe('mentioned');
  });

  it('should reject invalid values', () => {
    expect(() => RelationTypeSchema.parse('referenced')).toThrow();
    expect(() => RelationTypeSchema.parse('')).toThrow();
  });
});

// ============================================================================
// 5b. Relation Precedence Tests
// ============================================================================

describe('Relation Precedence', () => {
  it('should have correct precedence values', () => {
    expect(RELATION_TYPE_PRECEDENCE.mentioned).toBe(1);
    expect(RELATION_TYPE_PRECEDENCE.modified).toBe(2);
    expect(RELATION_TYPE_PRECEDENCE.created).toBe(3);
  });

  it('should return highest precedence type from array', () => {
    expect(getHighestPrecedenceType(['mentioned', 'modified', 'created'])).toBe('created');
    expect(getHighestPrecedenceType(['mentioned', 'modified'])).toBe('modified');
    expect(getHighestPrecedenceType(['mentioned'])).toBe('mentioned');
  });

  it('should throw on empty array', () => {
    expect(() => getHighestPrecedenceType([])).toThrow();
  });
});

// ============================================================================
// 6. WorktreeStateSchema Validation Tests
// ============================================================================

describe('WorktreeStateSchema', () => {
  it('should require id field as valid UUID', () => {
    const worktree = {
      id: crypto.randomUUID(),
      path: '/path/to/worktree',
      name: 'feature-branch',
    };
    expect(() => WorktreeStateSchema.parse(worktree)).not.toThrow();
  });

  it('should reject worktree without id', () => {
    const worktree = {
      path: '/path/to/worktree',
      name: 'feature-branch',
    };
    expect(() => WorktreeStateSchema.parse(worktree)).toThrow();
  });

  it('should reject worktree with invalid id', () => {
    const worktree = {
      id: 'not-a-uuid',
      path: '/path/to/worktree',
      name: 'feature-branch',
    };
    expect(() => WorktreeStateSchema.parse(worktree)).toThrow();
  });

  it('should accept optional lastAccessedAt and currentBranch', () => {
    const worktree = {
      id: crypto.randomUUID(),
      path: '/path/to/worktree',
      name: 'feature-branch',
      lastAccessedAt: Date.now(),
      currentBranch: 'main',
    };
    expect(() => WorktreeStateSchema.parse(worktree)).not.toThrow();
  });
});

// ============================================================================
// 7. RepositorySettingsSchema Validation Tests
// ============================================================================

describe('RepositorySettingsSchema', () => {
  const validRepo = {
    id: crypto.randomUUID(),
    schemaVersion: 1 as const,
    name: 'test-repo',
    originalUrl: 'https://github.com/test/repo',
    sourcePath: '/path/to/repo',
    useWorktrees: true,
    createdAt: Date.now(),
    threadBranches: {},
    lastUpdated: Date.now(),
  };

  it('should require id field as valid UUID', () => {
    expect(() => RepositorySettingsSchema.parse(validRepo)).not.toThrow();
  });

  it('should reject repository without id', () => {
    const { id, ...noId } = validRepo;
    expect(() => RepositorySettingsSchema.parse(noId)).toThrow();
  });

  it('should default plansDirectory to "plans/"', () => {
    const parsed = RepositorySettingsSchema.parse(validRepo);
    expect(parsed.plansDirectory).toBe('plans/');
  });

  it('should default completedDirectory to "plans/completed/"', () => {
    const parsed = RepositorySettingsSchema.parse(validRepo);
    expect(parsed.completedDirectory).toBe('plans/completed/');
  });

  it('should allow custom plansDirectory and completedDirectory', () => {
    const custom = {
      ...validRepo,
      plansDirectory: 'docs/plans/',
      completedDirectory: 'docs/done/',
    };
    const parsed = RepositorySettingsSchema.parse(custom);
    expect(parsed.plansDirectory).toBe('docs/plans/');
    expect(parsed.completedDirectory).toBe('docs/done/');
  });

  it('should default defaultBranch to "main"', () => {
    const parsed = RepositorySettingsSchema.parse(validRepo);
    expect(parsed.defaultBranch).toBe('main');
  });
});

// ============================================================================
// 8. EventName and EventPayloads Tests
// ============================================================================

describe('EventName', () => {
  it('should not include any TASK_* events', () => {
    const eventNames = Object.keys(EventName);
    const taskEvents = eventNames.filter(name => name.startsWith('TASK_'));
    expect(taskEvents).toEqual([]);
  });

  it('should include THREAD_ARCHIVED event', () => {
    expect(EventName.THREAD_ARCHIVED).toBe('thread:archived');
  });

  it('should include THREAD_FILE_CREATED event', () => {
    expect(EventName.THREAD_FILE_CREATED).toBe('thread:file-created');
  });

  it('should include THREAD_FILE_MODIFIED event', () => {
    expect(EventName.THREAD_FILE_MODIFIED).toBe('thread:file-modified');
  });

  it('should include PLAN_CREATED event', () => {
    expect(EventName.PLAN_CREATED).toBe('plan:created');
  });

  it('should include PLAN_UPDATED event', () => {
    expect(EventName.PLAN_UPDATED).toBe('plan:updated');
  });

  it('should include PLAN_ARCHIVED event', () => {
    expect(EventName.PLAN_ARCHIVED).toBe('plan:archived');
  });

  it('should include RELATION_CREATED event', () => {
    expect(EventName.RELATION_CREATED).toBe('relation:created');
  });

  it('should include RELATION_UPDATED event', () => {
    expect(EventName.RELATION_UPDATED).toBe('relation:updated');
  });

  it('should include USER_MESSAGE_SENT event', () => {
    expect(EventName.USER_MESSAGE_SENT).toBe('user:message-sent');
  });
});

// ============================================================================
// 9. Type Inference Tests
// ============================================================================

describe('Type Inference', () => {
  it('ThreadTurn type should match schema inference', () => {
    const turn: ThreadTurn = {
      index: 0,
      prompt: 'test',
      startedAt: Date.now(),
      completedAt: null,
    };
    expect(ThreadTurnSchema.parse(turn)).toBeDefined();
  });

  it('ThreadMetadata type should match schema inference', () => {
    const thread: ThreadMetadata = {
      id: crypto.randomUUID(),
      repoId: crypto.randomUUID(),
      worktreeId: crypto.randomUUID(),
      status: 'idle',
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isRead: true,
    };
    expect(ThreadMetadataSchema.parse(thread)).toBeDefined();
  });

  it('PlanMetadata type should match schema inference', () => {
    const plan: PlanMetadata = {
      id: crypto.randomUUID(),
      repoId: crypto.randomUUID(),
      worktreeId: crypto.randomUUID(),
      relativePath: 'test.md',
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(PlanMetadataSchema.parse(plan)).toBeDefined();
  });

  it('PlanThreadRelation type should match schema inference', () => {
    const relation: PlanThreadRelation = {
      planId: crypto.randomUUID(),
      threadId: crypto.randomUUID(),
      type: 'created',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(PlanThreadRelationSchema.parse(relation)).toBeDefined();
  });
});

// ============================================================================
// 10. Index Exports Test
// ============================================================================

describe('core/types/index.ts exports', () => {
  it('should export relations module', async () => {
    const types = await import('../index.js');
    expect(types.PlanThreadRelationSchema).toBeDefined();
    expect(types.RelationTypeSchema).toBeDefined();
  });

  it('should not export tasks module', async () => {
    const types = await import('../index.js') as Record<string, unknown>;
    // TaskSchema or similar should not exist
    expect(types.TaskSchema).toBeUndefined();
    expect(types.TaskMetadataSchema).toBeUndefined();
  });
});
