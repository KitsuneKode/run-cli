import type { WorkspaceContext } from "../context.ts";
import type { ParsedArgs } from "../args.ts";
import type { Command } from "./types.ts";
import { ProcessRegistry } from "../process-registry.ts";
import { info } from "../output.ts";

export const pruneCommand: Command = {
  name: "prune",
  description: "Remove stopped and exited background processes from registry",
  flags: {
    "dry-run": { type: "boolean", description: "Only print what would be pruned" },
    json: { type: "boolean", description: "Format output as JSON" },
  },
  execute: async (ctx, parsed) => {
    const registry = new ProcessRegistry();
    const dryRun = parsed.dryRun;
    const { removed, kept, cleaned } = await registry.withLock(() =>
      registry.prune({ dryRun }),
    );

    if (parsed.json) {
      info(`${JSON.stringify({ removed, kept, cleaned, dryRun }, null, 2)}\n`);
    } else if (removed === 0) {
      info("Nothing to prune.");
    } else {
      const prefix = dryRun ? "Would prune" : "Pruned";
      const suffix = kept > 0 ? ` (${kept} running kept)` : "";
      info(
        `${prefix} ${removed} dead process${removed === 1 ? "" : "es"}: ${cleaned.join(", ")}${suffix}`,
      );
    }
  },
};
