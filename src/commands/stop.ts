import type { ParsedArgs } from "../args.ts";
import type { WorkspaceContext } from "../context.ts";
import { info } from "../output.ts";
import { signalManagedProcess } from "../process-manager.ts";
import { ProcessRegistry } from "../process-registry.ts";
import type { Command } from "./types.ts";

export const stopCommand: Command = {
  name: "stop",
  description: "Stop a running managed process",
  usage: "<name|id>",
  execute: async (ctx, parsed) => {
    const identifier = parsed.positionals[1];
    if (!identifier) {
      throw new Error("Usage: run stop <name|id>");
    }

    const registry = new ProcessRegistry();
    const processRecord = await signalManagedProcess(registry, identifier, "SIGTERM", "stopped");
    info(`stopped ${processRecord.name}`);
  },
};
