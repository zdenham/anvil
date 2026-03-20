/**
 * Agent process command dispatch.
 * Handles `agent_spawn`, `agent_kill`, `agent_cancel`.
 */

import { extractArg } from "../helpers.js";
import type { SidecarState } from "../state.js";

export async function dispatchAgent(
  cmd: string,
  args: Record<string, unknown>,
  state: SidecarState,
): Promise<unknown> {
  switch (cmd) {
    case "agent_spawn":
      return state.agentProcesses.spawn(
        extractArg(args, "threadId"),
        extractArg(args, "commandArgs"),
        extractArg(args, "cwd"),
        extractArg(args, "env"),
        state.broadcaster,
      );

    case "agent_kill":
      return state.agentProcesses.kill(extractArg(args, "threadId"));

    case "agent_cancel":
      return state.agentProcesses.cancel(extractArg(args, "threadId"));

    default:
      throw new Error(`unknown agent command: ${cmd}`);
  }
}
