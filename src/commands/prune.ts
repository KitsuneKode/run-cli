import { info } from "../output.ts";
import { ProcessRegistry } from "../process-registry.ts";
import type { Command } from "./types.ts";

export const pruneCommand: Command = {
  name: "prune",
  description: "Remove stopped and exited background processes from registry",
  usage: "[--json] [--dry-run]",
  flags: {
    "dry-run": { type: "boolean", description: "Only print what would be pruned" },
    json: { type: "boolean", description: "Format output as JSON" },
  },
  execute: async (_ctx, parsed) => {
    const registry = new ProcessRegistry();
    const dryRun = parsed.dryRun;
    const { removed, kept, cleaned, logsRemoved } = await registry.withLock(() =>
      registry.prune({ dryRun }),
    );

    if (parsed.json) {
      info(`${JSON.stringify({ removed, kept, cleaned, logsRemoved, dryRun }, null, 2)}\n`);
    } else if (removed === 0) {
      info("Nothing to prune.");
    } else {
      const prefix = dryRun ? "Would prune" : "Pruned";
      const suffix = kept > 0 ? ` (${kept} running kept)` : "";
      const logSuffix =
        logsRemoved > 0 ? ` (+${logsRemoved} log file${logsRemoved === 1 ? "" : "s"} removed)` : "";
      info(
        `${prefix} ${removed} dead process${removed === 1 ? "" : "es"}: ${cleaned.join(", ")}${suffix}${logSuffix}`,
      );
    }
  },
};
