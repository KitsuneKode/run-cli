import {
  constants,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { sleep } from "./fs.ts";

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

export async function acquireFileLock(filePath: string, options?: LockOptions): Promise<number> {
  const lockPath = lockPathFor(filePath);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryIntervalMs = options?.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      writeSync(fd, String(process.pid));
      return fd;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      if (tryReclaimStaleLock(lockPath, staleMs)) {
        continue;
      }

      if (attempt < maxRetries) {
        await sleep(retryIntervalMs);
      }
    }
  }

  throw new Error(`Could not acquire lock on ${lockPath} after ${maxRetries} retries.`);
}

export function releaseFileLock(fd: number, filePath: string): void {
  const lockPath = lockPathFor(filePath);

  try {
    closeSync(fd);
  } catch {
    // Already closed
  }

  try {
    const owner = readFileSync(lockPath, "utf8").trim();
    if (owner === String(process.pid)) {
      unlinkSync(lockPath);
    }
  } catch {
    // File already removed or unreadable
  }
}
