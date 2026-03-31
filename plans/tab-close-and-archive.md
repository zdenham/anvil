# Tab Context Menu: Close & Archive

Add a "Close & Archive" option to the tab right-click context menu so users can close and archive a tab's entity in one action.

## Context

- Tab context menu is in `src/components/split-layout/tab-item.tsx` (lines 239-254)
- Currently has two options: **Rename** (conditional) and **Close**
- Archive services already exist for threads (`threadService.archive`), plans (`planService.archive`), and terminals (`TerminalContentProps.onArchive`)
- View types that support archiving: `thread`, `plan`, `terminal`
- View types that do NOT support archiving: `empty`, `settings`, `logs`, `archive`, `file`, `pull-request`, `changes`

## Design

- Add a **"Close & Archive"** menu item between Rename and Close
- Only show it when `tab.view.type` is `thread`, `plan`, or `terminal`
- Use the `ArchiveRestore` (or `Archive`) lucide icon
- On click: call the appropriate archive service, then close the tab
- Archive first, close second — if archive fails, the tab stays open

## Phases

- [ ] Add "Close & Archive" context menu item to `tab-item.tsx` — conditionally rendered for archivable view types, wired to the correct archive service based on `view.type`, followed by `paneLayoutService.closeTab`
- [ ] Verify cascade archive import paths and ensure no circular dependencies

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### File: `src/components/split-layout/tab-item.tsx`

1. Import archive services:
   - `threadService` from `@/entities/threads/service` (already imported)
   - `planService` from `@/entities/plans/service`
   - `terminalSessionService` from `@/entities/terminal-sessions/service` (already imported)
   - `Archive` icon from `lucide-react`

2. Add a helper or inline check for whether the view is archivable:
   ```ts
   const archivable = tab.view.type === "thread" || tab.view.type === "plan" || tab.view.type === "terminal";
   ```

3. Add the archive handler:
   ```ts
   const handleCloseAndArchive = async () => {
     ctxMenu.close();
     if (tab.view.type === "thread") {
       await threadService.archive(tab.view.threadId);
     } else if (tab.view.type === "plan") {
       await planService.archive(tab.view.planId);
     } else if (tab.view.type === "terminal") {
       await terminalSessionService.archive(tab.view.terminalId);
     }
     paneLayoutService.closeTab(groupId, tab.id);
   };
   ```

4. Insert the menu item between Rename and Close:
   ```tsx
   {archivable && (
     <ContextMenuItem
       icon={Archive}
       label="Close & Archive"
       onClick={handleCloseAndArchive}
     />
   )}
   ```

5. Add a `ContextMenuDivider` between "Close & Archive" and "Close" when archivable, to visually separate the destructive-ish action.
