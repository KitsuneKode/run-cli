import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

import {
  getBatchMetrics,
  getBatchPorts,
  getProcessStartTime,
  isProcessRunning,
} from "../src/process-metrics.ts";

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

describe("getBatchMetrics", () => {
  test("returns metrics for multiple running processes in a single call", () => {
    const pid1 = spawnSleeper();
    const pid2 = spawnSleeper();

    try {
      const metrics = getBatchMetrics([pid1, pid2]);

      expect(metrics.size).toBe(2);
      expect(metrics.get(pid1)?.rssKb).toBeNumber();
      expect(metrics.get(pid1)?.startTime).toBeString();
      expect(metrics.get(pid2)?.rssKb).toBeNumber();
      expect(metrics.get(pid2)?.startTime).toBeString();
    } finally {
      process.kill(pid1, "SIGKILL");
      process.kill(pid2, "SIGKILL");
    }
  });

  test("returns empty map for empty input", () => {
    expect(getBatchMetrics([]).size).toBe(0);
  });

  test("skips non-existent PIDs", () => {
    const pid = spawnSleeper();

    try {
      const metrics = getBatchMetrics([pid, 999999]);
      expect(metrics.has(pid)).toBe(true);
      expect(metrics.has(999999)).toBe(false);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });

  test("start time matches per-process getProcessStartTime", () => {
    const pid = spawnSleeper();

    try {
      const single = getProcessStartTime(pid);
      const batch = getBatchMetrics([pid]);
      expect(batch.get(pid)?.startTime).toBe(single);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });
});

describe("getBatchPorts", () => {
  test("returns empty map for empty input", () => {
    expect(getBatchPorts([]).size).toBe(0);
  });

  test("returns empty ports for processes not listening", () => {
    const pid = spawnSleeper();

    try {
      const ports = getBatchPorts([pid]);
      // sleep doesn't listen on any ports
      const pidPorts = ports.get(pid) ?? [];
      expect(pidPorts.length).toBe(0);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });
});
