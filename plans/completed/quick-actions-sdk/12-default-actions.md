# 12 - Default SDK-Based Actions

## Overview

Implement the default quick actions using the SDK. These ship as part of the template and demonstrate SDK patterns.

## Files to Create

All files in `core/sdk/template/src/actions/`:

### `archive.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'archive',
  title: 'Archive',
  description: 'Complete and file away',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.archive(context.threadId);
      sdk.log.info('Archived thread', { threadId: context.threadId });
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.archive(context.planId);
      sdk.log.info('Archived plan', { planId: context.planId });
    }
  },
});
```

### `mark-unread.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'mark-unread',
  title: 'Mark Unread',
  description: 'Return to inbox for later',
  contexts: ['thread'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.markUnread(context.threadId);
      sdk.log.info('Marked thread as unread', { threadId: context.threadId });
    }
    // Plans don't have read/unread status
  },
});
```

### `next-unread.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'next-unread',
  title: 'Next Unread',
  description: 'Proceed to next unread item',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    await sdk.ui.navigateToNextUnread();
    sdk.log.info('Navigated to next unread');
  },
});
```

### `archive-and-next.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'archive-and-next',
  title: 'Archive & Next',
  description: 'Archive current item and go to next unread',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    // Archive current item
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.archive(context.threadId);
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.archive(context.planId);
    }

    // Navigate to next
    await sdk.ui.navigateToNextUnread();
    sdk.log.info('Archived and navigated to next unread');
  },
});
```

### `mark-read.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'mark-read',
  title: 'Mark Read',
  description: 'Mark as read without archiving',
  contexts: ['thread'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.markRead(context.threadId);
      sdk.log.info('Marked thread as read', { threadId: context.threadId });
    }
  },
});
```

### `close-panel.ts`

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'close-panel',
  title: 'Close',
  description: 'Close current panel',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    await sdk.ui.closePanel();
    sdk.log.info('Closed panel');
  },
});
```

### `example.ts`

Example action showing SDK patterns:

```typescript
import { defineAction } from '@anvil/sdk';

export default defineAction({
  id: 'example',
  title: 'Example Action',
  description: 'Demonstrates SDK usage patterns',
  contexts: ['thread', 'plan', 'empty'],

  async execute(context, sdk) {
    // Log context information
    sdk.log.info('Example action executed', {
      contextType: context.contextType,
      threadId: context.threadId,
      planId: context.planId,
      repo: context.repository?.name,
    });

    // Show what context we're in
    let message: string;
    switch (context.contextType) {
      case 'thread':
        message = `In thread: ${context.threadId}`;
        break;
      case 'plan':
        message = `In plan: ${context.planId}`;
        break;
      case 'empty':
        message = 'In empty state';
        break;
    }

    await sdk.ui.showToast(message, 'info');
  },
});
```

## Action Summary Table

| Action | ID | Contexts | Description |
|--------|-----|----------|-------------|
| Archive | `archive` | thread, plan | Archives the current item |
| Mark Unread | `mark-unread` | thread | Marks thread as unread |
| Mark Read | `mark-read` | thread | Marks thread as read |
| Next Unread | `next-unread` | thread, plan | Navigates to next unread |
| Archive & Next | `archive-and-next` | thread, plan | Archives then navigates |
| Close | `close-panel` | thread, plan | Closes current panel |
| Example | `example` | all | Demo action |

## Notes on Empty Context Actions

By default, no actions are shown in the empty context (except Example). Users can create their own empty-context actions like:

- "Start Fresh Thread" - Creates a new thread
- "Open Last Thread" - Navigates to most recently updated thread
- "Show Unread" - Shows unread items list

These are left for users to implement as they require additional SDK capabilities or are workflow-specific.

## Design Decisions Referenced

- **#21 Default Actions via SDK**: All built-in actions use SDK, no special code paths
- **#34 Empty State Actions**: Actions opt into empty context via contexts array

## Acceptance Criteria

- [ ] All default actions compile without errors
- [ ] Archive works for both threads and plans
- [ ] Mark read/unread works for threads
- [ ] Navigation actions work correctly
- [ ] Example action demonstrates SDK patterns
- [ ] Actions are properly typed
- [ ] All actions have meaningful descriptions

## Verification & Testing

### TypeScript Compilation Checks

1. **Verify actions compile without errors**
   ```bash
   cd ~/.anvil/quick-actions && npm run build
   ```
   Expected: Exit code 0, no TypeScript errors

2. **Run type checking independently**
   ```bash
   cd ~/.anvil/quick-actions && npx tsc --noEmit
   ```
   Expected: Exit code 0, no type errors

3. **Verify dist/manifest.json exists after build**
   ```bash
   test -f ~/.anvil/quick-actions/dist/manifest.json && echo "PASS" || echo "FAIL"
   ```
   Expected: "PASS"

### Type Definition Verification

4. **Verify SDK types are importable**
   Create a test file `~/.anvil/quick-actions/src/type-test.ts`:
   ```typescript
   import { defineAction, ActionContext, AnvilSDK } from '@anvil/sdk';

   // Verify defineAction accepts correct shape
   const testAction = defineAction({
     id: 'test',
     title: 'Test',
     description: 'Test action',
     contexts: ['thread', 'plan', 'empty'],
     async execute(context: ActionContext, sdk: AnvilSDK) {
       // Verify context properties exist
       const _type: 'thread' | 'plan' | 'empty' = context.contextType;
       const _threadId: string | undefined = context.threadId;
       const _planId: string | undefined = context.planId;

       // Verify SDK methods exist
       await sdk.threads.archive('');
       await sdk.threads.markRead('');
       await sdk.threads.markUnread('');
       await sdk.plans.archive('');
       await sdk.ui.navigateToNextUnread();
       await sdk.ui.closePanel();
       await sdk.ui.showToast('', 'info');
       sdk.log.info('');
     },
   });
   ```
   Then run: `npx tsc --noEmit`
   Expected: Exit code 0

### Manifest Verification

5. **Verify manifest contains all default actions**
   ```bash
   cat ~/.anvil/quick-actions/dist/manifest.json | jq '.actions | map(.id) | sort'
   ```
   Expected output (sorted):
   ```json
   ["archive", "archive-and-next", "close-panel", "example", "mark-read", "mark-unread", "next-unread"]
   ```

6. **Verify each action has required fields**
   ```bash
   cat ~/.anvil/quick-actions/dist/manifest.json | jq '.actions[] | {id, title, description, contexts} | select(.id == null or .title == null or .contexts == null)'
   ```
   Expected: Empty output (no actions missing required fields)

### Context Configuration Verification

7. **Verify context arrays are correctly set**
   ```bash
   cat ~/.anvil/quick-actions/dist/manifest.json | jq '.actions[] | select(.id == "mark-unread" or .id == "mark-read") | .contexts'
   ```
   Expected: Both should show `["thread"]` only

   ```bash
   cat ~/.anvil/quick-actions/dist/manifest.json | jq '.actions[] | select(.id == "example") | .contexts'
   ```
   Expected: `["thread", "plan", "empty"]`

### Entry Point Verification

8. **Verify each action's entry point exists**
   ```bash
   for action in archive mark-unread next-unread archive-and-next mark-read close-panel example; do
     test -f ~/.anvil/quick-actions/dist/actions/$action.js && echo "$action: PASS" || echo "$action: FAIL"
   done
   ```
   Expected: All actions show "PASS"

### Runtime Smoke Test

9. **Verify actions are valid ES modules**
   ```bash
   node --input-type=module -e "
     import archiveAction from './dist/actions/archive.js';
     console.log('archive:', typeof archiveAction.execute === 'function' ? 'PASS' : 'FAIL');
   " 2>/dev/null || echo "Module import failed"
   ```
   Run from `~/.anvil/quick-actions/` directory
   Expected: "archive: PASS"

### Design Decision Compliance Checks

10. **Verify no special code paths (DD #21)**
    - Grep the Anvil codebase for hardcoded action implementations:
    ```bash
    grep -r "archive\|markUnread\|markRead" src/ --include="*.ts" | grep -v "sdk\|SDK\|quick-actions" | head -20
    ```
    Expected: No results showing built-in action logic outside SDK system

11. **Verify actions use event emission not direct writes (DD #24, #33)**
    - Review action code to ensure no direct file system writes
    - All mutations should go through `sdk.threads.*`, `sdk.plans.*`, `sdk.ui.*`

### Error Handling Verification

12. **Verify actions handle missing context gracefully**
    - Each action that uses `context.threadId` or `context.planId` should check they exist before use
    - Review: `archive.ts`, `mark-unread.ts`, `mark-read.ts`, `archive-and-next.ts` all include context type guards
