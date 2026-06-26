import type { WorkspaceContext } from "../context.ts";
import type { ParsedArgs } from "../args.ts";
import type { Command } from "./types.ts";
import { ProcessRegistry } from "../process-registry.ts";
import { restartManagedProcess } from "../process-manager.ts";
import { info } from "../output.ts";

export const restartCommand: Command = {
  name: "restart",
  description: "Restart a managed process",
  execute: async (ctx, parsed) => {
    const identifier = parsed.positionals[1];
    if (!identifier) {
      throw new Error("Usage: run restart <name|id>");
    }

    const registry = new ProcessRegistry();
    const globalConfig = await ctx.getGlobalConfig();
    const processRecord = await restartManagedProcess(registry, identifier, {
      globalConfig,
    });
    info(`restarted ${processRecord.name}`);
    info(`  pid: ${processRecord.pid}`);
  },
};
