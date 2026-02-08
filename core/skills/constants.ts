import type { SkillSource } from '@core/types/skills.js';

/**
 * Source priority order for skill resolution.
 * Lower index = higher priority. When multiple skills have the same slug,
 * the one from the higher priority source wins (project shadows personal).
 */
export const SOURCE_PRIORITY: readonly SkillSource[] = [
  'project',           // 0 - highest priority
  'project_command',   // 1
  'mort',              // 2
  'personal',          // 3
  'personal_command',  // 4 - lowest priority
] as const;

/**
 * Icons for each skill source.
 * Uses Lucide icon names for consistency across UI components.
 * @see https://lucide.dev/icons
 */
export const SOURCE_ICONS: Record<SkillSource, string> = {
  project: 'folder',           // Project-level skills
  project_command: 'folder-code', // Legacy project commands
  mort: 'sparkles',            // Mort-specific skills
  personal: 'user',            // User's personal skills
  personal_command: 'terminal', // Legacy personal commands
};

/**
 * Display labels for skill sources.
 * Used in dropdowns, badges, and tooltips.
 */
export const SOURCE_LABELS: Record<SkillSource, string> = {
  project: 'Project',
  project_command: 'Project',
  mort: 'Mort',
  personal: 'Personal',
  personal_command: 'Personal',
};

/**
 * Badge styling for each source in settings UI.
 * Uses Tailwind classes for consistent theming.
 */
export const SOURCE_BADGE_STYLES: Record<SkillSource, { label: string; className: string }> = {
  project: { label: 'Project', className: 'bg-blue-500/10 text-blue-600' },
  project_command: { label: 'Project', className: 'bg-blue-500/10 text-blue-600' },
  mort: { label: 'Mort', className: 'bg-purple-500/10 text-purple-600' },
  personal: { label: 'Personal', className: 'bg-green-500/10 text-green-600' },
  personal_command: { label: 'Personal', className: 'bg-green-500/10 text-green-600' },
};
