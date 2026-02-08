import { SkillsService } from '@core/lib/skills/skills-service.js';
import { TauriFSAdapter } from '@/adapters/tauri-fs-adapter';

/**
 * Frontend instance of SkillsService using Tauri filesystem adapter.
 * This singleton provides skill discovery and management for the desktop app.
 */
export const skillsService = new SkillsService(new TauriFSAdapter());
