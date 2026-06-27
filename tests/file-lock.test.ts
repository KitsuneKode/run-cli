import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import { acquireFileLock, releaseFileLock } from "../src/file-lock.ts";
import { pathExists } from "../src/fs.ts";
import { createTempDir } from "./helpers.ts";

describe("file-lock", () => {
  test("acquires and releases a lock file", async () => {
    const dir = await createTempDir("lock-");
    const target = path.join(dir, "data.json");
    const lockPath = `${target}.lock`;

    const fd = await acquireFileLock(target);
    expect(await pathExists(lockPath)).toBe(true);

    releaseFileLock(fd, target);
    expect(await pathExists(lockPath)).toBe(false);
  });

  test("blocks until existing lock is released", async () => {
    const dir = await createTempDir("lock-contention-");
    const target = path.join(dir, "data.json");

    const fd1 = await acquireFileLock(target);

    // Release after 100ms in background
    setTimeout(() => releaseFileLock(fd1, target), 100);

    const start = Date.now();
    const fd2 = await acquireFileLock(target);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(50);
    releaseFileLock(fd2, target);
  });

  test("reclaims stale lock older than threshold", async () => {
    const dir = await createTempDir("lock-stale-");
    const target = path.join(dir, "data.json");
    const lockPath = `${target}.lock`;

    // Create a stale lock manually
    const staleFd = openSync(lockPath, "wx");
    closeSync(staleFd);

    // Backdate it to 30 seconds ago
    const past = new Date(Date.now() - 30_000);
    utimesSync(lockPath, past, past);

    // Should reclaim it
    const fd = await acquireFileLock(target, { staleMs: 10_000 });
    expect(await pathExists(lockPath)).toBe(true);
    releaseFileLock(fd, target);
  });

  test("throws after max retries", async () => {
    const dir = await createTempDir("lock-timeout-");
    const target = path.join(dir, "data.json");
    const lockPath = `${target}.lock`;

    // Hold a fresh lock (not stale)
    const holdFd = openSync(lockPath, "wx");

    try {
      await expect(
        acquireFileLock(target, { maxRetries: 3, retryIntervalMs: 10, staleMs: 60_000 }),
      ).rejects.toThrow("lock");
    } finally {
      closeSync(holdFd);
      try {
        unlinkSync(lockPath);
      } catch {}
    }
  });

  test("releasing a stale, reclaimed lock does not unlink the new owner's file", async () => {
    const dir = await createTempDir("lock-race-");
    const target = path.join(dir, "data.json");
    const lockPath = `${target}.lock`;

    // 1. Acquire a lock (lockA)
    const fd = await acquireFileLock(target);
    expect(await pathExists(lockPath)).toBe(true);

    // 2. Simulate another process taking the lock by unlinking lockPath and writing a different PID (e.g. "99999") into the lockfile
    unlinkSync(lockPath);
    writeFileSync(lockPath, "99999", "utf8");

    // 3. Release lockA
    releaseFileLock(fd, target);

    // 4. Assert that the lock file containing "99999" still exists on disk (was not deleted by lockA's release)
    expect(await pathExists(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8").trim()).toBe("99999");

    // 5. Manually cleanup the simulated lock file
    try {
      unlinkSync(lockPath);
    } catch {}
  });
});
