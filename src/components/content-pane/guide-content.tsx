import { FolderGit2, Plus } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

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
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-4 py-8 max-w-[900px] mx-auto w-full">
        {/* Shortcuts */}
        <section className="mb-6">
          <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
            Shortcuts
          </h2>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <ShortcutRow keys="⌘ P" action="Command palette" />
            <ShortcutRow keys="⌘ Space" action="Spotlight (global)" />
            <ShortcutRow keys="⌘ N" action="New thread" />
            <ShortcutRow keys="⌘ T" action="New terminal" />
            <ShortcutRow keys="⌘ W" action="Close tab" />
            <ShortcutRow keys="⌘ ⇧ F" action="Search files" />
            {/* <ShortcutRow keys="⌘ 0-9" action="Quick actions" /> */}
          </div>
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
              description="A conversation with an agent. Threads live in the left sidebar."
            />
            <ConceptRow
              name="Workspace"
              description="A disposable git worktree. Agents work here in isolation so changes never touch your main branch."
            />
            <ConceptRow
              name="Plan"
              description="A markdown file that coordinates agents. Create plans in the plans/ directory."
            />
            <ConceptRow
              name="REPL"
              description="Script agents programmatically. Used by orchestration skills."
            />
          </div>
        </section>

        <Divider />

        {/* Orchestration */}
        <section className="mb-6">
          <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
            Orchestration
          </h2>
          <div className="space-y-1.5 text-sm">
            <ConceptRow
              name="/breadcrumb-loop"
              description="Long-running task that picks up where the last agent left off"
            />
            <ConceptRow
              name="/orchestrate"
              description="Spawn and coordinate multiple agents in parallel"
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
          <p className="text-xs text-surface-500 mt-2">
            * All modes run with dangerously allow permissions enabled.
          </p>
        </section>

        {/* Community */}
        <Divider />
        <section className="mb-6">
          <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
            Community
          </h2>
          <p className="text-sm text-surface-400 mb-3">
            Got a question, idea, or just want to see what others are building?
          </p>
          <button
            onClick={() => openUrl("https://discord.gg/tbkAetedSd")}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-surface-100 bg-surface-700 hover:bg-surface-600 rounded-md transition-colors"
          >
            Join the Discord →
          </button>
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
