/**
 * GuideContent
 *
 * Concise reference guide shown in new/empty tabs.
 */
export function GuideContent() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-8 max-w-[900px] mx-auto w-full">
      {/* Shortcuts */}
      <section className="mb-6">
        <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
          Shortcuts
        </h2>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <ShortcutRow keys="⌘ Space" action="Spotlight (global)" />
          <ShortcutRow keys="⌘ N" action="New thread" />
          <ShortcutRow keys="⌘ T" action="New terminal" />
          <ShortcutRow keys="⌘ P" action="Command palette" />
          <ShortcutRow keys="⌘ W" action="Close tab" />
          <ShortcutRow keys="⌘ ⇧ F" action="Search files" />
          <ShortcutRow keys="⌘ 0-9" action="Quick actions" />
        </div>
      </section>

      <Divider />

      {/* Skills */}
      <section className="mb-6">
        <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
          Orchestration
        </h2>
        <div className="space-y-1.5 text-sm">
          <ConceptRow
            name="/decompose"
            description="Break a task into sub-plans, execute in parallel waves"
          />
          <ConceptRow
            name="/breadcrumb-loop"
            description="Run a task across multiple context windows via progress files"
          />
          <ConceptRow
            name="/orchestrate"
            description="Programmatic agent coordination with mort-repl"
          />
        </div>
      </section>

      <Divider />

      {/* Modes */}
      <section className="mb-6">
        <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
          Modes
        </h2>
        <div className="space-y-1.5 text-sm">
          <ModeRow name="Implement" description="All tools auto-approved" />
          <ModeRow name="Plan" description="Read-only, writes only to plans/" />
          <ModeRow name="Approve" description="File edits require diff approval" />
        </div>
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
  return <hr className="border-surface-700/50 mb-6" />;
}
