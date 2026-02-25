import { useEffect, useMemo, useState } from "react";
import { useSkillsStore, skillsService } from "@/entities/skills";
import { useRepoStore } from "@/entities/repositories";
import { fsCommands } from "@/lib/tauri-commands";
import { SkillListItem } from "./skill-list-item";
import { SettingsSection } from "../settings-section";
import { FolderOpen, ExternalLink, RefreshCw } from "lucide-react";
import { syncManagedSkills } from "@/lib/skill-sync";

export function SkillsSettings() {
  const skillsRecord = useSkillsStore(state => state.skills);
  const skills = useMemo(() => useSkillsStore.getState().getAll(), [skillsRecord]);
  const repositories = useRepoStore(state => state.repositories);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Get the first repository's source path (most common case)
  const firstRepo = Object.values(repositories)[0];
  const repoPath = firstRepo?.sourcePath;

  const handleResync = async () => {
    if (!repoPath) return;
    setIsSyncing(true);
    try {
      await syncManagedSkills();
      const [homeDir, mortDir] = await Promise.all([
        fsCommands.getHomeDir(),
        fsCommands.getDataDir(),
      ]);
      const discoveredSkills = await skillsService.discover(repoPath, homeDir, mortDir);
      const freshRecord: Record<string, typeof discoveredSkills[0]> = {};
      for (const skill of discoveredSkills) {
        freshRecord[skill.id] = skill;
      }
      useSkillsStore.getState().hydrate(freshRecord, repoPath);
    } finally {
      setIsSyncing(false);
    }
  };

  // Refresh skills when settings opens
  useEffect(() => {
    const discoverSkills = async () => {
      if (!repoPath) return;

      setIsLoading(true);
      try {
        const [homeDir, mortDir] = await Promise.all([
          fsCommands.getHomeDir(),
          fsCommands.getDataDir(),
        ]);
        const discoveredSkills = await skillsService.discover(repoPath, homeDir, mortDir);

        // Hydrate the store with discovered skills
        const skillsRecord: Record<string, typeof discoveredSkills[0]> = {};
        for (const skill of discoveredSkills) {
          skillsRecord[skill.id] = skill;
        }
        useSkillsStore.getState().hydrate(skillsRecord, repoPath);
      } finally {
        setIsLoading(false);
      }
    };

    discoverSkills();
  }, [repoPath]);

  const projectSkills = skills.filter(s =>
    s.source === 'project' || s.source === 'project_command'
  );
  const personalSkills = skills.filter(s =>
    s.source === 'personal' || s.source === 'personal_command' || s.source === 'mort'
  );

  return (
    <SettingsSection
      title="Skills"
      description="Skills extend agent capabilities. Use /skill-name to invoke."
    >
      <div className="space-y-6">
        {/* Help text */}
        <div className="text-sm text-surface-400 space-y-2">
          <p>Create skills in these locations:</p>
          <ul className="list-disc list-inside space-y-1 text-xs font-mono text-surface-500">
            <li>~/.mort/skills/&lt;name&gt;/SKILL.md (Mort-specific)</li>
            <li>~/.claude/skills/&lt;name&gt;/SKILL.md (Personal)</li>
            <li>&lt;repo&gt;/.claude/skills/&lt;name&gt;/SKILL.md (Project)</li>
            <li>~/.claude/commands/&lt;name&gt;.md (Legacy)</li>
          </ul>
        </div>

        {/* Skills list */}
        {isLoading ? (
          <div className="text-center py-8 text-surface-400">
            <p>Discovering skills...</p>
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-8 text-surface-400">
            <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No skills found</p>
            <p className="text-xs mt-1">
              Create a SKILL.md file in one of the locations above
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {projectSkills.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-2">
                  Project Skills ({projectSkills.length})
                </h4>
                <div className="border border-surface-700 rounded-md px-3 bg-surface-800/30">
                  {projectSkills.map(skill => (
                    <SkillListItem key={skill.id} skill={skill} />
                  ))}
                </div>
              </div>
            )}

            {personalSkills.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-2">
                  Personal Skills ({personalSkills.length})
                </h4>
                <div className="border border-surface-700 rounded-md px-3 bg-surface-800/30">
                  {personalSkills.map(skill => (
                    <SkillListItem key={skill.id} skill={skill} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Re-sync built-in skills */}
        <button
          onClick={handleResync}
          disabled={isSyncing}
          className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Re-sync built-in skills'}
        </button>

        {/* Link to docs */}
        <a
          href="https://docs.anthropic.com/en/docs/claude-code/skills"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-surface-500 hover:text-surface-300 transition-colors"
        >
          Learn more about skills
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </SettingsSection>
  );
}
