/**
 * PR-specific gh CLI queries.
 * Fetches PR details, checks, and review comments.
 */

import { z } from "zod";
import type { PullRequestDetails } from "@core/types/pull-request.js";
import { execGh, execGhJson } from "./executor";
import { logger } from "@/lib/logger-client";
import {
  GhPrViewSchema,
  GhPrCheckSchema,
  GhReviewThreadNodeSchema,
} from "./pr-schemas";

/**
 * Get the current branch's PR number, or null if no PR exists.
 */
export async function getCurrentBranchPr(
  cwd: string,
): Promise<number | null> {
  try {
    const result = await execGh(
      ["pr", "view", "--json", "number", "--jq", ".number"],
      cwd,
    );
    const num = parseInt(result.stdout.trim(), 10);
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

/**
 * Fetch full PR details by number.
 * Runs 3 commands concurrently via Promise.all.
 */
export async function getPrDetails(
  cwd: string,
  prNumber: number,
): Promise<PullRequestDetails> {
  const [viewData, checks, comments] = await Promise.all([
    fetchPrView(cwd, prNumber),
    getPrChecks(cwd, prNumber),
    getPrComments(cwd, prNumber),
  ]);

  return {
    title: viewData.title,
    body: viewData.body,
    state: viewData.state,
    author: viewData.author.login,
    url: viewData.url,
    isDraft: viewData.isDraft,
    labels: viewData.labels.map((l) => l.name),
    reviewDecision: viewData.reviewDecision,
    reviews: viewData.reviews.map((r) => ({
      author: r.author.login,
      state: r.state,
      body: r.body,
      submittedAt: r.submittedAt,
    })),
    checks,
    reviewComments: comments,
  };
}

async function fetchPrView(cwd: string, prNumber: number) {
  const fields =
    "title,body,state,author,url,isDraft,labels,reviewDecision,reviews";
  const raw = await execGhJson(
    ["pr", "view", String(prNumber), "--json", fields],
    cwd,
  );

  return GhPrViewSchema.parse(raw);
}

/**
 * Fetch just CI checks for a PR.
 */
export async function getPrChecks(
  cwd: string,
  prNumber: number,
): Promise<PullRequestDetails["checks"]> {
  try {
    const raw = await execGhJson<unknown[]>(
      [
        "pr",
        "checks",
        String(prNumber),
        "--json",
        "name,state,bucket,link,startedAt,completedAt",
      ],
      cwd,
    );

    const parsed = z.array(GhPrCheckSchema).parse(raw);
    return parsed.map((c) => ({
      name: c.name,
      status: mapCheckBucket(c.bucket),
      conclusion: c.state || null,
      url: c.link,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
    }));
  } catch (error) {
    logger.warn("[GhCli] Failed to fetch PR checks, returning empty", { error });
    return [];
  }
}

function mapCheckBucket(
  bucket: string,
): "pass" | "fail" | "pending" | "skipping" | "cancelled" {
  switch (bucket) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "pending":
      return "pending";
    case "skipping":
      return "skipping";
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

/**
 * Fetch review comments with resolution state via GraphQL.
 */
export async function getPrComments(
  cwd: string,
  prNumber: number,
): Promise<PullRequestDetails["reviewComments"]> {
  try {
    const repoSlug = await getRepoSlug(cwd);
    const [owner, repo] = repoSlug.split("/");

    const query = `{
  repository(owner: "${owner}", name: "${repo}") {
    pullRequest(number: ${prNumber}) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          comments(first: 10) {
            nodes {
              id
              author { login }
              body
              path
              line
              createdAt
              url
            }
          }
        }
      }
    }
  }
}`;

    const raw = await execGhJson<{
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: { nodes?: unknown[] };
          };
        };
      };
    }>(["api", "graphql", "-f", `query=${query}`], cwd);

    const threads =
      raw.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    const parsed = z.array(GhReviewThreadNodeSchema).parse(threads);

    return parsed.flatMap((thread) =>
      thread.comments.nodes.map((comment) => ({
        id: comment.id,
        author: comment.author?.login ?? "unknown",
        body: comment.body,
        path: comment.path,
        line: comment.line,
        createdAt: comment.createdAt,
        url: comment.url,
        isResolved: thread.isResolved,
      })),
    );
  } catch (error) {
    logger.warn("[GhCli] Failed to fetch PR comments, returning empty", {
      error,
    });
    return [];
  }
}

/**
 * Get repo slug (owner/repo) from git remote.
 */
export async function getRepoSlug(cwd: string): Promise<string> {
  const result = await execGh(
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    cwd,
  );
  return result.stdout.trim();
}
