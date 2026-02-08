import { SkillsService } from '@core/lib/skills/skills-service.js';
import { NodeFileSystemAdapter } from '@core/adapters/node/fs-adapter.js';
import { AsyncFileSystemAdapter } from '@core/adapters/async-wrapper.js';

/**
 * Agent instance of SkillsService using Node.js filesystem adapter.
 * Wraps the sync NodeFileSystemAdapter in an async wrapper for FSAdapter compatibility.
 */
const nodeFs = new AsyncFileSystemAdapter(new NodeFileSystemAdapter());
export const skillsService = new SkillsService(nodeFs);
