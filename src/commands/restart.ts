import { info } from "../output.ts";
import { restartManagedProcess } from "../process-manager.ts";
import { ProcessRegistry } from "../process-registry.ts";
import { checkProcessManagementEnabled } from "../process-validation.ts";
import type { Command } from "./types.ts";

export const restartCommand: Command = {
  name: "restart",
  description: "Restart a managed process",
  usage: "<name|id> | --all",
  flags: {
    all: { type: "boolean", description: "Restart all managed processes" },
  },
  execute: async (ctx, parsed) => {
    await checkProcessManagementEnabled(ctx);
    const identifier = parsed.positionals[1];
    const all = parsed.all;

    if (all && identifier) {
      throw new Error("--all cannot be combined with a process name.");
    }

    const registry = new ProcessRegistry();

    if (all) {
      const { processes } = await registry.withLock(() => registry.read());
      if (processes.length === 0) {
        info("No managed processes to restart.");
        return;
      }
      const globalConfig = await ctx.getGlobalConfig();
      for (const record of processes) {
        const restarted = await restartManagedProcess(registry, record.name, { globalConfig });
        info(`restarted ${restarted.name} (pid: ${restarted.pid})`);
      }
      return;
    }

    if (!identifier) {
      throw new Error("Usage: run restart <name|id> [--all]");
    }

    const globalConfig = await ctx.getGlobalConfig();
    const processRecord = await restartManagedProcess(registry, identifier, {
      globalConfig,
    });
    info(`restarted ${processRecord.name}`);
    info(`  pid: ${processRecord.pid}`);
  },
};
