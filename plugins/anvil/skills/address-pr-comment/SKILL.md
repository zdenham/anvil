---
name: Address PR Comment
description: Addresses a review comment on a pull request
user-invocable: true
allowed-tools: bash,read,edit,write,grep,glob
---

You are addressing a review comment on a pull request. The comment details
and file context are provided below.

## Instructions

1. Read the comment carefully and understand what change is being requested
2. Read the relevant file(s) and surrounding context
3. Make the requested changes
4. Verify the changes compile/lint if applicable
5. Commit with a message like "address review: <summary of change>"
6. Push the commit

## Important

- Only change what the reviewer asked for -- don't refactor unrelated code
- If the comment is a question (not a change request), reply via:
  ```bash
  gh pr comment {prNumber} --body "response text"
  ```
- If you're unsure what the reviewer means, leave a comment asking for
  clarification rather than guessing
- For top-level PR comments (not inline review comments): use your discretion
  to determine if the comment is actionable. Many PR comments are conversational
  ("LGTM", "looks good", etc.) and don't require code changes. If the comment
  doesn't request a specific change, skip it -- don't make unnecessary
  modifications.

## Concurrency Warning

Another agent may be working in this same worktree concurrently (e.g., fixing
CI while you address a review comment). Before committing:
1. Run `git status` to check for unexpected changes
2. If there are uncommitted changes you didn't make, do a `git stash` before
   your work and `git stash pop` after, or coordinate via sequential commits
3. Pull before pushing to avoid conflicts
