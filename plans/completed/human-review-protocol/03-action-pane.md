# 03: Action Pane

**Dependencies:** 01-types
**Enables:** None (end of chain)

---

## Goal

Update the frontend action pane to detect and handle pending review requests.

---

## Tasks

### 1. Detect pending review state

When rendering the action pane, check if `task.pendingReview` is set. If so, switch to review mode.

### 2. Render markdown content

Display the `pendingReview.markdown` content using a markdown renderer.

### 3. Show input with placeholder

Display an input field with `defaultResponse` as the placeholder text.

### 4. Handle empty submit (Enter)

When user submits with empty input:
- Clear `pendingReview` from task metadata
- Spawn new agent with `defaultResponse` as the user message

### 5. Handle text submit

When user submits with text:
- Clear `pendingReview` from task metadata
- Spawn new agent with user's text as the message

---

## Implementation Reference

```typescript
function ActionPane({ task, onSpawnAgent }) {
  const [input, setInput] = useState("");

  if (!task.pendingReview) {
    return <NormalInputState />;
  }

  const { markdown, defaultResponse } = task.pendingReview;

  const handleSubmit = () => {
    const message = input.trim() === "" ? defaultResponse : input;
    clearPendingReview(task.id);
    // Spawns new agent with task context + user message
    onSpawnAgent(task.id, message);
    setInput("");
  };

  return (
    <div>
      <MarkdownRenderer content={markdown} />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={defaultResponse}
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit()}
      />
    </div>
  );
}
```

---

## Clearing pendingReview

Create a function to clear the pending review:

```typescript
async function clearPendingReview(taskId: string) {
  await taskService.update(taskId, {
    pendingReview: null,
  });
}
```

---

## Event Subscription (Optional)

The action pane can optionally listen for `action-requested` events to reactively update when a review is requested. However, since the task metadata is the source of truth, polling or React Query invalidation may be sufficient.

---

## Acceptance Criteria

- [ ] Action pane detects when `pendingReview` is set
- [ ] Markdown content is rendered properly
- [ ] Input field shows `defaultResponse` as placeholder
- [ ] Empty submit sends `defaultResponse` to new agent
- [ ] Text submit sends user's text to new agent
- [ ] `pendingReview` is cleared after submission
- [ ] New agent receives full task context
