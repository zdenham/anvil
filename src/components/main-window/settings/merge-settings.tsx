import { GitPullRequest, User } from "lucide-react";
import { SettingsSection } from "../settings-section";
import {
  useSettingsStore,
  settingsService,
  type WorkflowMode,
} from "@/entities/settings";

interface RadioOptionProps {
  id: string;
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}

function RadioOption({
  id,
  name,
  value,
  checked,
  onChange,
  icon,
  label,
  description,
}: RadioOptionProps) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors
        ${checked ? "bg-surface-700/50 border border-surface-600" : "bg-surface-800/30 border border-transparent hover:bg-surface-800/50"}`}
    >
      <input
        type="radio"
        id={id}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-accent-500"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2 text-surface-200 font-medium">
          {icon}
          <span>{label}</span>
        </div>
        <p className="text-sm text-surface-400 mt-1">{description}</p>
      </div>
    </label>
  );
}

export function MergeSettings() {
  const workflowMode = useSettingsStore((state) => state.getWorkflowMode());

  const handleWorkflowModeChange = (mode: WorkflowMode) => {
    settingsService.set("workflowMode", mode);
  };

  return (
    <SettingsSection
      title="Workflow Mode"
      description="Configure how completed task changes are integrated"
    >
      <div className="space-y-2">
        <RadioOption
          id="workflow-solo"
          name="workflowMode"
          value="solo"
          checked={workflowMode === "solo"}
          onChange={() => handleWorkflowModeChange("solo")}
          icon={<User size={16} />}
          label="Solo dev"
          description="Rebase onto local main, then fast-forward merge. Best for solo developers."
        />
        <RadioOption
          id="workflow-team"
          name="workflowMode"
          value="team"
          checked={workflowMode === "team"}
          onChange={() => handleWorkflowModeChange("team")}
          icon={<GitPullRequest size={16} />}
          label="Work on a team"
          description="Rebase onto origin/main and create a pull request for code review."
        />
      </div>
    </SettingsSection>
  );
}
