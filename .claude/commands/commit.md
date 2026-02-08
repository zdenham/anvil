Commit all uncommitted changes with an appropriate commit message.

1. Run `git status` to see what files have changed
2. Run `git diff --staged` and `git diff` to understand the changes
3. Analyze the changes and write a concise, descriptive commit message that:
   - Uses imperative mood (e.g., "Add feature" not "Added feature")
   - Summarizes WHAT changed and WHY in the first line (max 72 chars)
   - Optionally includes a body with more details if the change is complex
4. Stage all changes with `git add -A`
5. Commit with the message

Do NOT push to remote unless explicitly asked.
