import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";

import { FALLBACK_SHELL } from "./constants.ts";
import { isProcessRunning } from "./process-metrics.ts";
import type { ProcessRegistry } from "./process-registry.ts";
import { detectProjectName } from "./project-name.ts";
import type {
  GlobalConfig,
  ManagedProcessRecord,
  ManagedProcessSnapshot,
  ResolvedProfile,
} from "./types.ts";

function effectiveShell(globalConfig: GlobalConfig): string {
  return globalConfig.shell ?? process.env.SHELL ?? FALLBACK_SHELL;
}

function buildBaseName(projectName: string, profile: string): string {
  return profile === "default" ? projectName : `${projectName}:${profile}`;
}

async function createUniqueName(registry: ProcessRegistry, desiredName: string): Promise<string> {
  const existingNames = new Set(
    (await registry.read()).processes.map((processRecord) => processRecord.name),
  );

  if (!existingNames.has(desiredName)) {
    return desiredName;
  }

  let suffix = 2;

  while (existingNames.has(`${desiredName}#${suffix}`)) {
    suffix += 1;
  }

  return `${desiredName}#${suffix}`;
}

export async function startManagedProcess(options: {
  profile: ResolvedProfile;
  globalConfig: GlobalConfig;
  registry: ProcessRegistry;
  nameOverride?: string;
  existingProcess?: ManagedProcessRecord;
}): Promise<ManagedProcessRecord> {
  const shell = effectiveShell(options.globalConfig);
  const projectName = await detectProjectName(options.profile.configDir);
  const baseName =
    options.nameOverride ??
    options.existingProcess?.name ??
    buildBaseName(projectName, options.profile.name);
  const processName = options.existingProcess
    ? baseName
    : await createUniqueName(options.registry, baseName);
  const logPath = options.existingProcess?.logPath ?? options.registry.createLogPath(processName);
  mkdirSync(options.registry.logsDirPath, { recursive: true });
  const stdoutFd = openSync(logPath, "a");
  const stderrFd = openSync(logPath, "a");

  const child = spawn(shell, ["-lc", `exec ${options.profile.command}`], {
    cwd: options.profile.cwd,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    env: {
      ...process.env,
      ...options.profile.env,
    },
  });

  child.unref();

  const now = new Date().toISOString();
  const processRecord: ManagedProcessRecord = {
    id: options.existingProcess?.id ?? crypto.randomUUID().slice(0, 12),
    name: processName,
    projectName,
    projectRoot: options.profile.configDir,
    configPath: options.profile.sourcePath,
    profile: options.profile.name,
    command: options.profile.command,
    cwd: options.profile.cwd,
    pid: child.pid ?? -1,
    shell,
    env: options.profile.env,
    status: "running",
    logPath,
    startedAt: options.existingProcess?.startedAt ?? now,
    updatedAt: now,
    restartCount: options.existingProcess?.restartCount ?? 0,
  };

  closeSync(stdoutFd);
  closeSync(stderrFd);

  if (options.existingProcess) {
    processRecord.restartCount = options.existingProcess.restartCount + 1;
    processRecord.startedAt = now;
    processRecord.stoppedAt = undefined;
  }

  await options.registry.upsert(processRecord);
  return processRecord;
}

export async function signalManagedProcess(
  registry: ProcessRegistry,
  identifier: string,
  signal: NodeJS.Signals,
  nextStatus: "stopped" | "exited",
): Promise<ManagedProcessRecord> {
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
}

export async function restartManagedProcess(
  registry: ProcessRegistry,
  identifier: string,
  options: {
    globalConfig: GlobalConfig;
  },
): Promise<ManagedProcessRecord> {
  const existingProcess = await registry.findByNameOrId(identifier);

  if (!existingProcess) {
    throw new Error(`Managed process "${identifier}" was not found.`);
  }

  if (isProcessRunning(existingProcess.pid)) {
    process.kill(existingProcess.pid, "SIGTERM");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!isProcessRunning(existingProcess.pid)) {
        break;
      }

      await Bun.sleep(100);
    }
  }

  const profile: ResolvedProfile = {
    name: existingProcess.profile,
    command: existingProcess.command,
    cwd: existingProcess.cwd,
    env: existingProcess.env,
    sourcePath: existingProcess.configPath,
    configDir: existingProcess.projectRoot,
  };

  return await startManagedProcess({
    profile,
    globalConfig: options.globalConfig,
    registry,
    existingProcess,
  });
}
