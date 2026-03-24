---
name: Fix CI Failure
description: Investigates and fixes a CI check failure on a pull request
user-invocable: true
allowed-tools: bash,read,edit,write,grep,glob
---

You are fixing a CI check failure on a pull request. The failing check
details are provided below.

## Instructions

1. Examine the failing check output to understand what went wrong
2. If the failure is in a test:
   - Read the test file and the code it tests
   - Determine if the test needs updating or the code has a bug
   - Fix accordingly
3. If the failure is a lint/build error:
   - Read the error output
   - Fix the source file
4. **Run the failing check locally to verify the fix before pushing.**
   This is critical -- do not push until you have confidence the fix works.
   Run the relevant test suite, linter, or build command locally.
5. Commit with a message like "fix: <what was fixed> (CI)"
6. Only push after local verification passes

## Important

- Focus only on the failing check -- don't fix unrelated issues
- If the failure seems like a flaky test or infrastructure issue, report it
  rather than making code changes
- If you can't determine the cause, report what you found
- **Do not push a fix unless you've verified it locally.** A bad push
  triggers another CI run and potentially another fix attempt, creating
  a feedback loop.

## Concurrency Warning

Another agent may be working in this same worktree concurrently (e.g.,
addressing review comments while you fix CI). Before committing:
1. Run `git status` to check for unexpected changes
2. If there are uncommitted changes you didn't make, do a `git stash` before
   your work and `git stash pop` after, or coordinate via sequential commits
3. Pull before pushing to avoid conflicts
