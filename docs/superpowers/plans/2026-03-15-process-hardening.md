# Process Management Hardening — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three process management flaws — registry race conditions, restart escalation, and PID reuse detection.

**Architecture:** Add a lockfile-based mutex around all registry read-modify-write operations, exposed publicly so callers in process-manager can hold the lock across find+modify+upsert cycles. Escalate SIGTERM → SIGKILL → error in restart. Store and verify per-process start timestamps to detect PID reuse.

**Tech Stack:** Bun, Node.js `fs` APIs (`openSync` with `O_CREAT | O_EXCL`), `ps` CLI for cross-platform start time.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/file-lock.ts` | Create | Lockfile acquire/release with stale detection |
| `src/process-metrics.ts` | Modify | Add `getProcessStartTime()`, update `isProcessRunning()` signature |
| `src/process-registry.ts` | Modify | Wrap mutating methods with file lock, pass start time to liveness checks |
| `src/process-manager.ts` | Modify | Store `processStartTime` at spawn, SIGKILL escalation in restart |
| `src/types.ts` | Modify | Add `processStartTime` field to `ManagedProcessRecord` |
| `tests/file-lock.test.ts` | Create | Unit tests for lockfile acquire/release/stale |
| `tests/process-metrics.test.ts` | Create | Unit tests for PID reuse detection |
| `tests/process-manager.test.ts` | Create | Unit tests for SIGKILL escalation |

---

## Chunk 1: File Locking

### Task 1: Create `src/file-lock.ts` with tests

**Files:**

- Create: `src/file-lock.ts`
- Create: `tests/file-lock.test.ts`

- [ ] **Step 1: Write failing tests for file lock**

```ts
// tests/file-lock.test.ts
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { unlinkSync } from "node:fs";

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
    const { openSync, closeSync, utimesSync } = await import("node:fs");
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
    const { openSync, closeSync } = await import("node:fs");
    const holdFd = openSync(lockPath, "wx");

    try {
      await expect(
        acquireFileLock(target, { maxRetries: 3, retryIntervalMs: 10, staleMs: 60_000 }),
      ).rejects.toThrow("lock");
    } finally {
      closeSync(holdFd);
      try { unlinkSync(lockPath); } catch {}
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/file-lock.test.ts`
Expected: FAIL — module `../src/file-lock.ts` not found.

- [ ] **Step 3: Implement `src/file-lock.ts`**

```ts
// src/file-lock.ts
import { closeSync, openSync, statSync, unlinkSync } from "node:fs";
import { constants } from "node:fs";

interface LockOptions {
  maxRetries?: number;
  retryIntervalMs?: number;
  staleMs?: number;
}

const DEFAULT_MAX_RETRIES = 50;
const DEFAULT_RETRY_INTERVAL_MS = 100;
const DEFAULT_STALE_MS = 10_000;

function lockPathFor(filePath: string): string {
  return `${filePath}.lock`;
}

function tryReclaimStaleLock(lockPath: string, staleMs: number): boolean {
  try {
    const stats = statSync(lockPath);
    const age = Date.now() - stats.mtimeMs;

    if (age > staleMs) {
      unlinkSync(lockPath);
      return true;
    }
  } catch {
    // Lock disappeared between check and unlink — that's fine
  }

  return false;
}

export async function acquireFileLock(
  filePath: string,
  options?: LockOptions,
): Promise<number> {
  const lockPath = lockPathFor(filePath);
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryIntervalMs = options?.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // O_CREAT | O_EXCL = atomic create-if-not-exists
      const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      return fd;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      // Lock exists — check if it's stale
      if (tryReclaimStaleLock(lockPath, staleMs)) {
        continue; // Retry immediately after reclaiming
      }

      if (attempt < maxRetries) {
        await Bun.sleep(retryIntervalMs);
      }
    }
  }

  throw new Error(
    `Could not acquire lock on ${lockPath} after ${maxRetries} retries.`,
  );
}

export function releaseFileLock(fd: number, filePath: string): void {
  const lockPath = lockPathFor(filePath);

  try {
    closeSync(fd);
  } catch {
    // Already closed
  }

  try {
    unlinkSync(lockPath);
  } catch {
    // Already removed
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/file-lock.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `bun test`
Expected: All 37+ tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/file-lock.ts tests/file-lock.test.ts
git commit -m "feat: add lockfile utility for atomic file-based mutual exclusion"
```

---

### Task 2: Integrate file locking into `ProcessRegistry`

**Files:**

- Modify: `src/process-registry.ts`

- [ ] **Step 1: Add a public `withLock` method to `ProcessRegistry`**

Add this method to the `ProcessRegistry` class. It is **public** so that callers in `process-manager.ts` can hold the lock across find+modify+upsert cycles (e.g., `signalManagedProcess`, `restartManagedProcess`, `createUniqueName`).

```ts
import { acquireFileLock, releaseFileLock } from "./file-lock.ts";

// Inside ProcessRegistry class:
async withLock<T>(fn: () => Promise<T>): Promise<T> {
  const fd = await acquireFileLock(this.filePath);

  try {
    return await fn();
  } finally {
    releaseFileLock(fd, this.filePath);
  }
}
```

- [ ] **Step 2: Wrap `upsert()` with the lock**

Change `upsert()` from:

```ts
async upsert(processRecord: ManagedProcessRecord): Promise<void> {
  const registry = await this.read();
  // ...
  await this.write(registry);
}
```

To:

```ts
async upsert(processRecord: ManagedProcessRecord): Promise<void> {
  await this.withLock(async () => {
    const registry = await this.read();
    const index = registry.processes.findIndex((entry) => entry.id === processRecord.id);

    if (index === -1) {
      registry.processes.push(processRecord);
    } else {
      registry.processes[index] = processRecord;
    }

    await this.write(registry);
  });
}
```

- [ ] **Step 3: Wrap `getSnapshot()` with the lock**

Wrap the body of `getSnapshot()` with `this.withLock(async () => { ... })`. The full method:

```ts
async getSnapshot(identifier: string): Promise<ManagedProcessSnapshot | null> {
  return await this.withLock(async () => {
    const registry = await this.read();
    const processRecord =
      registry.processes.find((entry) => entry.id === identifier || entry.name === identifier) ??
      null;

    if (!processRecord) {
      return null;
    }

    const { snapshot, changed } = toSnapshot(processRecord, Date.now(), {
      includePorts: true,
      includeMemory: true,
    });

    if (changed) {
      await this.write(registry);
    }

    return snapshot;
  });
}
```

- [ ] **Step 4: Wrap `listSnapshots()` with the lock**

```ts
async listSnapshots(options?: {
  includePorts?: boolean;
  includeMemory?: boolean;
}): Promise<ManagedProcessSnapshot[]> {
  return await this.withLock(async () => {
    const registry = await this.read();
    const now = Date.now();
    let changed = false;
    const snapshots = registry.processes.map((processRecord) => {
      const result = toSnapshot(processRecord, now, options);

      if (result.changed) {
        changed = true;
      }

      return result.snapshot;
    });

    if (changed) {
      await this.write(registry);
    }

    return snapshots;
  });
}
```

- [ ] **Step 5: Wrap `prune()` with the lock**

```ts
async prune(options?: {
  dryRun?: boolean;
}): Promise<{ removed: number; kept: number; cleaned: string[] }> {
  return await this.withLock(async () => {
    const registry = await this.read();
    const keptRecords: ManagedProcessRecord[] = [];
    const cleaned: string[] = [];

    for (const record of registry.processes) {
      if (isProcessRunning(record.pid)) {
        keptRecords.push(record);
      } else {
        cleaned.push(record.name);
      }
    }

    const removed = registry.processes.length - keptRecords.length;

    if (!options?.dryRun) {
      registry.processes = keptRecords;
      await this.write(registry);
    }

    return { removed, kept: keptRecords.length, cleaned };
  });
}
```

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All tests PASS. The existing managed-process integration test in `default-profile-process.test.ts` exercises `upsert`, `listSnapshots`, `getSnapshot` through the CLI — confirms locking doesn't break the flow.

- [ ] **Step 7: Commit**

```bash
git add src/process-registry.ts
git commit -m "fix: wrap registry read-modify-write operations with file lock"
```

---

### Task 2b: Wrap process-manager read-modify-write cycles with the registry lock

**Files:**

- Modify: `src/process-manager.ts`

The reviewer identified that `signalManagedProcess`, `restartManagedProcess`, and `createUniqueName` all do `findByNameOrId` (read) + modify + `upsert` (write) as separate unlocked calls. Two concurrent `run stop` or `run up` commands can race. Fix: wrap these full cycles with `registry.withLock()`.

- [ ] **Step 1: Wrap `signalManagedProcess` with registry lock**

Change:

```ts
export async function signalManagedProcess(
  registry: ProcessRegistry,
  identifier: string,
  signal: NodeJS.Signals,
  nextStatus: "stopped" | "exited",
): Promise<ManagedProcessRecord> {
  const processRecord = await registry.findByNameOrId(identifier);
  // ... modify and upsert ...
}
```

To:

```ts
export async function signalManagedProcess(
  registry: ProcessRegistry,
  identifier: string,
  signal: NodeJS.Signals,
  nextStatus: "stopped" | "exited",
): Promise<ManagedProcessRecord> {
  return await registry.withLock(async () => {
    const processRecord = await registry.findByNameOrId(identifier);

    if (!processRecord) {
      throw new Error(`Managed process "${identifier}" was not found.`);
    }

    if (isProcessRunning(processRecord.pid)) {
      process.kill(processRecord.pid, signal);
    }

    processRecord.status = nextStatus;
    processRecord.stoppedAt = new Date().toISOString();
    processRecord.updatedAt = processRecord.stoppedAt;
    processRecord.lastSignal = signal;

    await registry.upsert(processRecord);
    return processRecord;
  });
}
```

Note: since `upsert` also acquires the lock internally, and file locks are not reentrant, we must ensure `upsert` uses a **lock-free internal path** when called from within `withLock`. The simplest approach: extract the upsert logic into a private `_upsertUnsafe` method, and have the public `upsert` call `withLock(() => this._upsertUnsafe(...))`.

- [ ] **Step 2: Split `upsert` into locked public + unlocked internal**

In `src/process-registry.ts`:

```ts
// Private unlocked implementation
private async _upsertUnsafe(processRecord: ManagedProcessRecord): Promise<void> {
  const registry = await this.read();
  const index = registry.processes.findIndex((entry) => entry.id === processRecord.id);

  if (index === -1) {
    registry.processes.push(processRecord);
  } else {
    registry.processes[index] = processRecord;
  }

  await this.write(registry);
}

// Public locked wrapper
async upsert(processRecord: ManagedProcessRecord): Promise<void> {
  await this.withLock(async () => {
    await this._upsertUnsafe(processRecord);
  });
}
```

Then update all `withLock` callers that call `upsert` internally to call `this._upsertUnsafe` instead:

- `signalManagedProcess` calls `registry.upsert()` — change to call the unlocked internal path. Since `_upsertUnsafe` is private, we need a different approach.

**Better approach:** Make `upsert` detect if it's already inside a lock and skip re-locking. Simplest: just make the internal methods lock-free and always require callers to lock externally, OR keep `upsert` as a direct (unlocked) write and have `withLock` be the only locking mechanism.

**Simplest approach chosen:** Remove internal locking from `upsert`, `getSnapshot`, `listSnapshots`, and `prune`. Make them all unlocked. The `withLock` method is the only locking primitive. All callers in `process-manager.ts` and `cli.ts` must wrap their calls in `registry.withLock()`.

Revert the changes from Task 2 Steps 2-5 (unwrap the `withLock` from those methods). Instead, wrap the call sites.

- [ ] **Step 3: Revert `upsert`, `getSnapshot`, `listSnapshots`, `prune` to unlocked**

Keep these methods as they were originally (no `withLock` wrapper). The `withLock` method is public and callers are responsible for acquiring the lock.

- [ ] **Step 4: Wrap `startManagedProcess` in `withLock`**

In `src/process-manager.ts`, wrap the body of `startManagedProcess` — specifically the `createUniqueName` + `upsert` sequence:

```ts
export async function startManagedProcess(options: {
  // ... existing signature ...
}): Promise<ManagedProcessRecord> {
  return await options.registry.withLock(async () => {
    // ... entire existing body ...
  });
}
```

- [ ] **Step 5: Wrap `restartManagedProcess` in `withLock`**

```ts
export async function restartManagedProcess(
  registry: ProcessRegistry,
  identifier: string,
  options: { globalConfig: GlobalConfig },
): Promise<ManagedProcessRecord> {
  return await registry.withLock(async () => {
    // ... existing body, including findByNameOrId + terminateProcess + startManagedProcess ...
  });
}
```

Note: since `startManagedProcess` also calls `withLock`, and we can't nest locks, we need an unlocked internal variant. Extract the core logic into `_startManagedProcessUnsafe` that both `startManagedProcess` (locked) and `restartManagedProcess` (already locked) can call.

- [ ] **Step 6: Extract unlocked `_startManagedProcessUnsafe`**

```ts
// Unlocked core — called from within an existing lock
async function _startManagedProcessCore(options: {
  profile: ResolvedProfile;
  globalConfig: GlobalConfig;
  registry: ProcessRegistry;
  nameOverride?: string;
  existingProcess?: ManagedProcessRecord;
  args?: string[];
}): Promise<ManagedProcessRecord> {
  // ... existing startManagedProcess body, unchanged ...
}

// Public locked wrapper
export async function startManagedProcess(options: {
  profile: ResolvedProfile;
  globalConfig: GlobalConfig;
  registry: ProcessRegistry;
  nameOverride?: string;
  existingProcess?: ManagedProcessRecord;
  args?: string[];
}): Promise<ManagedProcessRecord> {
  return await options.registry.withLock(async () => {
    return await _startManagedProcessCore(options);
  });
}
```

Then `restartManagedProcess` calls `_startManagedProcessCore` instead of `startManagedProcess`:

```ts
export async function restartManagedProcess(
  registry: ProcessRegistry,
  identifier: string,
  options: { globalConfig: GlobalConfig },
): Promise<ManagedProcessRecord> {
  return await registry.withLock(async () => {
    const existingProcess = await registry.findByNameOrId(identifier);

    if (!existingProcess) {
      throw new Error(`Managed process "${identifier}" was not found.`);
    }

    await terminateProcess(existingProcess.pid);

    const profile: ResolvedProfile = {
      name: existingProcess.profile,
      command: existingProcess.baseCommand,
      cwd: existingProcess.cwd,
      env: existingProcess.env,
      sourcePath: existingProcess.configPath,
      configDir: existingProcess.projectRoot,
    };

    return await _startManagedProcessCore({
      profile,
      globalConfig: options.globalConfig,
      registry,
      existingProcess,
      args: existingProcess.commandArgs,
    });
  });
}
```

- [ ] **Step 7: Wrap CLI-level calls to `listSnapshots`, `getSnapshot`, `prune` with `withLock`**

In `src/cli.ts`, update these call sites:

For `handlePsCommand`:

```ts
const snapshots = await options.registry.withLock(async () => {
  return await options.registry.listSnapshots({ ... });
});
```

For `handleInspectCommand` (uses `getSnapshot`):

```ts
const snapshot = await options.registry.withLock(async () => {
  return await options.registry.getSnapshot(options.identifier);
});
```

For the `prune` case:

```ts
const { removed, kept, cleaned } = await registry.withLock(async () => {
  return await registry.prune({ dryRun });
});
```

Apply the same pattern to `handleDashboardCommand`, `handlePortsCommand`, and `handleLogsCommand` where they call registry methods.

- [ ] **Step 8: Run full test suite**

Run: `bun test`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/process-registry.ts src/process-manager.ts src/cli.ts
git commit -m "fix: wrap all registry read-modify-write cycles with file lock at call sites"
```

---

## Chunk 2: SIGKILL Escalation

### Task 3: Add SIGKILL escalation to `restartManagedProcess`

**Files:**

- Modify: `src/process-manager.ts`
- Create: `tests/process-manager.test.ts`

- [ ] **Step 1: Write failing test for SIGKILL escalation**

```ts
// tests/process-manager.test.ts
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

import { terminateProcess } from "../src/process-manager.ts";
import { isProcessRunning } from "../src/process-metrics.ts";

describe("terminateProcess", () => {
  test("terminates a normal process with SIGTERM within grace period", async () => {
    // Start a process that exits cleanly on SIGTERM
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    child.unref();
    const pid = child.pid!;

    expect(isProcessRunning(pid)).toBe(true);

    await terminateProcess(pid);

    expect(isProcessRunning(pid)).toBe(false);
  });

  test("escalates to SIGKILL for a SIGTERM-resistant process", async () => {
    // Start a process that traps SIGTERM, with a readiness signal
    const child = spawn("sh", ["-c", "trap '' TERM; echo ready; sleep 30"], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });

    // Wait for the trap to be installed before proceeding
    await new Promise<void>((resolve) => {
      child.stdout!.once("data", () => resolve());
    });

    child.unref();
    const pid = child.pid!;

    expect(isProcessRunning(pid)).toBe(true);

    await terminateProcess(pid, { termGraceMs: 500, killGraceMs: 500 });

    expect(isProcessRunning(pid)).toBe(false);
  });

  test("is a no-op for an already-dead process", async () => {
    // Should not throw for a PID that doesn't exist
    await terminateProcess(999999);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/process-manager.test.ts`
Expected: FAIL — `terminateProcess` is not exported.

- [ ] **Step 3: Extract `terminateProcess` and add SIGKILL escalation**

In `src/process-manager.ts`, add the following exported function and update `restartManagedProcess` to use it:

```ts
function trySendSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Process may have exited between liveness check and signal — safe to ignore
  }
}

export async function terminateProcess(
  pid: number,
  options?: { termGraceMs?: number; killGraceMs?: number },
): Promise<void> {
  const termGraceMs = options?.termGraceMs ?? 2000;
  const killGraceMs = options?.killGraceMs ?? 1000;
  const termPollInterval = 100;
  const killPollInterval = 100;

  if (!isProcessRunning(pid)) {
    return;
  }

  // Phase 1: SIGTERM
  trySendSignal(pid, "SIGTERM");

  for (let elapsed = 0; elapsed < termGraceMs; elapsed += termPollInterval) {
    if (!isProcessRunning(pid)) {
      return;
    }

    await Bun.sleep(termPollInterval);
  }

  // Phase 2: SIGKILL
  if (isProcessRunning(pid)) {
    trySendSignal(pid, "SIGKILL");
  }

  for (let elapsed = 0; elapsed < killGraceMs; elapsed += killPollInterval) {
    if (!isProcessRunning(pid)) {
      return;
    }

    await Bun.sleep(killPollInterval);
  }

  // Phase 3: give up
  if (isProcessRunning(pid)) {
    throw new Error(
      `Process ${pid} did not terminate after SIGTERM (${termGraceMs}ms) and SIGKILL (${killGraceMs}ms).`,
    );
  }
}
```

Then update `restartManagedProcess` to use it. Replace the existing SIGTERM + poll block (lines 150-160):

```ts
// Old:
if (isProcessRunning(existingProcess.pid)) {
  process.kill(existingProcess.pid, "SIGTERM");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessRunning(existingProcess.pid)) {
      break;
    }

    await Bun.sleep(100);
  }
}

// New:
await terminateProcess(existingProcess.pid);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/process-manager.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: All tests PASS. The `default-profile-process.test.ts` restart test still works since the test process responds to SIGTERM normally.

- [ ] **Step 6: Commit**

```bash
git add src/process-manager.ts tests/process-manager.test.ts
git commit -m "fix: escalate SIGTERM → SIGKILL → error in process termination"
```

---

## Chunk 3: PID Reuse Detection

### Task 4: Add `getProcessStartTime()` to process-metrics

**Files:**

- Modify: `src/process-metrics.ts`
- Modify: `src/types.ts`
- Create: `tests/process-metrics.test.ts`

- [ ] **Step 1: Write failing test for `getProcessStartTime`**

```ts
// tests/process-metrics.test.ts
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

import {
  getProcessStartTime,
  isProcessRunning,
} from "../src/process-metrics.ts";

describe("process-metrics", () => {
  test("getProcessStartTime returns a string for a running process", () => {
    // Use our own PID — we know we're running
    const startTime = getProcessStartTime(process.pid);
    expect(startTime).not.toBeNull();
    expect(typeof startTime).toBe("string");
    expect(startTime!.length).toBeGreaterThan(0);
  });

  test("getProcessStartTime returns null for a non-existent PID", () => {
    const startTime = getProcessStartTime(999999);
    expect(startTime).toBeNull();
  });

  test("getProcessStartTime is stable across calls for the same process", () => {
    const t1 = getProcessStartTime(process.pid);
    const t2 = getProcessStartTime(process.pid);
    expect(t1).toBe(t2);
  });

  test("isProcessRunning with matching startTime returns true", () => {
    const startTime = getProcessStartTime(process.pid);
    expect(isProcessRunning(process.pid, startTime ?? undefined)).toBe(true);
  });

  test("isProcessRunning with mismatched startTime returns false", () => {
    // Our PID is alive, but with a fake start time it should report false
    expect(isProcessRunning(process.pid, "Thu Jan 01 00:00:00 1970")).toBe(false);
  });

  test("isProcessRunning without startTime falls back to kill(pid, 0)", () => {
    // Backward compatible — no startTime means no reuse check
    expect(isProcessRunning(process.pid)).toBe(true);
    expect(isProcessRunning(999999)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/process-metrics.test.ts`
Expected: FAIL — `getProcessStartTime` not exported, `isProcessRunning` doesn't accept second parameter.

- [ ] **Step 3: Implement `getProcessStartTime` and update `isProcessRunning`**

In `src/process-metrics.ts`, add `getProcessStartTime` and update `isProcessRunning`:

```ts
export function getProcessStartTime(pid: number): string | null {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

export function isProcessRunning(pid: number, expectedStartTime?: string): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  // PID is alive — if we have a start time to compare, verify it matches
  if (expectedStartTime !== undefined) {
    const currentStartTime = getProcessStartTime(pid);
    return currentStartTime === expectedStartTime;
  }

  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/process-metrics.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Run full test suite (expect some failures from changed signature)**

Run: `bun test`
Expected: Should still PASS because `isProcessRunning` accepts `expectedStartTime` as optional — all existing callers pass zero args and get the old behavior.

- [ ] **Step 6: Commit**

```bash
git add src/process-metrics.ts tests/process-metrics.test.ts
git commit -m "feat: add getProcessStartTime and PID reuse detection to isProcessRunning"
```

---

### Task 5: Store `processStartTime` in records and wire through liveness checks

**Files:**

- Modify: `src/types.ts` — add `processStartTime` field
- Modify: `src/process-manager.ts` — capture start time at spawn
- Modify: `src/process-registry.ts` — pass start time to `isProcessRunning`

- [ ] **Step 1: Add `processStartTime` to `ManagedProcessRecord`**

In `src/types.ts`, add the field after `pid`:

```ts
export interface ManagedProcessRecord {
  // ... existing fields ...
  pid: number;
  processStartTime?: string; // <-- add this line
  shell: string;
  // ... rest of fields ...
}
```

- [ ] **Step 2: Store `processStartTime` at spawn in `startManagedProcess`**

In `src/process-manager.ts`, after `child.unref()` and before building `processRecord`, add the import and capture:

Add to imports at top:

```ts
import { getProcessStartTime, isProcessRunning } from "./process-metrics.ts";
```

After `child.unref();` (line 75), capture the start time:

```ts
child.unref();

const processStartTime = child.pid ? getProcessStartTime(child.pid) : null;
```

Then in the `processRecord` object literal, add:

```ts
const processRecord: ManagedProcessRecord = {
  // ... existing fields ...
  pid: child.pid ?? -1,
  processStartTime: processStartTime ?? undefined,
  shell,
  // ... rest ...
};
```

- [ ] **Step 3: Pass `processStartTime` to `isProcessRunning` in `toSnapshot`**

In `src/process-registry.ts`, update the `toSnapshot` function. Change line 26 from:

```ts
const running = isProcessRunning(processRecord.pid);
```

To:

```ts
const running = isProcessRunning(processRecord.pid, processRecord.processStartTime);
```

- [ ] **Step 4: Pass `processStartTime` to `isProcessRunning` in `prune`**

In the `prune` method, change:

```ts
if (isProcessRunning(record.pid)) {
```

To:

```ts
if (isProcessRunning(record.pid, record.processStartTime)) {
```

- [ ] **Step 5: Pass `processStartTime` in `signalManagedProcess` and `restartManagedProcess`**

In `signalManagedProcess`, change:

```ts
if (isProcessRunning(processRecord.pid)) {
```

To:

```ts
if (isProcessRunning(processRecord.pid, processRecord.processStartTime)) {
```

In `restartManagedProcess`, update `terminateProcess` call — no change needed here since `terminateProcess` calls `isProcessRunning` without the start time (it's actively trying to kill the process, so PID identity is already established by the caller).

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All tests PASS. The `processStartTime` field is optional so existing test fixtures without it still work. The managed-process integration test spawns a real process and captures the start time correctly.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/process-manager.ts src/process-registry.ts
git commit -m "fix: store and verify process start time to detect PID reuse"
```

---

## Post-Implementation

- [ ] **Step 1: Run `bun run lint` and `bun run build`**

Run: `bun run lint && bun run build`
Expected: Clean lint, successful build.

- [ ] **Step 2: Final commit if lint made changes**

```bash
git add -A
git commit -m "chore: lint fixes from process hardening changes"
```
