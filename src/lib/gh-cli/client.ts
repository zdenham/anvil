/**
 * Typed client for GitHub CLI operations.
 *
 * Each method:
 * - Constructs the appropriate gh CLI command
 * - Executes via the existing shell infrastructure (Tauri Command.create)
 * - Parses raw JSON output into strongly-typed return values (Zod at boundary)
 * - Handles errors with descriptive GhCliError types
 * - Parallelizes independent sub-queries where possible
 *
 * Constructor takes `cwd` -- a path within the repo so {owner}/{repo} resolves
 * from git context. For webhook/API operations, always pass the repo root path.
 * For PR-specific queries, any worktree path works.
 */

import type { PullRequestDetails } from "@core/types/pull-request.js";
import { logger } from "@/lib/logger-client";
import { execGh } from "./executor";
import {
  getCurrentBranchPr,
  getPrDetails,
  getPrChecks,
  getPrComments,
  getRepoSlug,
} from "./pr-queries";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
} from "./webhooks";

export class GhCli {
  constructor(private cwd: string) {}

  /**
   * Check if gh CLI is available and authenticated.
   * Used at startup to determine if PR features should be enabled.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execGh(["auth", "status"], this.cwd);
      return true;
    } catch (error) {
      logger.warn("[GhCli] isAvailable check failed", {
        error: error instanceof Error ? error.message : String(error),
        kind: (error as Record<string, unknown>)?.kind ?? "unknown",
        cwd: this.cwd,
      });
      return false;
    }
  }

  /**
   * Get the current branch's PR number, or null if no PR exists.
   */
  async getCurrentBranchPr(): Promise<number | null> {
    return getCurrentBranchPr(this.cwd);
  }

  /**
   * Fetch full PR details by number.
   * Runs 3 commands concurrently via Promise.all.
   */
  async getPrDetails(prNumber: number): Promise<PullRequestDetails> {
    return getPrDetails(this.cwd, prNumber);
  }

  /**
   * Fetch just CI checks for a PR.
   */
  async getPrChecks(
    prNumber: number,
  ): Promise<PullRequestDetails["checks"]> {
    return getPrChecks(this.cwd, prNumber);
  }

  /**
   * Fetch review comments with resolution state via GraphQL.
   */
  async getPrComments(
    prNumber: number,
  ): Promise<PullRequestDetails["reviewComments"]> {
    return getPrComments(this.cwd, prNumber);
  }

  /**
   * Get repo slug (owner/repo) from git remote.
   */
  async getRepoSlug(): Promise<string> {
    return getRepoSlug(this.cwd);
  }

  /**
   * Create a webhook for this repository via the GitHub API.
   */
  async createWebhook(
    webhookUrl: string,
    secret: string,
  ): Promise<{ id: number }> {
    return createWebhook(this.cwd, webhookUrl, secret);
  }

  /**
   * Delete a webhook for this repository.
   */
  async deleteWebhook(hookId: number): Promise<void> {
    return deleteWebhook(this.cwd, hookId);
  }

  /**
   * List existing webhooks to check if one already exists for our gateway.
   */
  async listWebhooks(): Promise<
    Array<{ id: number; config: { url: string } }>
  > {
    return listWebhooks(this.cwd);
  }
}
