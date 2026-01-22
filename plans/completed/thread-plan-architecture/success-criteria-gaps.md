# Success Criteria Gaps

This document identifies gaps between the current thread-plan-architecture plans and three key success criteria, with recommendations for closing each gap.

---

## Success Criterion 1: Unified Inbox in Main Task Window

**Requirement:** The "tasks" tab should become a unified inbox showing both plans AND threads in the same style as what tasks used to be.

### ✅ RESOLVED

**Decision:** Truly unified list with NO separate sections or filter tabs.

**Implementation (updated in 07-ui-inbox.md):**
- Single unified list sorted by `updatedAt` descending
- **No filter tabs** - simple unified view
- **No section headers** - items are interleaved, not grouped
- **Icon differentiation** - MessageSquare icon for threads, FileText icon for plans
- **Display content:**
  - Threads: Show the last user message (truncated)
  - Plans: Show the plan filename (from `relativePath`)

---

## Success Criterion 2: Quick Actions and Control Panel Support for Plans

**Requirement:** Preserve "quick actions" to determine the next item to go to. The simple task panel (now control-panel) should support opening both plans OR threads from the unified list.

### ✅ RESOLVED

**Decision:** Control panel now supports both thread and plan views. Key behaviors:

**Implementation (updated in 08-control-panel.md):**

1. **Control Panel View Types:**
   ```typescript
   type ControlPanelViewType =
     | { type: 'thread'; threadId: string; tab: 'conversation' | 'plan' | 'changes' }
     | { type: 'plan'; planId: string; tab: 'content' | 'threads' };
   ```

2. **Plan View Tabs:**
   - **Content** - Rendered markdown of the plan file (read-only)
   - **Threads** - List of related threads
   - **NO Changes tab** for plans (plans don't have direct file changes)

3. **New Thread from Plan (Critical Behavior):**
   - When viewing a plan, if user types and sends a message:
     - A **new thread is created**
     - Message is **automatically prefixed** with `@plan:{planId}` mention
     - Creates a `mentioned` relation between new thread and plan
     - Control panel switches to show the new thread conversation
   - Input placeholder shows: "Start a new thread about this plan..."

4. **Opening plans from inbox:**
   - Click plan in inbox → opens control panel with plan view (`tab: 'content'`)

---

## Success Criterion 3: Plan Status (Running vs Read vs Unread)

**Requirement:** How will plans be considered "running vs read vs unread" as displayed in the unified control panel view?

### ✅ RESOLVED

**Decision:** Plans have three visual states, and automatically become unread when modified by a thread.

**Implementation (updated in 06-relations.md):**

1. **Plan Visual States:**
   - **Running** (green pulse) - if any associated thread has `status === 'running'`
   - **Unread** (accent color) - if `isRead: false`
   - **Read** (grey) - default

2. **When Plans Become Unread:**
   - When created (default `isRead: false`)
   - **When a thread modifies the plan** (via RELATION_CREATED/UPDATED events)
   - When user explicitly marks it unread

3. **Status Transitions:**
   ```
   create → UNREAD
   user views → READ
   thread modifies → UNREAD
   user marks unread → UNREAD
   ```

4. **Event Handlers (in 06-relations.md):**
   ```typescript
   // Mark plan unread when modified by thread
   eventBus.on(EventName.RELATION_CREATED, async ({ planId, type }) => {
     if (type === 'modified') {
       await planService.markUnread(planId);
     }
   });
   ```

**Visual precedence:** Running > Unread > Read

---

## Summary

All three success criteria have been addressed with updates to the existing plan files:

| Criterion | Status | Files Updated |
|-----------|--------|---------------|
| Unified Inbox | ✅ Resolved | 07-ui-inbox.md |
| Control Panel Plan View | ✅ Resolved | 08-control-panel.md |
| Plan Status Transitions | ✅ Resolved | 06-relations.md |

---

## Open Questions - RESOLVED

### 1. Should clicking a plan in the inbox open the control panel, or open the plan file in an external editor?
**Resolution:** Open in control panel (consistent UX). The control panel shows plan content in the "Content" tab with read-only markdown rendering.

### 2. When viewing a plan in control panel, what happens if user starts typing?
**Resolution:** When viewing a plan, if user types and sends a message:
- A **new thread is created** (not appending to existing thread)
- Message is **automatically prefixed** with `@plan:{planId}` mention
- Creates a `mentioned` relation between new thread and plan
- Control panel switches to show the new thread conversation
- Input placeholder: "Start a new thread about this plan..."

### 3. Should plans support the "Changes" tab?
**Resolution:** No. Plans do not support the "Changes" tab. Plan view only has:
- **Content** tab - read-only markdown
- **Threads** tab - list of related threads
