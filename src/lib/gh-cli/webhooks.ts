/**
 * Webhook CRUD operations via gh CLI.
 * Uses the GitHub REST API through `gh api`.
 */

import { execGhJson, execGh } from "./executor";
import { getRepoSlug } from "./pr-queries";
import { z } from "zod";

const WebhookSchema = z.object({
  id: z.number(),
  config: z.object({
    url: z.string(),
  }),
});

const CreateWebhookResponseSchema = z.object({
  id: z.number(),
});

/**
 * Create a webhook for a repository via the GitHub API.
 * One webhook per repo, shared across all PRs.
 *
 * Events subscribed: pull_request, issue_comment, check_run, check_suite,
 * pull_request_review
 *
 * Uses gh api with -f/-F flags and bracket syntax for nested fields,
 * since Command.create doesn't support piping stdin.
 */
export async function createWebhook(
  cwd: string,
  webhookUrl: string,
  secret: string,
): Promise<{ id: number }> {
  const repoSlug = await getRepoSlug(cwd);

  const result = await execGhJson(
    [
      "api",
      `repos/${repoSlug}/hooks`,
      "--method",
      "POST",
      "-f",
      "name=web",
      "-F",
      "active=true",
      "-f",
      `config[url]=${webhookUrl}`,
      "-f",
      "config[content_type]=json",
      "-f",
      `config[secret]=${secret}`,
      "-f",
      "events[]=pull_request",
      "-f",
      "events[]=issue_comment",
      "-f",
      "events[]=check_run",
      "-f",
      "events[]=check_suite",
      "-f",
      "events[]=pull_request_review",
    ],
    cwd,
  );

  return CreateWebhookResponseSchema.parse(result);
}

/**
 * Delete a webhook for a repository.
 */
export async function deleteWebhook(
  cwd: string,
  hookId: number,
): Promise<void> {
  const repoSlug = await getRepoSlug(cwd);
  await execGh(
    ["api", `repos/${repoSlug}/hooks/${hookId}`, "--method", "DELETE"],
    cwd,
  );
}

/**
 * List existing webhooks to check if one already exists for our gateway.
 */
export async function listWebhooks(
  cwd: string,
): Promise<Array<{ id: number; config: { url: string } }>> {
  const repoSlug = await getRepoSlug(cwd);
  const raw = await execGhJson<unknown[]>(
    ["api", `repos/${repoSlug}/hooks`],
    cwd,
  );
  return z.array(WebhookSchema).parse(raw);
}
