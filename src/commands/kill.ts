import { info } from "../output.ts";
import { signalManagedProcess } from "../process-manager.ts";
import { ProcessRegistry } from "../process-registry.ts";
import type { Command } from "./types.ts";

export const killCommand: Command = {
  name: "kill",
  description: "Forcefully kill a running managed process",
  usage: "<name|id>",
  execute: async (_ctx, parsed) => {
    const identifier = parsed.positionals[1];
    if (!identifier) {
      throw new Error("Usage: run kill <name|id>");
    }

    const registry = new ProcessRegistry();
    const processRecord = await signalManagedProcess(registry, identifier, "SIGKILL", "exited");
    info(`killed ${processRecord.name}`);
  },
};
