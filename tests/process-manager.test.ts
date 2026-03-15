import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

import { terminateProcess } from "../src/process-manager.ts";
import { isProcessRunning } from "../src/process-metrics.ts";

function spawnSleeper(): number {
  const child = spawn("sleep", ["60"], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  if (!child.pid) {
    throw new Error("Failed to spawn sleep process");
  }

  return child.pid;
}

describe("terminateProcess", () => {
  test("terminates a running process with SIGTERM", async () => {
    const pid = spawnSleeper();

    expect(isProcessRunning(pid)).toBe(true);

    await terminateProcess(pid);

    expect(isProcessRunning(pid)).toBe(false);
  });

  test("no-ops for an already exited process", async () => {
    const pid = spawnSleeper();
    process.kill(pid, "SIGKILL");

    // Wait briefly for the process to die
    await Bun.sleep(100);

    expect(isProcessRunning(pid)).toBe(false);

    // Should not throw
    await terminateProcess(pid);
  });

  test("escalates to SIGKILL for SIGTERM-resistant process", async () => {
    // Spawn a process that traps SIGTERM
    const child = spawn("sh", ["-c", "trap '' TERM; sleep 60"], {
      detached: true,
      stdio: "ignore",
    });

    child.unref();
    const pid = child.pid ?? -1;

    expect(isProcessRunning(pid)).toBe(true);

    // Use short grace periods to keep the test fast
    await terminateProcess(pid, { termGraceMs: 300, killGraceMs: 500 });

    expect(isProcessRunning(pid)).toBe(false);
  });
});
