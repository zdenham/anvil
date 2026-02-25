/**
 * Zod schemas for gh CLI PR-related JSON responses (trust boundary).
 *
 * Extracted from pr-queries.ts to keep file sizes under the 250-line limit.
 */

import { z } from "zod";

export const GhPrViewSchema = z.object({
  title: z.string(),
  body: z.string().default(""),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  author: z.object({ login: z.string() }),
  url: z.string(),
  isDraft: z.boolean(),
  labels: z.array(z.object({ name: z.string() })),
  reviewDecision: z
    .union([
      z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]),
      z.literal(""),
    ])
    .nullable()
    .default(null)
    .transform((v) => (v === "" ? null : v)),
  reviews: z.array(
    z.object({
      author: z.object({ login: z.string() }),
      state: z.enum([
        "APPROVED",
        "CHANGES_REQUESTED",
        "COMMENTED",
        "DISMISSED",
        "PENDING",
      ]),
      body: z.string().default(""),
      submittedAt: z.string(),
    }),
  ).default([]),
});

export const GhPrCheckSchema = z.object({
  name: z.string(),
  state: z.string(),
  bucket: z.string(),
  link: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
});

export const GhReviewThreadNodeSchema = z.object({
  isResolved: z.boolean(),
  comments: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        author: z.object({ login: z.string() }).nullable(),
        body: z.string(),
        path: z.string(),
        line: z.number().nullable().default(null),
        createdAt: z.string(),
        url: z.string(),
      }),
    ),
  }),
});
