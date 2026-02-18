import { describe, it } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getTemplateActionPath, runQuickAction, createMortFixture } from '../harness/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('debug paths', () => {
  it('shows resolved paths', async () => {
    // Show the path from this test file
    console.log('Test __dirname:', __dirname);

    // Resolve runner path as the harness would
    const runnerPath = path.resolve(__dirname, '../../../../sdk-runner.mjs');
    console.log('Runner path:', runnerPath);

    // Check if runner exists
    const fs = await import('fs/promises');
    try {
      await fs.access(runnerPath);
      console.log('Runner exists: YES');
    } catch {
      console.log('Runner exists: NO');
    }

    // Show action path
    const actionPath = getTemplateActionPath('close-panel');
    console.log('Action path:', actionPath);

    try {
      await fs.access(actionPath);
      console.log('Action exists: YES');
    } catch {
      console.log('Action exists: NO');
    }

    // Try running
    const fixture = await createMortFixture();
    console.log('Mort dir:', fixture.mortDir);

    const result = await runQuickAction({
      actionPath,
      context: {
        contextType: 'empty',
        repository: null,
        worktree: null,
      },
      mortDir: fixture.mortDir,
      timeout: 5000,
    });

    console.log('Exit code:', result.exitCode);
    console.log('Events:', JSON.stringify(result.events, null, 2));
    console.log('Stderr:', result.stderr);

    await fixture.cleanup();
  });
});
