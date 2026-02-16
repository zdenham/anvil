---
name: commit
description: Create a well-formatted git commit with conventional commit messages
argument-hint: "[message]"
---

When creating commits:
1. Stage only relevant changes (use `git add -p` for partial staging if needed)
2. Write clear, conventional commit messages following the format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `refactor:` for code refactoring
   - `test:` for test additions/changes
   - `chore:` for maintenance tasks

3. If $ARGUMENTS is provided, use it as the commit message
4. Otherwise, analyze staged changes and generate an appropriate message
5. Always show the user the proposed commit before executing
