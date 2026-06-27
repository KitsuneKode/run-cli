import { info } from "../output.ts";
import { signalManagedProcess } from "../process-manager.ts";
import { ProcessRegistry } from "../process-registry.ts";
import type { Command } from "./types.ts";

export const stopCommand: Command = {
  name: "stop",
  description: "Stop a running managed process",
  usage: "<name|id> | --all",
  flags: {
    all: { type: "boolean", description: "Stop all running managed processes" },
  },
  execute: async (_ctx, parsed) => {
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
        info("No running processes to stop.");
        return;
      }
      for (const record of running) {
        await signalManagedProcess(registry, record.name, "SIGTERM", "stopped");
        info(`stopped ${record.name}`);
      }
      return;
    }

    if (!identifier) {
      throw new Error("Usage: run stop <name|id> [--all]");
    }

    const processRecord = await signalManagedProcess(registry, identifier, "SIGTERM", "stopped");
    info(`stopped ${processRecord.name}`);
  },
};
