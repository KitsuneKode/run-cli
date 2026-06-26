import type { WorkspaceContext } from "../context.ts";
import type { ParsedArgs } from "../args.ts";
import type { Command } from "./types.ts";
import { ProcessRegistry } from "../process-registry.ts";
import { renderManagedDashboard } from "../managed-process-view.ts";
import { info } from "../output.ts";
import { sleep } from "../fs.ts";

export const dashboardCommand: Command = {
  name: "dashboard",
  description: "Show a real-time monitoring dashboard for processes",
  flags: {
    watch: {
      type: "boolean",
      short: "w",
      description: "Keep running and refreshing dashboard",
    },
  },
  execute: async (ctx, parsed) => {
    const registry = new ProcessRegistry();
    const renderAndPrint = async () => {
      const snapshots = await registry.withLock(() =>
        registry.listSnapshots({
          includePorts: false,
          includeMemory: true,
        }),
      );
      info(renderManagedDashboard(snapshots));
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
