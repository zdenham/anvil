---
name: review-pr
description: Review a pull request for code quality, bugs, and best practices
argument-hint: "[PR number or URL]"
---

When reviewing PRs:
1. Fetch PR details using `gh pr view $ARGUMENTS`
2. Analyze the diff for:
   - Code quality issues
   - Potential bugs
   - Security concerns
   - Performance implications
   - Test coverage
3. Provide constructive feedback with specific line references
4. Summarize overall assessment (approve, request changes, or comment)
