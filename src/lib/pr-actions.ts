/**
 * PR action handler for the "Create pull request" plus menu action.
 *
 * Two paths:
 * 1. Existing PR detected -> create entity if needed, open PR content pane
 * 2. No PR exists -> spawn agent thread with create-pr skill, open thread pane
 *
 * PR detection from the agent's `gh pr create` happens asynchronously via
 * gateway webhook (pull_request.opened) -- see listeners.ts.
 */

import { invoke } from "@/lib/invoke";
import { Command } from "@tauri-apps/plugin-shell";
import { GhCli } from "./gh-cli";
import { pullRequestService } from "@/entities/pull-requests";
import { createThread } from "@/lib/thread-creation-service";
import { navigationService } from "@/stores/navigation-service";
import { logger } from "./logger-client";
import { toast } from "./toast";

/**
 * Handle "Create pull request" action from the plus menu.
 *
 * If a PR already exists for the current branch, opens it.
 * Otherwise, spawns an agent with the create-pr skill.
 */
export async function handleCreatePr(
  repoId: string,
  worktreeId: string,
  worktreePath: string,
): Promise<void> {
  const ghCli = new GhCli(worktreePath);

  // 1. Check if gh is available and authenticated.
  if (!(await ghCli.isAvailable())) {
    logger.warn("[pr-actions] gh CLI not available or not authenticated", {
      worktreePath,
    });
    toast.error("GitHub CLI not available — install or authenticate `gh` to create PRs");
    return;
  }

  // 2. Check if a PR already exists for the current branch.
  const existingPrNumber = await ghCli.getCurrentBranchPr();

  if (existingPrNumber) {
    await openExistingPr(repoId, worktreeId, worktreePath, existingPrNumber, ghCli);
    return;
  }

  // 3. No PR exists -- spawn an agent with the create-pr skill.
  await spawnCreatePrAgent(repoId, worktreeId, worktreePath);
}

/**
 * Open an existing PR: create entity if needed, then navigate to content pane.
 */
async function openExistingPr(
  repoId: string,
  worktreeId: string,
  worktreePath: string,
  prNumber: number,
  ghCli: GhCli,
): Promise<void> {
  let pr = pullRequestService.getByRepoAndNumber(repoId, prNumber);

  if (!pr) {
    const repoSlug = await ghCli.getRepoSlug();
    const branchInfo = await getBranchInfo(worktreePath);
    pr = await pullRequestService.create({
      prNumber,
      repoId,
      worktreeId,
      repoSlug,
      headBranch: branchInfo.head,
      baseBranch: branchInfo.base,
    });
  }

  await navigationService.navigateToPullRequest(pr.id, { newTab: true });
  logger.info("[pr-actions] Opened existing PR", { prId: pr.id, prNumber });
}

/**
 * Spawn an agent thread with the create-pr skill.
 * Opens the thread content pane so the user can watch the agent work.
 */
async function spawnCreatePrAgent(
  repoId: string,
  worktreeId: string,
  worktreePath: string,
): Promise<void> {
  const { threadId } = await createThread({
    prompt: "/mort:create-pr",
    repoId,
    worktreeId,
    worktreePath,
    permissionMode: "implement",
  });

  // Open thread in a new tab so the user can watch the agent work.
  await navigationService.navigateToThread(threadId, { newTab: true });
  logger.info("[pr-actions] Spawned create-pr agent thread", { threadId, repoId });
}

/**
 * Get head and base branch info for the current worktree.
 * Uses git commands to determine the current branch and the remote default branch.
 */
async function getBranchInfo(
  worktreePath: string,
): Promise<{ head: string; base: string }> {
  const shellPath = await invoke<string>("get_shell_path");
  const env = { PATH: shellPath };

  const headResult = await Command.create(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: worktreePath, env },
  ).execute();
  const head = headResult.stdout.trim();

  // Detect base branch: check remote HEAD, fallback to "main"
  try {
    const baseResult = await Command.create(
      "git",
      ["rev-parse", "--abbrev-ref", "origin/HEAD"],
      { cwd: worktreePath, env },
    ).execute();
    const base = baseResult.stdout.trim().replace("origin/", "");
    return { head, base };
  } catch {
    return { head, base: "main" };
  }
}
