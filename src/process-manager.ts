import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";

import { resolveCommandLine } from "./command-line.ts";
import { FALLBACK_SHELL } from "./constants.ts";
import { sleep } from "./fs.ts";
import { getProcessStartTime, isProcessRunning } from "./process-metrics.ts";
import type { ProcessRegistry } from "./process-registry.ts";
import { detectProjectName } from "./project-name.ts";
import type { GlobalConfig, ManagedProcessRecord, ResolvedProfile } from "./types.ts";

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

    await sleep(termPollInterval);
  }

  // Phase 2: SIGKILL
  if (isProcessRunning(pid)) {
    trySendSignal(pid, "SIGKILL");
  }

  for (let elapsed = 0; elapsed < killGraceMs; elapsed += killPollInterval) {
    if (!isProcessRunning(pid)) {
      return;
    }

    await sleep(killPollInterval);
  }

  // Phase 3: give up
  if (isProcessRunning(pid)) {
    throw new Error(
      `Process ${pid} did not terminate after SIGTERM (${termGraceMs}ms) and SIGKILL (${killGraceMs}ms).`,
    );
  }
}

// Unlocked core — called from within an existing lock
async function startManagedProcessCore(options: {
  profile: ResolvedProfile;
  globalConfig: GlobalConfig;
  registry: ProcessRegistry;
  nameOverride?: string;
  existingProcess?: ManagedProcessRecord;
  args?: string[];
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
  const commandLine = resolveCommandLine(options.profile, options.args ?? []);
  mkdirSync(options.registry.logsDirPath, { recursive: true });
  const stdoutFd = openSync(logPath, "a");
  const stderrFd = openSync(logPath, "a");

  const child = spawn(shell, ["-lc", `exec ${commandLine.shellCommand}`], {
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
    baseCommand: options.profile.command,
    commandArgs: options.args ?? [],
    command: commandLine.shellCommand,
    cwd: options.profile.cwd,
    pid: child.pid ?? -1,
    processStartTime: child.pid ? (getProcessStartTime(child.pid) ?? undefined) : undefined,
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
    return await startManagedProcessCore(options);
  });
}

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

    if (isProcessRunning(processRecord.pid, processRecord.processStartTime)) {
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

export async function restartManagedProcess(
  registry: ProcessRegistry,
  identifier: string,
  options: {
    globalConfig: GlobalConfig;
  },
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

    return await startManagedProcessCore({
      profile,
      globalConfig: options.globalConfig,
      registry,
      existingProcess,
      args: existingProcess.commandArgs,
    });
  });
}
