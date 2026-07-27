import { info } from "../output.ts";
import { signalManagedProcess } from "../process-manager.ts";
import { ProcessRegistry } from "../process-registry.ts";
import { checkProcessManagementEnabled } from "../process-validation.ts";
import type { Command } from "./types.ts";

export const killCommand: Command = {
  name: "kill",
  description: "Forcefully kill a running managed process",
  usage: "<name|id> | --all",
  flags: {
    all: { type: "boolean", description: "Kill all running managed processes" },
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
      const running = processes.filter((r) => r.status === "running");
      if (running.length === 0) {
        info("No running processes to kill.");
        return;
      }
      for (const record of running) {
        await signalManagedProcess(registry, record.name, "SIGKILL", "exited");
        info(`killed ${record.name}`);
      }
      return;
    }

    if (!identifier) {
      throw new Error("Usage: run kill <name|id> [--all]");
    }

    const processRecord = await signalManagedProcess(registry, identifier, "SIGKILL", "exited");
    info(`killed ${processRecord.name}`);
  },
};
