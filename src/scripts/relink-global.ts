#!/usr/bin/env bun

import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function runCommand(command: string[], options?: { allowFailure?: boolean }): void {
  const result = Bun.spawnSync(command, {
    cwd: repoRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0 && !options?.allowFailure) {
    process.exit(result.exitCode);
  }
}

runCommand(["bun", "run", "build"]);
runCommand(["bun", "unlink"], { allowFailure: true });
runCommand(["bun", "link"]);
