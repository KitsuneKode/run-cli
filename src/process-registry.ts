import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PROCESS_REGISTRY_VERSION } from "./constants.ts";
import { getProcessLogsDirPath, getProcessRegistryPath } from "./env-paths.ts";
import { acquireFileLock, releaseFileLock } from "./file-lock.ts";
import { pathExists, readTextFile } from "./fs.ts";
import {
  type BatchMetrics,
  getBatchMetrics,
  getBatchPorts,
  getProcessMemoryRssKb,
  getProcessPorts,
  isProcessRunning,
} from "./process-metrics.ts";
import type {
  ManagedProcessRecord,
  ManagedProcessRegistryFile,
  ManagedProcessSnapshot,
} from "./types.ts";

function toSnapshot(
  processRecord: ManagedProcessRecord,
  now: number,
  options?: {
    includePorts?: boolean;
    includeMemory?: boolean;
    prefetchedMetrics?: BatchMetrics;
    prefetchedPorts?: number[];
  },
): {
  snapshot: ManagedProcessSnapshot;
  changed: boolean;
} {
  const previousStatus = processRecord.status;
  const previousUpdatedAt = processRecord.updatedAt;

  // Use prefetched start time for liveness check when available
  const startTimeToCheck =
    processRecord.processStartTime ?? options?.prefetchedMetrics?.startTime ?? undefined;
  const running = isProcessRunning(processRecord.pid, startTimeToCheck);
  const nextStatus =
    processRecord.status === "stopped" ? "stopped" : running ? "running" : "exited";

  if (nextStatus !== processRecord.status) {
    processRecord.status = nextStatus;
    processRecord.updatedAt = new Date(now).toISOString();

    if (nextStatus !== "running" && !processRecord.stoppedAt) {
      processRecord.stoppedAt = new Date(now).toISOString();
    }
  }

  const effectiveEnd = processRecord.stoppedAt ? new Date(processRecord.stoppedAt).getTime() : now;

  let memoryRssKb: number | null = null;

  if (nextStatus === "running" && options?.includeMemory) {
    memoryRssKb = options.prefetchedMetrics?.rssKb ?? getProcessMemoryRssKb(processRecord.pid);
  }

  let ports: number[] = [];

  if (nextStatus === "running" && options?.includePorts) {
    ports = options.prefetchedPorts ?? getProcessPorts(processRecord.pid);
  }

  return {
    snapshot: {
      ...processRecord,
      uptimeMs: Math.max(0, effectiveEnd - new Date(processRecord.startedAt).getTime()),
      memoryRssKb,
      ports,
    },
    changed:
      previousStatus !== processRecord.status || previousUpdatedAt !== processRecord.updatedAt,
  };
}

function createEmptyRegistry(): ManagedProcessRegistryFile {
  return {
    version: PROCESS_REGISTRY_VERSION,
    processes: [],
  };
}

export class ProcessRegistry {
  readonly filePath: string;
  readonly logsDirPath: string;

  constructor(filePath = getProcessRegistryPath(), logsDirPath = getProcessLogsDirPath()) {
    this.filePath = filePath;
    this.logsDirPath = logsDirPath;
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const fd = await acquireFileLock(this.filePath);

    try {
      return await fn();
    } finally {
      releaseFileLock(fd, this.filePath);
    }
  }

  async read(): Promise<ManagedProcessRegistryFile> {
    if (!(await pathExists(this.filePath))) {
      return createEmptyRegistry();
    }

    try {
      const parsed = JSON.parse(await readTextFile(this.filePath)) as ManagedProcessRegistryFile;

      if (parsed.version !== PROCESS_REGISTRY_VERSION || !Array.isArray(parsed.processes)) {
        return createEmptyRegistry();
      }

      return parsed;
    } catch (error) {
      console.error(
        `warning: process registry at ${this.filePath} is corrupted and will be reset.`,
        error instanceof Error ? error.message : "",
      );
      return createEmptyRegistry();
    }
  }

  async write(registry: ManagedProcessRegistryFile): Promise<void> {
    const content = `${JSON.stringify(registry, null, 2)}\n`;
    const tmpPath = `${this.filePath}.tmp`;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, this.filePath);
  }

  async upsert(processRecord: ManagedProcessRecord): Promise<void> {
    const registry = await this.read();
    const index = registry.processes.findIndex((entry) => entry.id === processRecord.id);

    if (index === -1) {
      registry.processes.push(processRecord);
    } else {
      registry.processes[index] = processRecord;
    }

    await this.write(registry);
  }

  async findByNameOrId(identifier: string): Promise<ManagedProcessRecord | null> {
    const registry = await this.read();

    return (
      registry.processes.find((entry) => entry.id === identifier || entry.name === identifier) ??
      null
    );
  }

  async getSnapshot(identifier: string): Promise<ManagedProcessSnapshot | null> {
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
  }

  async listSnapshots(options?: {
    includePorts?: boolean;
    includeMemory?: boolean;
  }): Promise<ManagedProcessSnapshot[]> {
    const registry = await this.read();
    const now = Date.now();

    // Pre-fetch metrics in bulk (2 forks total instead of 3N)
    const pids = registry.processes.map((r) => r.pid);
    const needMetrics = options?.includeMemory === true;
    const needPorts = options?.includePorts === true;
    const batchMetrics = needMetrics ? getBatchMetrics(pids) : new Map<number, BatchMetrics>();
    const batchPorts = needPorts ? getBatchPorts(pids) : new Map<number, number[]>();

    let changed = false;
    const snapshots = registry.processes.map((processRecord) => {
      const result = toSnapshot(processRecord, now, {
        ...options,
        prefetchedMetrics: batchMetrics.get(processRecord.pid),
        prefetchedPorts: batchPorts.get(processRecord.pid),
      });

      if (result.changed) {
        changed = true;
      }

      return result.snapshot;
    });

    if (changed) {
      await this.write(registry);
    }

    return snapshots;
  }

  async prune(options?: {
    dryRun?: boolean;
  }): Promise<{ removed: number; kept: number; cleaned: string[] }> {
    const registry = await this.read();
    const keptRecords: ManagedProcessRecord[] = [];
    const cleaned: string[] = [];

    for (const record of registry.processes) {
      if (isProcessRunning(record.pid, record.processStartTime)) {
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
  }

  createLogPath(processName: string): string {
    const safeName = processName.replace(/[^a-zA-Z0-9:_-]+/g, "-");
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    return path.join(this.logsDirPath, `${safeName}-${timestamp}.log`);
  }
}
