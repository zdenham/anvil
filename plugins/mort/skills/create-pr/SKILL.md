---
name: Create Pull Request
description: Creates a GitHub pull request for the current branch
user-invocable: true
allowed-tools: bash,read,grep,glob
---

Create a pull request for the current branch using the GitHub CLI.

## Instructions

1. Check the current branch and recent commits to understand what this PR is about:
   - Run `git log --oneline main..HEAD` (or appropriate base branch) to see commits
   - Run `git diff --stat main..HEAD` to see changed files

2. Draft a PR title and description:
   - Title: concise summary under 70 characters
   - Description: summarize the changes, motivation, and any notable decisions
   - Use conventional commit style for the title if the repo follows that convention

3. Create the PR:
   ```bash
   gh pr create --title "the title" --body "$(cat <<'EOF'
   ## Summary
   <description>

   ## Changes
   <bullet list of key changes>
   EOF
   )"
   ```

4. If `gh pr create` fails because the branch hasn't been pushed, push it first:
   ```bash
   git push -u origin HEAD
   ```
   Then retry the PR creation.

5. Report the PR URL when done.
