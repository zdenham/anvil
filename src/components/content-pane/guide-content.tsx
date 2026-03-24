import { FolderGit2, Plus } from "lucide-react";

/**
 * GuideContent
 *
 * Unified reference guide shown in new/empty tabs.
 * When no repo is configured, also shows get-started buttons.
 */
export function GuideContent({
  showGetStarted,
  onImportProject,
  onCreateProject,
}: {
  showGetStarted?: boolean;
  onImportProject?: () => void;
  onCreateProject?: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-8 max-w-[900px] mx-auto w-full">
        {/* Hero */}
        <section className="mb-6">
          <h1 className="text-lg font-medium font-mono text-surface-100 mb-1">
            Anvil
          </h1>
          <p className="text-sm text-surface-300 mb-2">
            The IDE built for pushing the boundaries of parallel coding agents.
          </p>
          <p className="text-sm text-surface-400 leading-relaxed">
            Run many agents simultaneously across isolated workspaces,
            coordinated by plans. Think of it as a control tower for
            AI-assisted development.
          </p>
        </section>

        <Divider />

        {/* Core concepts */}
        <section className="mb-6">
          <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
            Core Concepts
          </h2>
          <div className="space-y-1.5 text-sm">
            <ConceptRow
              name="Thread"
              description="A conversation with an agent. Each thread runs in its own context with full tool access."
            />
            <ConceptRow
              name="Workspace"
              description="An isolated git worktree where an agent operates. Changes stay contained until you merge."
            />
            <ConceptRow
              name="Plan"
              description="A structured breakdown of work. Agents read plans to stay aligned. You review and approve before implementation."
            />
            <ConceptRow
              name="REPL"
              description="Programmatic agent coordination. Script agent behavior, run queries, orchestrate complex workflows."
            />
          </div>
        </section>

        <Divider />

        {/* Plan-first development */}
        <section className="mb-6">
          <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
            Plan-First Development
          </h2>
          <p className="text-sm text-surface-400 leading-relaxed">
            Write a plan, decompose it into phases, let agents execute in
            parallel, review the diffs, and merge. Plans give you control over
            what agents do before they do it — you stay in the loop without
            micromanaging every edit.
          </p>
        </section>

        <Divider />

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
            Skills
          </h2>

          <h3 className="text-xs font-medium font-mono text-surface-400 uppercase tracking-wider mb-1.5 mt-3">
            Orchestration
          </h3>
          <div className="space-y-1.5 text-sm mb-3">
            <ConceptRow
              name="/breadcrumb-loop"
              description="Run a task across multiple context windows via progress files"
            />
            <ConceptRow
              name="/orchestrate"
              description="Programmatic agent coordination with anvil-repl"
            />
          </div>

          <h3 className="text-xs font-medium font-mono text-surface-400 uppercase tracking-wider mb-1.5">
            Workflow
          </h3>
          <div className="space-y-1.5 text-sm mb-3">
            <ConceptRow
              name="/commit"
              description="Create a well-formatted conventional commit"
            />
            <ConceptRow
              name="/create-pr"
              description="Create a GitHub pull request for the current branch"
            />
            <ConceptRow
              name="/fix-ci"
              description="Investigate and fix a CI check failure"
            />
          </div>

          <h3 className="text-xs font-medium font-mono text-surface-400 uppercase tracking-wider mb-1.5">
            Code Quality
          </h3>
          <div className="space-y-1.5 text-sm">
            <ConceptRow
              name="/simplify-code"
              description="Simplify and refine code for clarity and consistency"
            />
            <ConceptRow
              name="/address-comments"
              description="Address unresolved PR review comments"
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

        {/* Get started — only when no repo is configured */}
        {showGetStarted && (
          <>
            <Divider />
            <section className="mb-6">
              <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
                Get Started
              </h2>
              <p className="text-sm text-surface-400 mb-3">
                Add a project to begin working with agents.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onImportProject}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-surface-600 hover:border-surface-400 hover:bg-surface-800/50 transition-colors"
                >
                  <FolderGit2 size={20} className="text-surface-300" />
                  <span className="text-sm font-medium text-surface-200">Import existing</span>
                  <span className="text-xs text-surface-400">Open a git repository</span>
                </button>
                <button
                  onClick={onCreateProject}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-surface-600 hover:border-surface-400 hover:bg-surface-800/50 transition-colors"
                >
                  <Plus size={20} className="text-surface-300" />
                  <span className="text-sm font-medium text-surface-200">Create new project</span>
                  <span className="text-xs text-surface-400">Start from scratch</span>
                </button>
              </div>
            </section>
          </>
        )}
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
