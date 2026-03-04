# HTML Snapshots

Capture the full page HTML at a specific point during a Playwright test and dump it to a file for offline analysis. Useful when you need to inspect DOM structure, check for missing elements, or verify rendered attributes without stepping through the browser.

## Taking a Snapshot

```typescript
import { writeFileSync } from 'fs';
import path from 'path';

test('repro: inspect DOM state', async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  // ... navigate to the state you want to inspect ...

  // Snapshot the full page
  const html = await app.page.content();
  const outPath = path.join(__dirname, 'snapshot.html');
  writeFileSync(outPath, html, 'utf-8');
  console.log(`Snapshot written to ${outPath}`);
});
```

### Scoped Snapshots

Capture a specific subtree instead of the entire page to reduce noise:

```typescript
// Snapshot a single element's subtree
const el = app.page.locator('[data-testid="content-pane"]');
const html = await el.evaluate(node => node.outerHTML);
writeFileSync(path.join(__dirname, 'snapshot-content-pane.html'), html, 'utf-8');
```

### Timed / Multi-Point Snapshots

Capture before and after an interaction to compare:

```typescript
const snapshotDir = __dirname;

const before = await app.page.content();
writeFileSync(path.join(snapshotDir, 'snapshot-before.html'), before, 'utf-8');

await thread.submit();
await thread.waitForAssistantResponse();

const after = await app.page.content();
writeFileSync(path.join(snapshotDir, 'snapshot-after.html'), after, 'utf-8');
```

## Searching Snapshots

HTML snapshots are large — **do not read the entire file**. Use Grep to search for what you need:

```bash
# Find elements by test ID
grep -n 'data-testid="thread-item"' e2e/debug/snapshot.html

# Find elements by class name
grep -n 'class=".*diff-header.*"' e2e/debug/snapshot.html

# Check for a specific attribute or value
grep -n 'aria-expanded="false"' e2e/debug/snapshot.html

# Count occurrences of an element
grep -c 'data-testid="message-bubble"' e2e/debug/snapshot.html

# Show surrounding context (5 lines before/after)
grep -n -B5 -A5 'data-testid="error-banner"' e2e/debug/snapshot.html
```

Use the **Grep tool** (not bash grep) when working interactively — it supports regex, context lines, and file globbing:

```
pattern: data-testid="thread-item"
path: e2e/debug/snapshot.html
output_mode: content
context: 3
```

## Cleanup

Snapshot files land in `e2e/debug/` which is gitignored. Delete them when you're done:

```bash
rm -f e2e/debug/snapshot*.html
```
