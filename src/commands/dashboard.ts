import { sleep } from "../fs.ts";
import { renderManagedDashboard } from "../managed-process-view.ts";
import { info } from "../output.ts";
import { ProcessRegistry } from "../process-registry.ts";
import { checkProcessManagementEnabled } from "../process-validation.ts";
import type { Command } from "./types.ts";

export const dashboardCommand: Command = {
  name: "dashboard",
  description: "Show a real-time monitoring dashboard for processes",
  usage: "[--watch]",
  flags: {
    watch: {
      type: "boolean",
      short: "w",
      description: "Keep running and refreshing dashboard",
    },
  },
  execute: async (ctx, parsed) => {
    await checkProcessManagementEnabled(ctx);
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
      if (!process.stdout.isTTY) {
        throw new Error("--watch requires an interactive terminal (stdout is not a TTY).");
      }
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
