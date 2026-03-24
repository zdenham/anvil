import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AgentTestHarness } from '../agent-harness.js';
import { assertAgent } from '../assertions.js';
import { EventName } from '@core/types/events.js';
import { TestAnvilDirectory } from '../services/test-anvil-directory.js';
import { TestRepository } from '../services/test-repository.js';

/**
 * Live LLM integration tests for plan-thread relation persistence.
 *
 * These tests verify that when agents interact with plans, the correct
 * relations are written to disk in the .anvil/plan-thread-edges directory.
 *
 * Scenarios tested:
 * 1. Create Plan - thread creates a new plan file → 'created' relation
 * 2. Update Plan - thread modifies an existing plan file → 'modified' relation
 * 3. User message mentions plan - (requires detection implementation)
 *
 * IMPORTANT: Requires ANTHROPIC_API_KEY environment variable.
 */
describe('Plan-Thread Relations Persistence - Live LLM', () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    // Reset harness for each test - will be configured per-test
  });

  afterEach((context) => {
    const failed = context.task.result?.state === 'fail';
    harness?.cleanup(failed);
  });

  /**
   * Scenario 1: Create Plan
   *
   * When a thread creates a new plan file, a 'created' relation should be
   * persisted to disk at .anvil/plan-thread-edges/{planId}-{threadId}.json
   */
  it('persists "created" relation when thread creates a new plan file', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running create plan relation test...');

    harness = new AgentTestHarness();

    const result = await harness.run({
      prompt: 'Create a new plan file at plans/new-feature.md with the content "# New Feature Plan\\n\\nThis is a test plan."',
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Events:`, result.events.map(e => ({ name: e.name, payload: e.payload })));

    // 1. Agent should complete successfully
    assertAgent(result).succeeded();

    // 2. Verify PLAN_DETECTED event was emitted
    const planEvent = result.events.find(e => e.name === EventName.PLAN_DETECTED);
    expect(planEvent).toBeDefined();
    const planId = planEvent!.payload.planId as string;
    console.log(`[LIVE TEST] Plan ID: ${planId}`);

    // 3. Verify RELATION_CREATED event was emitted with type 'created'
    const relationEvent = result.events.find(e => e.name === EventName.RELATION_CREATED);
    expect(relationEvent).toBeDefined();
    expect(relationEvent!.payload.planId).toBe(planId);
    expect(relationEvent!.payload.type).toBe('created');
    const threadId = relationEvent!.payload.threadId as string;
    console.log(`[LIVE TEST] Thread ID: ${threadId}`);
    console.log(`[LIVE TEST] Relation type: ${relationEvent!.payload.type}`);

    // 4. Verify relation was persisted to disk
    const anvilDir = harness.tempDirPath!;
    const relationsDir = join(anvilDir, 'plan-thread-edges');
    const relationPath = join(relationsDir, `${planId}-${threadId}.json`);

    console.log(`[LIVE TEST] Checking relation file: ${relationPath}`);
    expect(existsSync(relationPath)).toBe(true);

    const relation = JSON.parse(readFileSync(relationPath, 'utf-8'));
    console.log(`[LIVE TEST] Relation on disk:`, relation);

    // 5. Verify relation structure
    expect(relation.planId).toBe(planId);
    expect(relation.threadId).toBe(threadId);
    expect(relation.type).toBe('created');
    expect(relation.archived).toBe(false);
    expect(typeof relation.createdAt).toBe('number');
    expect(typeof relation.updatedAt).toBe('number');

  }, 120000);

  /**
   * Scenario 2: Update Plan
   *
   * When a thread modifies an existing plan file, a 'modified' relation should be
   * created/updated on disk. This requires:
   * - Pre-existing plan metadata in .anvil/plans/{planId}/
   * - Pre-existing plan file in the repo
   */
  it('persists "modified" relation when thread updates an existing plan file', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running update plan relation test...');

    // Pre-create plan file and metadata before agent runs
    const existingPlanId = randomUUID();
    const repoId = randomUUID();
    const worktreeId = randomUUID();

    harness = new AgentTestHarness({
      setupEnvironment: async () => {
        const anvilDir = new TestAnvilDirectory().init();
        const repo = new TestRepository({ fixture: 'minimal' }).init();
        anvilDir.registerRepository(repo);

        // Create the plan file in the repo
        const plansDir = join(repo.path, 'plans');
        mkdirSync(plansDir, { recursive: true });
        writeFileSync(
          join(plansDir, 'existing-plan.md'),
          '# Existing Plan\n\nOriginal content.'
        );
        repo.commit('Add existing plan');

        // Create plan metadata in anvil directory
        const planMetadataDir = join(anvilDir.path, 'plans', existingPlanId);
        mkdirSync(planMetadataDir, { recursive: true });
        const now = Date.now();
        writeFileSync(
          join(planMetadataDir, 'metadata.json'),
          JSON.stringify({
            id: existingPlanId,
            repoId,
            worktreeId,
            relativePath: 'plans/existing-plan.md',
            isRead: true, // Mark as read to verify it gets marked unread
            createdAt: now - 1000, // Created 1 second ago
            updatedAt: now - 1000,
          })
        );

        console.log(`[LIVE TEST] Pre-created plan: ${existingPlanId}`);
        console.log(`[LIVE TEST] Repo path: ${repo.path}`);
        console.log(`[LIVE TEST] Anvil dir: ${anvilDir.path}`);

        return { anvilDir, repo };
      },
    });

    const result = await harness.run({
      prompt: 'Edit the file plans/existing-plan.md to add a new section "## Updated Section\\n\\nThis content was added by the agent." at the end of the file.',
      repoId,
      worktreeId,
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Events:`, result.events.map(e => ({ name: e.name, payload: e.payload })));

    // 1. Agent should complete successfully
    assertAgent(result).succeeded();

    // 2. Verify PLAN_DETECTED event was emitted for the existing plan
    const planEvent = result.events.find(e => e.name === EventName.PLAN_DETECTED);
    expect(planEvent).toBeDefined();
    const detectedPlanId = planEvent!.payload.planId as string;
    console.log(`[LIVE TEST] Detected Plan ID: ${detectedPlanId}`);
    expect(detectedPlanId).toBe(existingPlanId);

    // 3. Verify RELATION_CREATED event was emitted with type 'modified'
    const relationEvent = result.events.find(e => e.name === EventName.RELATION_CREATED);
    expect(relationEvent).toBeDefined();
    expect(relationEvent!.payload.planId).toBe(existingPlanId);
    expect(relationEvent!.payload.type).toBe('modified');
    const threadId = relationEvent!.payload.threadId as string;
    console.log(`[LIVE TEST] Thread ID: ${threadId}`);
    console.log(`[LIVE TEST] Relation type: ${relationEvent!.payload.type}`);

    // 4. Verify relation was persisted to disk
    const anvilDir = harness.tempDirPath!;
    const relationPath = join(anvilDir, 'plan-thread-edges', `${existingPlanId}-${threadId}.json`);

    console.log(`[LIVE TEST] Checking relation file: ${relationPath}`);
    expect(existsSync(relationPath)).toBe(true);

    const relation = JSON.parse(readFileSync(relationPath, 'utf-8'));
    console.log(`[LIVE TEST] Relation on disk:`, relation);

    // 5. Verify relation structure
    expect(relation.planId).toBe(existingPlanId);
    expect(relation.threadId).toBe(threadId);
    expect(relation.type).toBe('modified');
    expect(relation.archived).toBe(false);

    // 6. Verify plan metadata was updated (isRead should be false)
    const planMetadataPath = join(anvilDir, 'plans', existingPlanId, 'metadata.json');
    const planMetadata = JSON.parse(readFileSync(planMetadataPath, 'utf-8'));
    console.log(`[LIVE TEST] Plan metadata after update:`, planMetadata);
    expect(planMetadata.isRead).toBe(false); // Should be marked unread after modification

  }, 120000);

  /**
   * Scenario 2b: Update Plan - relation upgrade from mentioned to modified
   *
   * When a thread that previously only mentioned a plan now modifies it,
   * the relation should be upgraded from 'mentioned' to 'modified'.
   */
  it('upgrades relation from "mentioned" to "modified" when thread updates a plan it previously mentioned', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running relation upgrade test (mentioned -> modified)...');

    const existingPlanId = randomUUID();
    const existingThreadId = randomUUID();
    const repoId = randomUUID();
    const worktreeId = randomUUID();

    harness = new AgentTestHarness({
      setupEnvironment: async () => {
        const anvilDir = new TestAnvilDirectory().init();
        const repo = new TestRepository({ fixture: 'minimal' }).init();
        anvilDir.registerRepository(repo);

        // Create the plan file in the repo
        const plansDir = join(repo.path, 'plans');
        mkdirSync(plansDir, { recursive: true });
        writeFileSync(
          join(plansDir, 'mentioned-plan.md'),
          '# Mentioned Plan\n\nOriginal content.'
        );
        repo.commit('Add mentioned plan');

        // Create plan metadata
        const planMetadataDir = join(anvilDir.path, 'plans', existingPlanId);
        mkdirSync(planMetadataDir, { recursive: true });
        const now = Date.now();
        writeFileSync(
          join(planMetadataDir, 'metadata.json'),
          JSON.stringify({
            id: existingPlanId,
            repoId,
            worktreeId,
            relativePath: 'plans/mentioned-plan.md',
            isRead: true,
            createdAt: now - 10000,
            updatedAt: now - 10000,
          })
        );

        // Pre-create a 'mentioned' relation for this thread
        const relationsDir = join(anvilDir.path, 'plan-thread-edges');
        mkdirSync(relationsDir, { recursive: true });
        writeFileSync(
          join(relationsDir, `${existingPlanId}-${existingThreadId}.json`),
          JSON.stringify({
            planId: existingPlanId,
            threadId: existingThreadId,
            type: 'mentioned', // Pre-existing 'mentioned' relation
            archived: false,
            createdAt: now - 5000,
            updatedAt: now - 5000,
          })
        );

        console.log(`[LIVE TEST] Pre-created 'mentioned' relation for plan ${existingPlanId}`);

        return { anvilDir, repo };
      },
    });

    const result = await harness.run({
      prompt: 'Edit the file plans/mentioned-plan.md to add "## New Section\\n\\nAdded content." at the end.',
      repoId,
      worktreeId,
      threadId: existingThreadId, // Use same thread that had 'mentioned' relation
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);

    // 1. Agent should complete successfully
    assertAgent(result).succeeded();

    // 2. Verify RELATION_CREATED event shows type 'modified' (upgraded)
    const relationEvent = result.events.find(e => e.name === EventName.RELATION_CREATED);
    expect(relationEvent).toBeDefined();
    expect(relationEvent!.payload.type).toBe('modified'); // Should be upgraded

    // 3. Verify relation on disk was upgraded
    const anvilDir = harness.tempDirPath!;
    const relationPath = join(anvilDir, 'plan-thread-edges', `${existingPlanId}-${existingThreadId}.json`);
    const relation = JSON.parse(readFileSync(relationPath, 'utf-8'));

    console.log(`[LIVE TEST] Relation on disk after upgrade:`, relation);
    expect(relation.type).toBe('modified');
    // updatedAt should be more recent than createdAt (relation was upgraded)
    expect(relation.updatedAt).toBeGreaterThan(relation.createdAt);

  }, 120000);

  /**
   * Scenario 2c: Update Plan - no downgrade from created to modified
   *
   * When a thread that created a plan makes another edit, the relation
   * should NOT be downgraded from 'created' to 'modified'.
   */
  it('does NOT downgrade relation from "created" to "modified" on subsequent edits', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running no-downgrade test (created stays created)...');

    const existingPlanId = randomUUID();
    const existingThreadId = randomUUID();
    const repoId = randomUUID();
    const worktreeId = randomUUID();

    harness = new AgentTestHarness({
      setupEnvironment: async () => {
        const anvilDir = new TestAnvilDirectory().init();
        const repo = new TestRepository({ fixture: 'minimal' }).init();
        anvilDir.registerRepository(repo);

        // Create the plan file in the repo
        const plansDir = join(repo.path, 'plans');
        mkdirSync(plansDir, { recursive: true });
        writeFileSync(
          join(plansDir, 'created-plan.md'),
          '# Created Plan\n\nOriginal content.'
        );
        repo.commit('Add created plan');

        // Create plan metadata
        const planMetadataDir = join(anvilDir.path, 'plans', existingPlanId);
        mkdirSync(planMetadataDir, { recursive: true });
        const now = Date.now();
        writeFileSync(
          join(planMetadataDir, 'metadata.json'),
          JSON.stringify({
            id: existingPlanId,
            repoId,
            worktreeId,
            relativePath: 'plans/created-plan.md',
            isRead: true,
            createdAt: now - 10000,
            updatedAt: now - 10000,
          })
        );

        // Pre-create a 'created' relation for this thread (highest precedence)
        const relationsDir = join(anvilDir.path, 'plan-thread-edges');
        mkdirSync(relationsDir, { recursive: true });
        const originalCreatedAt = now - 5000;
        writeFileSync(
          join(relationsDir, `${existingPlanId}-${existingThreadId}.json`),
          JSON.stringify({
            planId: existingPlanId,
            threadId: existingThreadId,
            type: 'created', // Pre-existing 'created' relation
            archived: false,
            createdAt: originalCreatedAt,
            updatedAt: originalCreatedAt,
          })
        );

        console.log(`[LIVE TEST] Pre-created 'created' relation for plan ${existingPlanId}`);

        return { anvilDir, repo };
      },
    });

    const result = await harness.run({
      prompt: 'Edit the file plans/created-plan.md to add "## Additional Section\\n\\nMore content." at the end.',
      repoId,
      worktreeId,
      threadId: existingThreadId, // Same thread that created the plan
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);

    // 1. Agent should complete successfully
    assertAgent(result).succeeded();

    // 2. Verify RELATION_CREATED event still shows type 'created' (not downgraded)
    const relationEvent = result.events.find(e => e.name === EventName.RELATION_CREATED);
    expect(relationEvent).toBeDefined();
    expect(relationEvent!.payload.type).toBe('created'); // Should NOT downgrade

    // 3. Verify relation on disk was NOT downgraded
    const anvilDir = harness.tempDirPath!;
    const relationPath = join(anvilDir, 'plan-thread-edges', `${existingPlanId}-${existingThreadId}.json`);
    const relation = JSON.parse(readFileSync(relationPath, 'utf-8'));

    console.log(`[LIVE TEST] Relation on disk after re-edit:`, relation);
    expect(relation.type).toBe('created'); // Should remain 'created'

  }, 120000);

  /**
   * Scenario 3: Thread creates multiple plans in single session
   *
   * Verify that when a thread creates multiple plan files in one session,
   * separate relations are created for each plan.
   */
  it('creates separate relations when thread creates multiple plans in one session', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running multiple plans test...');

    harness = new AgentTestHarness();

    // Run agent to create two plan files in a single session
    const result = await harness.run({
      prompt: 'Create two plan files: first create plans/plan-one.md with content "# Plan One", then create plans/plan-two.md with content "# Plan Two". Create both files.',
      timeout: 120000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Events:`, result.events.map(e => ({ name: e.name, payload: e.payload })));

    assertAgent(result).succeeded();

    // Find all PLAN_DETECTED events
    const planEvents = result.events.filter(e => e.name === EventName.PLAN_DETECTED);
    console.log(`[LIVE TEST] Plan events count: ${planEvents.length}`);
    expect(planEvents.length).toBeGreaterThanOrEqual(2);

    // Find all RELATION_CREATED events
    const relationEvents = result.events.filter(e => e.name === EventName.RELATION_CREATED);
    console.log(`[LIVE TEST] Relation events count: ${relationEvents.length}`);
    expect(relationEvents.length).toBeGreaterThanOrEqual(2);

    // Extract plan IDs and thread ID
    const planIds = planEvents.map(e => e.payload.planId as string);
    const threadId = relationEvents[0].payload.threadId as string;

    console.log(`[LIVE TEST] Plan IDs: ${planIds.join(', ')}`);
    console.log(`[LIVE TEST] Thread ID: ${threadId}`);

    // Verify all plans have unique IDs
    const uniquePlanIds = new Set(planIds);
    expect(uniquePlanIds.size).toBe(planIds.length);

    // Verify all relations are on disk
    const anvilDir = harness.tempDirPath!;
    const relationsDir = join(anvilDir, 'plan-thread-edges');

    for (const planId of planIds) {
      const relationPath = join(relationsDir, `${planId}-${threadId}.json`);
      console.log(`[LIVE TEST] Checking relation file: ${relationPath}`);
      expect(existsSync(relationPath)).toBe(true);

      const relation = JSON.parse(readFileSync(relationPath, 'utf-8'));
      expect(relation.planId).toBe(planId);
      expect(relation.threadId).toBe(threadId);
      expect(relation.type).toBe('created');
    }

    // Verify relation count
    const relationFiles = readdirSync(relationsDir).filter(f => f.endsWith('.json'));
    console.log(`[LIVE TEST] Total relation files: ${relationFiles.length}`);
    expect(relationFiles.length).toBeGreaterThanOrEqual(2);

  }, 180000);

  /**
   * Scenario 4: User message mentions plan
   *
   * When a user message contains a reference to an existing plan using @{plans/...md}
   * syntax, a 'mentioned' relation should be created.
   */
  it('persists "mentioned" relation when user message references a plan with @ syntax', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running mentioned relation test...');

    const existingPlanId = randomUUID();
    const repoId = randomUUID();
    const worktreeId = randomUUID();

    harness = new AgentTestHarness({
      setupEnvironment: async () => {
        const anvilDir = new TestAnvilDirectory().init();
        const repo = new TestRepository({ fixture: 'minimal' }).init();
        anvilDir.registerRepository(repo);

        // Create the plan file in the repo
        const plansDir = join(repo.path, 'plans');
        mkdirSync(plansDir, { recursive: true });
        writeFileSync(
          join(plansDir, 'existing-feature.md'),
          '# Existing Feature Plan\n\nThis plan already exists.'
        );
        repo.commit('Add existing feature plan');

        // Create plan metadata in anvil directory
        const planMetadataDir = join(anvilDir.path, 'plans', existingPlanId);
        mkdirSync(planMetadataDir, { recursive: true });
        const now = Date.now();
        writeFileSync(
          join(planMetadataDir, 'metadata.json'),
          JSON.stringify({
            id: existingPlanId,
            repoId,
            worktreeId,
            relativePath: 'plans/existing-feature.md',
            isRead: true,
            createdAt: now - 10000,
            updatedAt: now - 10000,
          })
        );

        console.log(`[LIVE TEST] Pre-created plan: ${existingPlanId}`);
        console.log(`[LIVE TEST] Plan path: plans/existing-feature.md`);

        return { anvilDir, repo };
      },
    });

    // Send a message that mentions the plan but doesn't modify it
    // The @ syntax triggers mention detection
    const result = await harness.run({
      prompt: 'I want to discuss @plans/existing-feature.md - can you summarize what this plan is about based on its name?',
      repoId,
      worktreeId,
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Events:`, result.events.map(e => ({ name: e.name, payload: e.payload })));

    // 1. Agent should complete successfully
    assertAgent(result).succeeded();

    // 2. Verify RELATION_CREATED event was emitted with type 'mentioned'
    const relationEvent = result.events.find(e => e.name === EventName.RELATION_CREATED);
    expect(relationEvent).toBeDefined();
    expect(relationEvent!.payload.planId).toBe(existingPlanId);
    expect(relationEvent!.payload.type).toBe('mentioned');
    const threadId = relationEvent!.payload.threadId as string;
    console.log(`[LIVE TEST] Thread ID: ${threadId}`);
    console.log(`[LIVE TEST] Relation type: ${relationEvent!.payload.type}`);

    // 3. Verify relation was persisted to disk
    const anvilDir = harness.tempDirPath!;
    const relationPath = join(anvilDir, 'plan-thread-edges', `${existingPlanId}-${threadId}.json`);

    console.log(`[LIVE TEST] Checking relation file: ${relationPath}`);
    expect(existsSync(relationPath)).toBe(true);

    const relation = JSON.parse(readFileSync(relationPath, 'utf-8'));
    console.log(`[LIVE TEST] Relation on disk:`, relation);

    // 4. Verify relation structure
    expect(relation.planId).toBe(existingPlanId);
    expect(relation.threadId).toBe(threadId);
    expect(relation.type).toBe('mentioned');
    expect(relation.archived).toBe(false);

    // 5. Plan should NOT have been detected (no file modification)
    const planDetectedEvents = result.events.filter(e => e.name === EventName.PLAN_DETECTED);
    expect(planDetectedEvents.length).toBe(0);

  }, 120000);

  /**
   * Scenario 4b: User mentions plan and then modifies it
   *
   * When a user message mentions a plan and then the agent modifies it,
   * the relation should be upgraded from 'mentioned' to 'modified'.
   */
  it('upgrades from "mentioned" to "modified" when user mentions then agent modifies plan', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running mentioned-to-modified upgrade test...');

    const existingPlanId = randomUUID();
    const repoId = randomUUID();
    const worktreeId = randomUUID();

    harness = new AgentTestHarness({
      setupEnvironment: async () => {
        const anvilDir = new TestAnvilDirectory().init();
        const repo = new TestRepository({ fixture: 'minimal' }).init();
        anvilDir.registerRepository(repo);

        // Create the plan file in the repo
        const plansDir = join(repo.path, 'plans');
        mkdirSync(plansDir, { recursive: true });
        writeFileSync(
          join(plansDir, 'to-be-modified.md'),
          '# Plan To Be Modified\n\nOriginal content.'
        );
        repo.commit('Add plan to be modified');

        // Create plan metadata
        const planMetadataDir = join(anvilDir.path, 'plans', existingPlanId);
        mkdirSync(planMetadataDir, { recursive: true });
        const now = Date.now();
        writeFileSync(
          join(planMetadataDir, 'metadata.json'),
          JSON.stringify({
            id: existingPlanId,
            repoId,
            worktreeId,
            relativePath: 'plans/to-be-modified.md',
            isRead: true,
            createdAt: now - 10000,
            updatedAt: now - 10000,
          })
        );

        console.log(`[LIVE TEST] Pre-created plan: ${existingPlanId}`);

        return { anvilDir, repo };
      },
    });

    // Mention the plan AND ask agent to modify it in the same message
    const result = await harness.run({
      prompt: 'Please update @plans/to-be-modified.md by adding a new section "## Changes" with the text "Updated by agent".',
      repoId,
      worktreeId,
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Events:`, result.events.map(e => ({ name: e.name, payload: e.payload })));

    // 1. Agent should complete successfully
    assertAgent(result).succeeded();

    // 2. Should have both RELATION_CREATED events - first 'mentioned', then upgraded to 'modified'
    const relationEvents = result.events.filter(e => e.name === EventName.RELATION_CREATED);
    console.log(`[LIVE TEST] Relation events count: ${relationEvents.length}`);

    // The first event is 'mentioned' (from prompt parsing), the second is 'modified' (from file edit)
    expect(relationEvents.length).toBeGreaterThanOrEqual(1);

    // 3. Check disk - should show final upgraded type
    const anvilDir = harness.tempDirPath!;
    const threadId = relationEvents[0].payload.threadId as string;
    const relationPath = join(anvilDir, 'plan-thread-edges', `${existingPlanId}-${threadId}.json`);

    expect(existsSync(relationPath)).toBe(true);
    const relation = JSON.parse(readFileSync(relationPath, 'utf-8'));
    console.log(`[LIVE TEST] Final relation on disk:`, relation);

    // Relation should be 'modified' (upgraded from 'mentioned')
    expect(relation.type).toBe('modified');

  }, 120000);
});
