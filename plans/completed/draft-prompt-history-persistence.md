# Draft Prompt History Persistence

## Problem Statement

Currently, when users type a prompt in the spotlight but don't submit it (either by losing focus or closing the spotlight), the draft prompt is lost. Users need to be able to access these draft prompts in their prompt history even when they haven't been submitted.

## Current Behavior

1. **Prompt History**: Only saved when a task is submitted (`activateResult()` in spotlight.tsx:534)
2. **Spotlight Focus Loss**: When spotlight loses focus (`panel-hidden` event), `resetState()` is called which clears the input (`query: ""`)
3. **No Draft Tracking**: No explicit "dirty" state tracking exists
4. **History Navigation**: Only shows previously submitted prompts

## Desired Behavior

1. **Draft Auto-Save**: Save draft prompts to history when spotlight becomes unfocused while input is "dirty"
2. **Draft Indication**: Distinguish draft prompts from submitted prompts in history
3. **Draft Persistence**: Draft prompts should persist across application sessions
4. **Draft Cleanup**: Submitted prompts should replace their draft versions

## Technical Approach

### 1. Store Drafts as Normal History Entries

**File**: `src/lib/prompt-history-service.ts`

**Changes**:
- Use existing schema without modification - no need for `isDraft` or `draftId` fields
- Store draft prompts as regular history entries (without taskId)
- Distinguish drafts from submitted prompts by the absence of `taskId`

**New Methods**:
- `addDraft(prompt: string): Promise<void>` - Store draft as regular entry without taskId
- `exists(prompt: string): Promise<boolean>` - Check if prompt already exists in history to prevent duplicates
- No need for `promoteDraftToSubmitted` - just add new entry with taskId when submitted

### 2. Simplified Draft Detection

**File**: `src/components/spotlight/spotlight.tsx`

**Changes**:
- No need for `isDirty` state tracking
- Use simple checks: skip if input is blank or if prompt already exists in history
- Rely on existing prompt history to prevent duplicates

### 3. Implement Draft Auto-Save on Focus Loss

**File**: `src/components/spotlight/spotlight.tsx`

**Changes**:
- Modify `panel-hidden` event handler to save drafts before reset
- Simple logic: save if input is not blank and doesn't already exist in history

```typescript
// Modified panel-hidden handler
const handlePanelHidden = useCallback(async () => {
  const trimmedQuery = query.trim();

  // Save draft if input is non-empty and not already in history
  if (trimmedQuery !== "") {
    const existsInHistory = await promptHistoryService.exists(trimmedQuery);
    if (!existsInHistory) {
      try {
        await promptHistoryService.addDraft(trimmedQuery);
        logger.debug("[Spotlight] Draft saved on focus loss:", { query: trimmedQuery });
      } catch (error) {
        logger.error("[Spotlight] Failed to save draft:", error);
      }
    }
  }

  // Existing reset logic
  resetState();
}, [query, resetState]);
```

### 4. Update History Navigation

**File**: `src/components/spotlight/use-spotlight-history.ts`

**Changes**:
- Draft entries are automatically included since they're stored as regular history entries
- Distinguish drafts from submitted prompts by checking for absence of `taskId`
- No changes needed to existing navigation logic

```typescript
// History loading remains the same - drafts are included automatically
// Drafts can be identified as entries where taskId is undefined

const isDraft = (entry: PromptHistoryEntry) => !entry.taskId;
```

### 5. Update Submission Logic

**File**: `src/components/spotlight/spotlight.tsx`

**Changes**:
- No changes needed to submission logic
- When submitting any prompt (whether originally a draft or not), just add it normally with taskId
- The existing `promptHistoryService.add(result.data.query, taskId)` call handles everything

```typescript
// No changes needed - existing logic works fine:
const activateResult = useCallback(async (result: SpotlightResult) => {
  // ... existing pre-submission logic

  if (result.type === "task") {
    try {
      // This handles both new prompts and submitting drafts
      await promptHistoryService.add(result.data.query, taskId);
    } catch (error) {
      logger.error("[Spotlight] Failed to update prompt history:", error);
    }
  }

  // ... rest of existing logic
}, []);
```

### 6. Visual Draft Indicators

**File**: `src/components/spotlight/results-tray.tsx` (or relevant component)

**Changes**:
- Add visual indicators in history navigation to show draft vs submitted prompts
- Use italics, different color, or icon to indicate draft status

```typescript
// In history result rendering
const renderHistoryEntry = (entry: PromptHistoryEntry) => {
  const isDraft = !entry.taskId;

  return (
    <div className={`history-entry ${isDraft ? 'draft' : 'submitted'}`}>
      <span className="prompt-text">
        {isDraft && <span className="draft-indicator">📝 </span>}
        {entry.prompt}
      </span>
      <span className="timestamp">{formatTimestamp(entry.timestamp)}</span>
    </div>
  );
};
```

## Implementation Plan

### Phase 1: Core Infrastructure
1. **Add methods to PromptHistoryService**
   - Add `addDraft(prompt: string)` method
   - Add `exists(prompt: string)` method for duplicate checking
   - No schema changes needed - use existing structure

### Phase 2: Spotlight Integration
1. **Add draft detection logic**
   - Implement simple blank/duplicate checks
   - Add focus loss draft saving

### Phase 3: Focus Loss Handling
1. **Modify panel-hidden event handler**
   - Save drafts before clearing state
   - Handle edge cases (empty prompts, duplicates)

### Phase 4: Visual Indicators
1. **Add UI indicators for drafts**
   - Visual distinction in history navigation
   - Clear indication of draft status by checking absence of taskId

## Edge Cases and Considerations

### Data Consistency
- **Draft Cleanup**: Implement cleanup for old/stale drafts (e.g., older than 30 days)
- **No Migration Needed**: Existing history files work as-is since no schema changes
- **Corruption Recovery**: Graceful handling if draft data is corrupted

### User Experience
- **Draft Limits**: Consider limiting number of drafts (e.g., max 20 drafts)
- **Performance**: Ensure auto-save doesn't impact typing performance
- **Keyboard Navigation**: Ensure draft entries work properly with up/down navigation

### Technical Considerations
- **Async Safety**: Handle race conditions between auto-save and manual submission
- **Error Handling**: Graceful degradation if draft save fails
- **Testing**: Comprehensive tests for draft lifecycle and edge cases
- **Duplicate Prevention**: Consider deduplicating identical drafts or submitted prompts

### Configuration Options
- **Settings**: Allow users to disable draft auto-save if preferred
- **Auto-save Timing**: Configurable debounce timing for auto-save
- **Draft Retention**: Configurable retention period for drafts

## File Changes Summary

| File | Type of Change | Description |
|------|----------------|-------------|
| `src/lib/prompt-history-service.ts` | Minor | Add `addDraft` and `exists` methods |
| `src/components/spotlight/spotlight.tsx` | Moderate | Add draft auto-save on focus loss |
| `src/components/spotlight/results-tray.tsx` | Minor | Add draft visual indicators |

## Success Criteria

1. ✅ **Draft Persistence**: Unfocused prompts are saved and retrievable
2. ✅ **Draft Indication**: Users can distinguish drafts from submitted prompts
3. ✅ **Draft Promotion**: Submitting a draft properly promotes it to submitted status
4. ✅ **Performance**: No noticeable impact on typing or navigation performance
5. ✅ **Backward Compatibility**: Existing history continues to work seamlessly
6. ✅ **Error Recovery**: Graceful handling of draft save failures

## Testing Strategy

### Unit Tests
- PromptHistoryService draft and exists methods
- Draft detection logic (blank/duplicate checks)
- Draft promotion logic

### Integration Tests
- End-to-end draft save/restore flow
- History navigation with mixed draft/submitted entries
- Focus loss scenarios

### Manual Testing
- Type prompt → lose focus → regain focus → check history
- Submit draft → verify promotion
- Navigate mixed history with keyboard
- Performance testing with many drafts

## Future Enhancements

1. **Cross-Session Draft Sync**: Sync drafts across multiple Mortician instances
2. **Draft Search**: Allow searching within draft prompts
3. **Draft Folders**: Organize drafts by topic/project
4. **Draft Templates**: Save commonly used prompt patterns as templates
5. **Auto-Complete from Drafts**: Suggest completions based on draft history