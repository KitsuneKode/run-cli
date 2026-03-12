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

  async listSnapshots(): Promise<ManagedProcessSnapshot[]> {
    const registry = await this.read();
    const now = Date.now();
    let changed = false;
    const snapshots = registry.processes.map((processRecord) => {
      const running = isProcessRunning(processRecord.pid);
      const nextStatus =
        processRecord.status === "stopped" ? "stopped" : running ? "running" : "exited";

      if (nextStatus !== processRecord.status) {
        processRecord.status = nextStatus;
        processRecord.updatedAt = new Date(now).toISOString();

        if (nextStatus !== "running" && !processRecord.stoppedAt) {
          processRecord.stoppedAt = new Date(now).toISOString();
        }

        changed = true;
      }

      const effectiveEnd = processRecord.stoppedAt
        ? new Date(processRecord.stoppedAt).getTime()
        : now;

      return {
        ...processRecord,
        uptimeMs: Math.max(0, effectiveEnd - new Date(processRecord.startedAt).getTime()),
        memoryRssKb: nextStatus === "running" ? getProcessMemoryRssKb(processRecord.pid) : null,
        ports: nextStatus === "running" ? getProcessPorts(processRecord.pid) : [],
      };
    });

    if (changed) {
      await this.write(registry);
    }

    return snapshots;
  }

  createLogPath(processName: string): string {
    const safeName = processName.replace(/[^a-zA-Z0-9:_-]+/g, "-");
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    return path.join(this.logsDirPath, `${safeName}-${timestamp}.log`);
  }
}
