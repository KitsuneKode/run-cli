import path from "node:path";

import { PROCESS_REGISTRY_VERSION } from "./constants.ts";
import { getProcessLogsDirPath, getProcessRegistryPath } from "./env-paths.ts";
import { pathExists, readTextFile, writeTextFile } from "./fs.ts";
import { getProcessMemoryRssKb, getProcessPorts, isProcessRunning } from "./process-metrics.ts";
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
  },
): {
  snapshot: ManagedProcessSnapshot;
  changed: boolean;
} {
  const previousStatus = processRecord.status;
  const previousUpdatedAt = processRecord.updatedAt;
  const running = isProcessRunning(processRecord.pid);
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

  return {
    snapshot: {
      ...processRecord,
      uptimeMs: Math.max(0, effectiveEnd - new Date(processRecord.startedAt).getTime()),
      memoryRssKb:
        nextStatus === "running" && options?.includeMemory
          ? getProcessMemoryRssKb(processRecord.pid)
          : null,
      ports:
        nextStatus === "running" && options?.includePorts ? getProcessPorts(processRecord.pid) : [],
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
    } catch {
      return createEmptyRegistry();
    }
  }

  async write(registry: ManagedProcessRegistryFile): Promise<void> {
    await writeTextFile(this.filePath, `${JSON.stringify(registry, null, 2)}\n`);
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
  }

  async prune(): Promise<{ removed: number; cleaned: string[] }> {
    const registry = await this.read();
    const now = Date.now();
    const kept: ManagedProcessRecord[] = [];
    const cleaned: string[] = [];

    for (const record of registry.processes) {
      const running = isProcessRunning(record.pid);

      if (running) {
        kept.push(record);
      } else {
        cleaned.push(record.name);
      }
    }

    const removed = registry.processes.length - kept.length;
    registry.processes = kept;
    await this.write(registry);

    return { removed, cleaned };
  }

  createLogPath(processName: string): string {
    const safeName = processName.replace(/[^a-zA-Z0-9:_-]+/g, "-");
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    return path.join(this.logsDirPath, `${safeName}-${timestamp}.log`);
  }
}
