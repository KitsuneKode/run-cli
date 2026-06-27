import { info } from "../output.ts";
import { ProcessRegistry } from "../process-registry.ts";
import type { Command } from "./types.ts";

export const portsCommand: Command = {
  name: "ports",
  description: "List listening ports of managed background processes",
  usage: "[--json]",
  flags: {
    json: { type: "boolean", description: "Format output as JSON" },
  },
  execute: async (_ctx, parsed) => {
    const registry = new ProcessRegistry();
    const snapshots = await registry.withLock(() =>
      registry.listSnapshots({
        includePorts: true,
        includeMemory: false,
      }),
    );
    const portRows = snapshots.map((processRecord) => ({
      name: processRecord.name,
      pid: processRecord.pid,
      status: processRecord.status,
      ports: processRecord.ports,
    }));

    if (parsed.json) {
      info(`${JSON.stringify(portRows, null, 2)}\n`);
      return;
    }

    if (portRows.length === 0) {
      info("No managed processes.\n");
      return;
    }

    for (const portRow of portRows) {
      info(
        `${portRow.name} pid=${portRow.pid} status=${portRow.status} ports=${
          portRow.ports.length > 0 ? portRow.ports.join(",") : "-"
        }`,
      );
    }
  },
};
