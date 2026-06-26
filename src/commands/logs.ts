import { spawn } from "node:child_process";
import type { WorkspaceContext } from "../context.ts";
import type { ParsedArgs } from "../args.ts";
import type { Command } from "./types.ts";
import { ProcessRegistry } from "../process-registry.ts";
import { pathExists, readTextFile } from "../fs.ts";
import { info } from "../output.ts";
import type { ManagedProcessSnapshot } from "../types.ts";

export const logsCommand: Command = {
  name: "logs",
  description: "View logs of a managed process",
  flags: {
    follow: { type: "boolean", short: "f", description: "Stream log changes" },
    lines: { type: "number", description: "Number of trailing lines to show" },
  },
  execute: async (ctx, parsed) => {
    const identifier = parsed.positionals[1];
    if (!identifier) {
      throw new Error("Usage: run logs <name|id>");
    }

    const registry = new ProcessRegistry();
    const processRecord = await requireProcessSnapshot(registry, identifier);

    if (!(await pathExists(processRecord.logPath))) {
      throw new Error(`Log file not found: ${processRecord.logPath}`);
    }

    const linesCount = parsed.lines ?? 40;

    if (parsed.follow) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("tail", ["-n", String(linesCount), "-f", processRecord.logPath], {
          stdio: "inherit",
        });

        child.on("exit", (code) => {
          if (code === 0 || code === null) {
            resolve();
            return;
          }

          reject(new Error(`tail exited with code ${code}.`));
        });

        child.on("error", reject);
      });

      return;
    }

    const content = await readTextFile(processRecord.logPath);
    const lines = content.trimEnd().split("\n").slice(-linesCount);
    info(`${lines.join("\n")}\n`);
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
