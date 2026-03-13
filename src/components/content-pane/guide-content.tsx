/**
 * GuideContent
 *
 * Static reference guide shown in the empty pane.
 * Displays keyboard shortcuts, permission modes, core concepts, and tips.
 */
export function GuideContent() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-8 max-w-[900px] mx-auto w-full">
      {/* Getting Started */}
      <section className="mb-8">
        <h2 className="text-lg font-medium font-mono text-surface-100 mb-3">
          Getting Started
        </h2>
        <p className="text-sm text-surface-400 leading-relaxed">
          Mort orchestrates parallel Claude Code agents from your desktop.
          Use the Spotlight bar (<Kbd>⌘ Space</Kbd>) for quick access from anywhere.
        </p>
      </section>

      <Divider />

      {/* Orchestration Skills */}
      <section className="mb-8">
        <h2 className="text-lg font-medium font-mono text-surface-100 mb-3">
          Orchestration Skills
        </h2>
        <p className="text-sm text-surface-400 mb-3 leading-relaxed">
          Use these slash commands to coordinate multi-agent work.
        </p>
        <div className="space-y-2 text-sm">
          <ConceptRow
            name="/decompose"
            description="Break a complex task into sub-plans with dependency ordering, then execute them in parallel waves. Best for large features and multi-file refactors."
          />
          <ConceptRow
            name="/breadcrumb-loop"
            description="Run a task that exceeds a single context window. Sequential agents pick up where the last left off via progress files. Best for large migrations and sweeping changes."
          />
          <ConceptRow
            name="/orchestrate"
            description="Programmatically spawn and coordinate agents with mort-repl. Write JS/TS to control parallelism, sequencing, and conditional logic."
          />
        </div>
      </section>

      <Divider />

      {/* Keyboard Shortcuts */}
      <section className="mb-8">
        <h2 className="text-lg font-medium font-mono text-surface-100 mb-3">
          Keyboard Shortcuts
        </h2>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <ShortcutRow keys="⌘ Space" action="Open Spotlight (global)" />
          <ShortcutRow keys="⌘ N" action="New thread" />
          <ShortcutRow keys="⌘ T" action="New terminal" />
          <ShortcutRow keys="⌘ P" action="Command palette" />
          <ShortcutRow keys="⌘ W" action="Close tab" />
          <ShortcutRow keys="⌘ ⇧ F" action="Search across files" />
          <ShortcutRow keys="⌘ F" action="Find in page" />
          <ShortcutRow keys="⌘ ⇧ D" action="Toggle debug panel" />
          <ShortcutRow keys="⌘ 0-9" action="Quick actions" />
        </div>
      </section>

      <Divider />

      {/* Permission Modes */}
      <section className="mb-8">
        <h2 className="text-lg font-medium font-mono text-surface-100 mb-3">
          Permission Modes
        </h2>
        <p className="text-sm text-surface-400 mb-3 leading-relaxed">
          Choose a mode when creating threads. Cycle with the mode selector in the input bar.
        </p>
        <div className="space-y-2 text-sm">
          <ModeRow
            name="Implement"
            description="All tools auto-approved. Agent works autonomously."
          />
          <ModeRow
            name="Plan"
            description="Read everything, write only to plans/. For architecture and design."
          />
          <ModeRow
            name="Approve"
            description="Read/Bash auto-approved, file edits require your approval with diff preview."
          />
        </div>
      </section>

      <Divider />

      {/* Core Concepts */}
      <section className="mb-8">
        <h2 className="text-lg font-medium font-mono text-surface-100 mb-3">
          Core Concepts
        </h2>
        <div className="space-y-2 text-sm">
          <ConceptRow
            name="Threads"
            description="Conversations with Claude Code agents that run in your project"
          />
          <ConceptRow
            name="Workspaces"
            description="Isolated branches for parallel work without conflicts"
          />
          <ConceptRow
            name="Plans"
            description="Markdown documents for designing before implementing"
          />
          <ConceptRow
            name="Terminals"
            description="Integrated terminal sessions tied to workspaces"
          />
          <ConceptRow
            name="Quick Actions"
            description="Scriptable automations bound to ⌘ 0-9 (configurable in Settings)"
          />
        </div>
      </section>

      <Divider />

      {/* Tips */}
      <section className="mb-8">
        <h2 className="text-lg font-medium font-mono text-surface-100 mb-3">
          Tips
        </h2>
        <ul className="space-y-1.5 text-sm text-surface-400">
          <li>
            <Kbd>⌘ Click</Kbd> or middle-click sidebar items to open in a new tab
          </li>
          <li>
            Use the command palette (<Kbd>⌘ P</Kbd>) to quickly find threads, plans, and files
          </li>
          <li>Quick actions appear in the bottom gutter bar</li>
        </ul>
      </section>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="font-mono text-xs text-surface-200 bg-surface-700/50 px-1.5 py-0.5 rounded border border-surface-600/50">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, action }: { keys: string; action: string }) {
  return (
    <>
      <Kbd>{keys}</Kbd>
      <span className="text-surface-400">{action}</span>
    </>
  );
}

function ModeRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="text-surface-400">
      <span className="text-surface-200 font-medium">{name}</span>
      {" — "}
      {description}
    </div>
  );
}

function ConceptRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="text-surface-400">
      <span className="text-surface-200 font-medium">{name}</span>
      {" — "}
      {description}
    </div>
  );
}

function Divider() {
  return <hr className="border-surface-700/50 mb-8" />;
}
