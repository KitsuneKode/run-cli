import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

import { getProcessStartTime, isProcessRunning } from "../src/process-metrics.ts";

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

describe("getProcessStartTime", () => {
  test("returns a non-empty string for a running process", () => {
    const pid = spawnSleeper();

    try {
      const startTime = getProcessStartTime(pid);
      expect(startTime).toBeString();
      expect(startTime?.length).toBeGreaterThan(0);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });

  test("returns null for a non-existent process", () => {
    expect(getProcessStartTime(999999)).toBeNull();
  });
});

describe("isProcessRunning with PID reuse detection", () => {
  test("returns true when start time matches", () => {
    const pid = spawnSleeper();

    try {
      const startTime = getProcessStartTime(pid);
      expect(isProcessRunning(pid, startTime ?? undefined)).toBe(true);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });

  test("returns false when start time does not match (simulated PID reuse)", () => {
    const pid = spawnSleeper();

    try {
      // Provide a fake start time that won't match the actual process
      expect(isProcessRunning(pid, "Thu Jan  1 00:00:00 1970")).toBe(false);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });

  test("returns true without expectedStartTime (backwards compatible)", () => {
    const pid = spawnSleeper();

    try {
      expect(isProcessRunning(pid)).toBe(true);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });
});
