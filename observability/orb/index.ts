#!/usr/bin/env node
import { loadConfig } from './env';
import { closeClient } from './client';
import {
  queryCommand,
  listCommand,
  tailCommand,
  sessionsCommand,
  statsCommand,
  searchCommand,
  checkCommand,
  initCommand,
  schemaCommand,
  helpCommand,
} from './commands';
import { CommandContext } from './types';
import { OutputFormat } from './format';

async function main() {
  const args = process.argv.slice(2);

  // Handle --help, --version, and 'help' command before loading config
  if (args.length === 0 || args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    helpCommand();
    return;
  }

  if (args.includes('--version')) {
    console.log('orb 0.1.0');
    return;
  }

  // Parse global options
  let format: OutputFormat = 'json';
  let verbose = false;
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format' || arg === '-f') {
      format = (args[++i] as OutputFormat) ?? 'json';
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else {
      filteredArgs.push(arg);
    }
  }

  // Load config (may throw with helpful error)
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const ctx: CommandContext = { config, format, verbose };

  try {
    await runCommand(ctx, filteredArgs);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await closeClient();
  }
}

async function runCommand(ctx: CommandContext, args: string[]) {
  const [command, ...rest] = args;

  // Parse command-specific options
  const options: Record<string, string | number | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--limit' || arg === '-n') {
      options.limit = parseInt(rest[++i], 10);
    } else if (arg === '--level' || arg === '-l') {
      options.level = rest[++i];
    } else if (arg === '--session' || arg === '-s') {
      options.session = rest[++i];
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  // Route to command handlers
  switch (command) {
    case 'query':
      await queryCommand(ctx, positional.join(' '));
      break;

    case 'list':
      await listCommand(ctx);
      break;

    case 'tail':
      await tailCommand(ctx, options as { limit?: number; level?: string; session?: string });
      break;

    case 'sessions':
      await sessionsCommand(ctx, options as { limit?: number });
      break;

    case 'stats':
      await statsCommand(ctx, options as { session?: string });
      break;

    case 'search':
      await searchCommand(ctx, positional[0] ?? '', options as { limit?: number; level?: string });
      break;

    case 'check':
      await checkCommand(ctx);
      break;

    case 'init':
      await initCommand(ctx);
      break;

    case 'schema':
      await schemaCommand(ctx);
      break;

    case 'help':
      helpCommand();
      break;

    default:
      // If command looks like SQL, execute it directly
      if (command && (
        command.toUpperCase().startsWith('SELECT') ||
        command.toUpperCase().startsWith('SHOW') ||
        command.toUpperCase().startsWith('DESCRIBE')
      )) {
        await queryCommand(ctx, [command, ...rest].join(' '));
      } else if (command) {
        console.error(`Unknown command: ${command}`);
        console.error('Run "pnpm orb help" for usage.');
        process.exit(1);
      }
  }
}

main();
