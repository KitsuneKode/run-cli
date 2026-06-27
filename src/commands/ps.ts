import { sleep } from "../fs.ts";
import { renderManagedProcessList } from "../managed-process-view.ts";
import { info } from "../output.ts";
import { ProcessRegistry } from "../process-registry.ts";
import type { Command } from "./types.ts";

export const psCommand: Command = {
  name: "ps",
  description: "List running managed background processes",
  usage: "[--json] [--details] [--watch]",
  flags: {
    json: { type: "boolean", description: "Format output as JSON" },
    details: { type: "boolean", description: "Include listening ports" },
    watch: { type: "boolean", short: "w", description: "Keep running and refreshing output" },
  },
  execute: async (_ctx, parsed) => {
    const registry = new ProcessRegistry();
    const renderAndPrint = async () => {
      const snapshots = await registry.withLock(() =>
        registry.listSnapshots({
          includePorts: parsed.details,
          includeMemory: true,
        }),
      );

      if (parsed.json) {
        info(`${JSON.stringify(snapshots, null, 2)}\n`);
        return;
      }

      info(renderManagedProcessList(snapshots, { showPorts: parsed.details }));
    };

    if (parsed.watch) {
      process.stdout.write("\x1B[?25l"); // hide cursor
      process.on("SIGINT", () => {
        process.stdout.write("\x1B[?25h"); // show cursor
        process.exit(0);
      });

      while (true) {
        process.stdout.write("\x1B[H\x1B[2J"); // clear screen
        await renderAndPrint();
        await sleep(2000);
      }
    }

    await renderAndPrint();
  },
};
