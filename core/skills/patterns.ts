/**
 * Regex pattern for matching skill invocations in messages.
 *
 * Matches: /skill-name or /skill-name args
 * - Only at word boundary (start of string or after whitespace)
 * - Skill names: lowercase letters, numbers, underscores, hyphens
 * - Args: everything after the skill name until newline
 *
 * Capture groups:
 * - [1] skill slug (e.g., "commit", "review-pr")
 * - [2] args (optional, e.g., "fix authentication bug")
 *
 * LIMITATIONS:
 * - Uses lookbehind (?<=\s) which requires ES2018+
 * - Browser support: Chrome 62+, Firefox 78+, Safari 16.4+
 * - Node.js support: v8.10+
 * - Does NOT handle URLs (http://...) - caller must filter
 * - Does NOT handle escape sequences (// for literal /) - handled by trigger system
 *
 * @example
 * "/commit fix bug" => ["commit", "fix bug"]
 * "hello /review-pr 123" => ["review-pr", "123"]
 * "/deploy" => ["deploy", ""]
 */
export const SKILL_PATTERN = /(?:^|(?<=\s))\/([a-z0-9_-]+)(?:\s+([^\n]*))?/gim;

/**
 * Non-lookbehind version for environments that don't support it.
 * Requires manual filtering of matches at non-word-boundary positions.
 * Capture groups shift: [1] = preceding whitespace, [2] = slug, [3] = args
 */
export const SKILL_PATTERN_COMPAT = /(^|\s)\/([a-z0-9_-]+)(?:\s+([^\n]*))?/gim;
