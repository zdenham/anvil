const features = [
  {
    icon: ">>",
    title: "Workspace management",
    description:
      "More agents, more progress. Isolated worktrees let you parallelize without merge conflicts.",
  },
  {
    icon: "[]",
    title: "First-class spec support",
    description:
      "The best UX for plan-driven development. Refine and execute plans in one click.",
  },
  {
    icon: "<>",
    title: "Full IDE",
    description:
      "Terminal, file editor, diff viewer — everything you need in one editor.",
  },
  {
    icon: "::",
    title: "REPL & orchestration",
    description:
      "Scriptable agent composition. Flexible building blocks, not rigid workflows.",
  },
  {
    icon: "@@",
    title: "Sub-agent visibility",
    description:
      "No more black boxes. See what child and grandchild agents are actually doing.",
  },
  {
    icon: "##",
    title: "Visual arrangement",
    description:
      "Up to a 4×3 grid of agent panels. Your workspace, your layout.",
  },
];

export function FeatureGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {features.map((feature) => (
        <div
          key={feature.title}
          className="group border border-surface-700 rounded-lg p-5 transition-all duration-200 hover:border-surface-500 hover:bg-surface-900/50"
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="text-surface-500 font-mono text-sm group-hover:text-surface-300 transition-colors">
              {feature.icon}
            </span>
            <h3 className="text-surface-50 font-mono font-semibold text-base m-0">
              {feature.title}
            </h3>
          </div>
          <p className="text-surface-400 text-sm leading-relaxed m-0 pl-8">
            {feature.description}
          </p>
        </div>
      ))}
    </div>
  );
}
