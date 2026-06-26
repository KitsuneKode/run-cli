import type { WorkspaceContext } from "../context.ts";
import type { ParsedArgs } from "../args.ts";
import type { Command } from "./types.ts";
import { ProcessRegistry } from "../process-registry.ts";
import { renderManagedProcessDetails } from "../managed-process-view.ts";
import { info } from "../output.ts";
import type { ManagedProcessSnapshot } from "../types.ts";

export const inspectCommand: Command = {
  name: "inspect",
  description: "Show detailed status of a managed process",
  flags: {
    json: { type: "boolean", description: "Format output as JSON" },
  },
  execute: async (ctx, parsed) => {
    const identifier = parsed.positionals[1];
    if (!identifier) {
      throw new Error("Usage: run inspect <name|id>");
    }

    const registry = new ProcessRegistry();
    const processRecord = await requireProcessSnapshot(registry, identifier);

    if (parsed.json) {
      info(`${JSON.stringify(processRecord, null, 2)}\n`);
      return;
    }

    info(renderManagedProcessDetails(processRecord));
  },
};

async function requireProcessSnapshot(
  registry: ProcessRegistry,
  identifier: string,
): Promise<ManagedProcessSnapshot> {
  return await registry.withLock(async () => {
    const processRecord = await registry.getSnapshot(identifier);

    if (!processRecord) {
      const snapshots = await registry.listSnapshots();
      const availableNames = snapshots.map((entry) => entry.name).join(", ");
      throw new Error(
        availableNames.length > 0
          ? `Managed process "${identifier}" was not found. Available: ${availableNames}`
          : `Managed process "${identifier}" was not found.`,
      );
    }

    return processRecord;
  });
}
