/**
 * Plan Entity Tests
 *
 * Comprehensive tests for the plan entity layer including:
 * - PlanMetadata schema validation
 * - Store filtering and hierarchy methods
 * - Service operations
 * - Path resolution utilities
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanMetadataSchema } from "@core/types/plans";
import { usePlanStore } from "../store";
import { planService } from "../service";
import { getPlanDisplayName, getParentPath } from "../utils";
import type { PlanMetadata } from "../types";

// Mock dependencies
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/persistence", () => ({
  persistence: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn().mockResolvedValue(null),
    exists: vi.fn().mockResolvedValue(false),
    glob: vi.fn().mockResolvedValue([]),
    removeDir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Helper to create valid PlanMetadata
function createPlanMetadata(overrides: Partial<PlanMetadata> = {}): PlanMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    repoId: crypto.randomUUID(),
    worktreeId: crypto.randomUUID(),
    relativePath: "test-plan.md",
    isRead: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PlanMetadata Schema Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("PlanMetadataSchema", () => {
  it("should validate a complete valid PlanMetadata object", () => {
    const valid = createPlanMetadata();

    const result = PlanMetadataSchema.safeParse(valid);

    expect(result.success).toBe(true);
  });

  it("should validate PlanMetadata with optional parentId", () => {
    const valid = createPlanMetadata({
      parentId: crypto.randomUUID(),
    });

    const result = PlanMetadataSchema.safeParse(valid);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentId).toBeDefined();
    }
  });

  it("should reject PlanMetadata with invalid uuid for id", () => {
    const invalid = {
      ...createPlanMetadata(),
      id: "not-a-uuid",
    };

    const result = PlanMetadataSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });

  it("should reject PlanMetadata with invalid uuid for repoId", () => {
    const invalid = {
      ...createPlanMetadata(),
      repoId: "not-a-uuid",
    };

    const result = PlanMetadataSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });

  it("should reject PlanMetadata with invalid uuid for worktreeId", () => {
    const invalid = {
      ...createPlanMetadata(),
      worktreeId: "not-a-uuid",
    };

    const result = PlanMetadataSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });

  it("should reject PlanMetadata with invalid uuid for parentId", () => {
    const invalid = {
      ...createPlanMetadata(),
      parentId: "not-a-uuid",
    };

    const result = PlanMetadataSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });

  it("should reject PlanMetadata missing required fields", () => {
    // Missing repoId
    const missingRepoId = {
      id: crypto.randomUUID(),
      worktreeId: crypto.randomUUID(),
      relativePath: "test.md",
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result1 = PlanMetadataSchema.safeParse(missingRepoId);
    expect(result1.success).toBe(false);

    // Missing worktreeId
    const missingWorktreeId = {
      id: crypto.randomUUID(),
      repoId: crypto.randomUUID(),
      relativePath: "test.md",
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result2 = PlanMetadataSchema.safeParse(missingWorktreeId);
    expect(result2.success).toBe(false);

    // Missing relativePath
    const missingRelativePath = {
      id: crypto.randomUUID(),
      repoId: crypto.randomUUID(),
      worktreeId: crypto.randomUUID(),
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result3 = PlanMetadataSchema.safeParse(missingRelativePath);
    expect(result3.success).toBe(false);
  });

  it("should NOT have absolutePath field in schema", () => {
    // Verify the schema does not accept absolutePath field
    const withAbsolutePath = {
      ...createPlanMetadata(),
      absolutePath: "/some/absolute/path.md",
    };

    const result = PlanMetadataSchema.safeParse(withAbsolutePath);

    // Schema should parse successfully but strip unknown fields
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as any;
      expect(data.absolutePath).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Plan Store Repository/Worktree Filtering Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("usePlanStore filtering", () => {
  const repoId1 = "550e8400-e29b-41d4-a716-446655440001";
  const repoId2 = "550e8400-e29b-41d4-a716-446655440002";
  const worktreeId1 = "550e8400-e29b-41d4-a716-446655440011";
  const worktreeId2 = "550e8400-e29b-41d4-a716-446655440012";
  const worktreeId3 = "550e8400-e29b-41d4-a716-446655440013";

  beforeEach(() => {
    // Reset store state
    usePlanStore.setState({
      plans: {},
      _plansArray: [],
      _hydrated: false,
    });

    // Populate with test data:
    // - 3 plans for repo-1 (2 in worktree-1, 1 in worktree-2)
    // - 2 plans for repo-2 (all in worktree-3)
    const plan1 = createPlanMetadata({ id: "plan1", repoId: repoId1, worktreeId: worktreeId1 });
    const plan2 = createPlanMetadata({ id: "plan2", repoId: repoId1, worktreeId: worktreeId1 });
    const plan3 = createPlanMetadata({ id: "plan3", repoId: repoId1, worktreeId: worktreeId2 });
    const plan4 = createPlanMetadata({ id: "plan4", repoId: repoId2, worktreeId: worktreeId3 });
    const plan5 = createPlanMetadata({ id: "plan5", repoId: repoId2, worktreeId: worktreeId3 });

    usePlanStore.getState().hydrate({
      plan1,
      plan2,
      plan3,
      plan4,
      plan5,
    });
  });

  describe("getByRepository", () => {
    it("should return only plans for the specified repository", () => {
      const plans = usePlanStore.getState().getByRepository(repoId1);

      expect(plans).toHaveLength(3);
      expect(plans.every((p) => p.repoId === repoId1)).toBe(true);
    });

    it("should return empty array for repository with no plans", () => {
      const plans = usePlanStore.getState().getByRepository("nonexistent-repo-id");

      expect(plans).toEqual([]);
    });

    it("should not return plans from other repositories", () => {
      const plans = usePlanStore.getState().getByRepository(repoId1);

      expect(plans.every((p) => p.repoId !== repoId2)).toBe(true);
    });
  });

  describe("getByWorktree", () => {
    it("should return only plans for the specified worktree", () => {
      const plans = usePlanStore.getState().getByWorktree(worktreeId1);

      expect(plans).toHaveLength(2);
      expect(plans.every((p) => p.worktreeId === worktreeId1)).toBe(true);
    });

    it("should return empty array for worktree with no plans", () => {
      const plans = usePlanStore.getState().getByWorktree("nonexistent-worktree-id");

      expect(plans).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Plan Store Hierarchy Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("usePlanStore hierarchy", () => {
  const repoId1 = "550e8400-e29b-41d4-a716-446655440001";
  const repoId2 = "550e8400-e29b-41d4-a716-446655440002";
  const worktreeId = "550e8400-e29b-41d4-a716-446655440011";

  beforeEach(() => {
    // Reset store state
    usePlanStore.setState({
      plans: {},
      _plansArray: [],
      _hydrated: false,
    });

    // Hierarchical test data:
    // - root-plan-1 (no parentId, repo-1)
    // - root-plan-2 (no parentId, repo-1)
    // - child-plan-1 (parentId: root-plan-1)
    // - child-plan-2 (parentId: root-plan-1)
    // - grandchild-plan-1 (parentId: child-plan-1)
    // - root-plan-3 (no parentId, repo-2)
    const rootPlan1 = createPlanMetadata({
      id: "root-plan-1",
      repoId: repoId1,
      worktreeId,
      relativePath: "root1.md",
    });
    const rootPlan2 = createPlanMetadata({
      id: "root-plan-2",
      repoId: repoId1,
      worktreeId,
      relativePath: "root2.md",
    });
    const childPlan1 = createPlanMetadata({
      id: "child-plan-1",
      repoId: repoId1,
      worktreeId,
      relativePath: "root1/child1.md",
      parentId: "root-plan-1",
    });
    const childPlan2 = createPlanMetadata({
      id: "child-plan-2",
      repoId: repoId1,
      worktreeId,
      relativePath: "root1/child2.md",
      parentId: "root-plan-1",
    });
    const grandchildPlan1 = createPlanMetadata({
      id: "grandchild-plan-1",
      repoId: repoId1,
      worktreeId,
      relativePath: "root1/child1/grandchild1.md",
      parentId: "child-plan-1",
    });
    const rootPlan3 = createPlanMetadata({
      id: "root-plan-3",
      repoId: repoId2,
      worktreeId,
      relativePath: "root3.md",
    });

    usePlanStore.getState().hydrate({
      "root-plan-1": rootPlan1,
      "root-plan-2": rootPlan2,
      "child-plan-1": childPlan1,
      "child-plan-2": childPlan2,
      "grandchild-plan-1": grandchildPlan1,
      "root-plan-3": rootPlan3,
    });
  });

  describe("getChildren", () => {
    it("should return direct children of a plan", () => {
      const children = usePlanStore.getState().getChildren("root-plan-1");

      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toContain("child-plan-1");
      expect(children.map((c) => c.id)).toContain("child-plan-2");
    });

    it("should not return grandchildren", () => {
      const children = usePlanStore.getState().getChildren("root-plan-1");

      expect(children.map((c) => c.id)).not.toContain("grandchild-plan-1");
    });

    it("should return empty array for plan with no children", () => {
      const children = usePlanStore.getState().getChildren("grandchild-plan-1");

      expect(children).toEqual([]);
    });

    it("should return empty array for nonexistent plan", () => {
      const children = usePlanStore.getState().getChildren("nonexistent-id");

      expect(children).toEqual([]);
    });
  });

  describe("getRootPlans", () => {
    it("should return only root plans (no parentId) for a repository", () => {
      const roots = usePlanStore.getState().getRootPlans(repoId1);

      expect(roots).toHaveLength(2);
      expect(roots.map((r) => r.id)).toContain("root-plan-1");
      expect(roots.map((r) => r.id)).toContain("root-plan-2");
    });

    it("should not return plans with parentId set", () => {
      const roots = usePlanStore.getState().getRootPlans(repoId1);

      expect(roots.map((r) => r.id)).not.toContain("child-plan-1");
      expect(roots.map((r) => r.id)).not.toContain("child-plan-2");
      expect(roots.map((r) => r.id)).not.toContain("grandchild-plan-1");
    });

    it("should only return root plans for the specified repository", () => {
      const roots = usePlanStore.getState().getRootPlans(repoId1);

      expect(roots.map((r) => r.id)).not.toContain("root-plan-3");
    });

    it("should return empty array for repository with no plans", () => {
      const roots = usePlanStore.getState().getRootPlans("nonexistent-repo");

      expect(roots).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Plan Service detectParentPlan Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("PlanService.detectParentPlan", () => {
  const repoId1 = "550e8400-e29b-41d4-a716-446655440001";
  const repoId2 = "550e8400-e29b-41d4-a716-446655440002";
  const worktreeId = "550e8400-e29b-41d4-a716-446655440011";

  beforeEach(() => {
    // Reset store state
    usePlanStore.setState({
      plans: {},
      _plansArray: [],
      _hydrated: false,
    });

    // Add plans:
    // - auth.md (relativePath: 'auth.md', repoId: 'repo-1')
    // - features.md (relativePath: 'features.md', repoId: 'repo-1')
    const authPlan = createPlanMetadata({
      id: "auth-plan-id",
      repoId: repoId1,
      worktreeId,
      relativePath: "auth.md",
    });
    const featuresPlan = createPlanMetadata({
      id: "features-plan-id",
      repoId: repoId1,
      worktreeId,
      relativePath: "features.md",
    });

    usePlanStore.getState().hydrate({
      "auth-plan-id": authPlan,
      "features-plan-id": featuresPlan,
    });
  });

  it("should return undefined for root-level plan", () => {
    const result = planService.detectParentPlan("login.md", repoId1);

    expect(result).toBeUndefined();
  });

  it("should detect parent plan from directory structure", () => {
    const result = planService.detectParentPlan("auth/login.md", repoId1);

    expect(result).toBe("auth-plan-id");
  });

  it("should return undefined when parent plan does not exist", () => {
    const result = planService.detectParentPlan("users/profile.md", repoId1);

    expect(result).toBeUndefined();
  });

  it("should only detect parent within same repository", () => {
    const result = planService.detectParentPlan("auth/login.md", repoId2);

    expect(result).toBeUndefined();
  });

  it("should handle deeply nested paths", () => {
    // Add features/auth.md to store
    const featuresAuthPlan = createPlanMetadata({
      id: "features-auth-plan-id",
      repoId: repoId1,
      worktreeId,
      relativePath: "features/auth.md",
    });
    usePlanStore.getState()._applyCreate(featuresAuthPlan);

    const result = planService.detectParentPlan("features/auth/oauth.md", repoId1);

    expect(result).toBe("features-auth-plan-id");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Plan Service ensurePlanExists Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("PlanService.ensurePlanExists", () => {
  const repoId = "550e8400-e29b-41d4-a716-446655440001";
  const worktreeId = "550e8400-e29b-41d4-a716-446655440011";

  beforeEach(() => {
    // Reset store state
    usePlanStore.setState({
      plans: {},
      _plansArray: [],
      _hydrated: false,
    });
  });

  it("should return existing plan if it already exists", async () => {
    // Add a plan with relativePath 'existing.md' to store
    const existingPlan = createPlanMetadata({
      id: "existing-plan-id",
      repoId,
      worktreeId,
      relativePath: "existing.md",
      isRead: true,
    });
    usePlanStore.getState()._applyCreate(existingPlan);

    const result = await planService.ensurePlanExists(repoId, worktreeId, "existing.md");

    expect(result.id).toBe("existing-plan-id");
  });

  it("should create new plan if it does not exist", async () => {
    const result = await planService.ensurePlanExists(repoId, worktreeId, "new-plan.md");

    expect(result.repoId).toBe(repoId);
    expect(result.worktreeId).toBe(worktreeId);
    expect(result.relativePath).toBe("new-plan.md");

    // Verify plan is added to store
    const storedPlan = usePlanStore.getState().getPlan(result.id);
    expect(storedPlan).toBeDefined();
    expect(storedPlan?.relativePath).toBe("new-plan.md");
  });

  it("should set isRead to false for newly created plans", async () => {
    const result = await planService.ensurePlanExists(repoId, worktreeId, "new-plan.md");

    expect(result.isRead).toBe(false);
  });

  it("should set createdAt and updatedAt to current timestamp", async () => {
    const before = Date.now();
    const result = await planService.ensurePlanExists(repoId, worktreeId, "new-plan.md");
    const after = Date.now();

    expect(result.createdAt).toBeGreaterThanOrEqual(before);
    expect(result.createdAt).toBeLessThanOrEqual(after);
    expect(result.updatedAt).toBeGreaterThanOrEqual(before);
    expect(result.updatedAt).toBeLessThanOrEqual(after);
  });

  it("should auto-detect and set parentId for nested plans", async () => {
    // Add 'auth.md' plan to store
    const authPlan = createPlanMetadata({
      id: "auth-plan-id",
      repoId,
      worktreeId,
      relativePath: "auth.md",
    });
    usePlanStore.getState()._applyCreate(authPlan);

    const result = await planService.ensurePlanExists(repoId, worktreeId, "auth/login.md");

    expect(result.parentId).toBe("auth-plan-id");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Path Resolution Utility Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("getPlanDisplayName", () => {
  it("should return filename without .md extension", () => {
    const plan = createPlanMetadata({ relativePath: "auth.md" });

    const result = getPlanDisplayName(plan);

    expect(result).toBe("auth");
  });

  it("should handle nested paths and return only filename", () => {
    const plan = createPlanMetadata({ relativePath: "features/auth/login.md" });

    const result = getPlanDisplayName(plan);

    expect(result).toBe("login");
  });

  it("should preserve filename if no .md extension", () => {
    const plan = createPlanMetadata({ relativePath: "README" });

    const result = getPlanDisplayName(plan);

    expect(result).toBe("README");
  });
});

describe("getParentPath", () => {
  it("should return undefined for root-level path", () => {
    const result = getParentPath("auth.md");

    expect(result).toBeUndefined();
  });

  it("should return parent directory for nested path", () => {
    const result = getParentPath("features/auth/login.md");

    expect(result).toBe("features/auth");
  });

  it("should handle single-level nesting", () => {
    const result = getParentPath("auth/login.md");

    expect(result).toBe("auth");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Plan Service CRUD with Persistence Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("PlanService CRUD operations", () => {
  const repoId = "550e8400-e29b-41d4-a716-446655440001";
  const worktreeId = "550e8400-e29b-41d4-a716-446655440011";

  beforeEach(() => {
    // Reset store state
    usePlanStore.setState({
      plans: {},
      _plansArray: [],
      _hydrated: false,
    });

    // Reset mocks
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should save metadata via persistence layer", async () => {
      const { persistence } = await import("@/lib/persistence");

      await planService.create({ repoId, worktreeId, relativePath: "new.md" });

      expect(persistence.ensureDir).toHaveBeenCalled();
      expect(persistence.writeJson).toHaveBeenCalled();
    });

    it("should apply optimistic update to store", async () => {
      const plan = await planService.create({ repoId, worktreeId, relativePath: "new.md" });

      // Verify plan appears in store immediately
      const storedPlan = usePlanStore.getState().getPlan(plan.id);
      expect(storedPlan).toBeDefined();
      expect(storedPlan?.relativePath).toBe("new.md");
    });

    it("should generate valid UUID for id", async () => {
      const plan = await planService.create({ repoId, worktreeId, relativePath: "new.md" });

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(plan.id).toMatch(uuidRegex);
    });
  });

  describe("update", () => {
    it("should update existing plan via persistence layer", async () => {
      const { persistence } = await import("@/lib/persistence");

      // Create a plan first
      const plan = createPlanMetadata({ repoId, worktreeId, relativePath: "existing.md" });
      usePlanStore.getState()._applyCreate(plan);

      await planService.update(plan.id, { isRead: true });

      expect(persistence.writeJson).toHaveBeenCalled();
    });

    it("should update updatedAt timestamp", async () => {
      const plan = createPlanMetadata({
        repoId,
        worktreeId,
        relativePath: "existing.md",
        updatedAt: Date.now() - 10000, // 10 seconds ago
      });
      usePlanStore.getState()._applyCreate(plan);

      const before = Date.now();
      await planService.update(plan.id, { isRead: true });
      const after = Date.now();

      const updated = usePlanStore.getState().getPlan(plan.id);
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(before);
      expect(updated?.updatedAt).toBeLessThanOrEqual(after);
    });

    it("should throw error if plan not found", async () => {
      await expect(
        planService.update("nonexistent-id", { isRead: true })
      ).rejects.toThrow("Plan not found: nonexistent-id");
    });

    it("should preserve fields not included in update", async () => {
      const plan = createPlanMetadata({
        repoId,
        worktreeId,
        relativePath: "existing.md",
      });
      usePlanStore.getState()._applyCreate(plan);

      await planService.update(plan.id, { isRead: true });

      const updated = usePlanStore.getState().getPlan(plan.id);
      expect(updated?.repoId).toBe(repoId);
      expect(updated?.worktreeId).toBe(worktreeId);
      expect(updated?.relativePath).toBe("existing.md");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Plan Store Optimistic Updates Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("usePlanStore optimistic updates", () => {
  beforeEach(() => {
    // Reset store state
    usePlanStore.setState({
      plans: {},
      _plansArray: [],
      _hydrated: false,
    });
  });

  describe("_applyCreate", () => {
    it("adds plan to store", () => {
      const plan = createPlanMetadata({ id: "new-plan" });

      usePlanStore.getState()._applyCreate(plan);

      expect(usePlanStore.getState().plans["new-plan"]).toEqual(plan);
    });

    it("returns rollback function that removes plan", () => {
      const plan = createPlanMetadata({ id: "rollback-plan" });

      const rollback = usePlanStore.getState()._applyCreate(plan);
      expect(usePlanStore.getState().plans["rollback-plan"]).toBeDefined();

      rollback();
      expect(usePlanStore.getState().plans["rollback-plan"]).toBeUndefined();
    });

    it("updates _plansArray on create", () => {
      const plan = createPlanMetadata({ id: "array-plan" });

      usePlanStore.getState()._applyCreate(plan);

      const plansArray = usePlanStore.getState()._plansArray;
      expect(plansArray).toContainEqual(plan);
    });
  });

  describe("_applyUpdate", () => {
    it("updates plan in store", () => {
      const plan = createPlanMetadata({ id: "update-plan", isRead: false });
      usePlanStore.getState()._applyCreate(plan);

      usePlanStore.getState()._applyUpdate("update-plan", { isRead: true });

      expect(usePlanStore.getState().plans["update-plan"].isRead).toBe(true);
    });

    it("returns rollback function that restores previous state", () => {
      const plan = createPlanMetadata({ id: "restore-plan", isRead: false });
      usePlanStore.getState()._applyCreate(plan);

      const rollback = usePlanStore.getState()._applyUpdate("restore-plan", { isRead: true });
      expect(usePlanStore.getState().plans["restore-plan"].isRead).toBe(true);

      rollback();
      expect(usePlanStore.getState().plans["restore-plan"].isRead).toBe(false);
    });
  });

  describe("_applyDelete", () => {
    it("removes plan from store", () => {
      const plan = createPlanMetadata({ id: "delete-plan" });
      usePlanStore.getState()._applyCreate(plan);

      usePlanStore.getState()._applyDelete("delete-plan");

      expect(usePlanStore.getState().plans["delete-plan"]).toBeUndefined();
    });

    it("returns rollback function that restores plan", () => {
      const plan = createPlanMetadata({ id: "restore-delete-plan" });
      usePlanStore.getState()._applyCreate(plan);

      const rollback = usePlanStore.getState()._applyDelete("restore-delete-plan");
      expect(usePlanStore.getState().plans["restore-delete-plan"]).toBeUndefined();

      rollback();
      expect(usePlanStore.getState().plans["restore-delete-plan"]).toEqual(plan);
    });

    it("updates _plansArray on delete", () => {
      const plan = createPlanMetadata({ id: "array-delete-plan" });
      usePlanStore.getState()._applyCreate(plan);
      expect(usePlanStore.getState()._plansArray).toHaveLength(1);

      usePlanStore.getState()._applyDelete("array-delete-plan");

      expect(usePlanStore.getState()._plansArray).toHaveLength(0);
    });
  });
});
