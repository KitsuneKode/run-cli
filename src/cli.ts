import { spawn } from "node:child_process";
import path from "node:path";

import { parseArgs } from "./args.ts";
import { CacheStore } from "./cache.ts";
import { renderBashCompletion, renderZshCompletion } from "./completion.ts";
import {
  listProfiles,
  readGlobalConfig,
  renderGlobalConfig,
  resolveProfile,
  resolveProjectConfig,
} from "./config.ts";
import { CONFIG_FILE_NAME, FALLBACK_SHELL, RESERVED_COMMANDS } from "./constants.ts";
import { detectProject } from "./detect.ts";
import { renderDoctorReport } from "./doctor.ts";
import { getGlobalConfigPath } from "./env-paths.ts";
import { runResolvedProfile } from "./exec.ts";
import { pathExists, readTextFile, writeTextFile } from "./fs.ts";
import { runInit } from "./init.ts";
import {
  renderManagedDashboard,
  renderManagedProcessDetails,
  renderManagedProcessList,
} from "./managed-process-view.ts";
import { info, red, warn } from "./output.ts";
import {
  restartManagedProcess,
  signalManagedProcess,
  startManagedProcess,
} from "./process-manager.ts";
import { ProcessRegistry } from "./process-registry.ts";
import type { GlobalConfig, ManagedProcessSnapshot, ResolvedConfig } from "./types.ts";

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const cacheStore = new CacheStore();
  const processRegistry = new ProcessRegistry();
  const cwd = path.resolve(parsed.cwd ?? process.cwd());
  const globalConfig = await readGlobalConfig();
  const useCache = !parsed.noCache && globalConfig.cache;
  const [firstPositional, secondPositional] = parsed.positionals;

  if (parsed.help || firstPositional === "help") {
    printHelp();
    return;
  }

  try {
    switch (firstPositional) {
      case "init":
        await handleInitCommand({
          cwd,
          useCache,
          cacheStore,
          force: parsed.force,
          yes: parsed.yes,
          command: parsed.command,
          defaultProfile: parsed.defaultProfile,
          profiles: parsed.profiles,
        });
        return;
      case "config":
        await handleConfigCommand({
          action: secondPositional,
          cwd,
          global: parsed.global,
          cacheStore,
          globalConfig,
          useCache,
        });
        return;
      case "completion":
        handleCompletionCommand(secondPositional);
        return;
      case "doctor":
        await handleDoctorCommand({
          cwd,
          explicitConfigPath: parsed.configPath,
          cacheStore,
          globalConfig,
          useCache,
        });
        return;
      case "profiles":
        await handleProfilesCommand({
          cwd,
          explicitConfigPath: parsed.configPath,
          cacheStore,
          useCache,
        });
        return;
      case "up":
        await handleUpCommand({
          cwd,
          profileName: secondPositional,
          explicitConfigPath: parsed.configPath,
          cacheStore,
          globalConfig,
          useCache,
          name: parsed.name,
        });
        return;
      case "ps":
        await handlePsCommand({
          registry: processRegistry,
          json: parsed.json,
        });
        return;
      case "dashboard":
        await handleDashboardCommand({
          registry: processRegistry,
        });
        return;
      case "inspect":
        await requireIdentifier("inspect", secondPositional);
        await handleInspectCommand({
          identifier: secondPositional,
          registry: processRegistry,
          json: parsed.json,
        });
        return;
      case "logs":
        await requireIdentifier("logs", secondPositional);
        await handleLogsCommand({
          identifier: secondPositional,
          registry: processRegistry,
          follow: parsed.follow,
          lines: parsed.lines ?? 40,
        });
        return;
      case "stop":
        await requireIdentifier("stop", secondPositional);
        await handleSignalCommand({
          identifier: secondPositional,
          registry: processRegistry,
          signal: "SIGTERM",
          nextStatus: "stopped",
          verb: "stopped",
        });
        return;
      case "kill":
        await requireIdentifier("kill", secondPositional);
        await handleSignalCommand({
          identifier: secondPositional,
          registry: processRegistry,
          signal: "SIGKILL",
          nextStatus: "exited",
          verb: "killed",
        });
        return;
      case "restart":
        await requireIdentifier("restart", secondPositional);
        await handleRestartCommand({
          identifier: secondPositional,
          registry: processRegistry,
          globalConfig,
        });
        return;
      case "ports":
        await handlePortsCommand({
          registry: processRegistry,
          json: parsed.json,
        });
        return;
      default:
        if (firstPositional && RESERVED_COMMANDS.has(firstPositional)) {
          throw new Error(`Unknown command: ${firstPositional}`);
        }

        await handleRunCommand({
          cwd,
          profileName: firstPositional,
          explicitConfigPath: parsed.configPath,
          cacheStore,
          globalConfig,
          useCache,
          dryRun: parsed.dryRun,
        });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(red(`error: ${message}`));
    process.exitCode = 1;
  }
}

async function handleInitCommand(options: {
  cwd: string;
  useCache: boolean;
  cacheStore: CacheStore;
  force: boolean;
  yes: boolean;
  command?: string;
  defaultProfile?: string;
  profiles: Array<{ name: string; command: string }>;
}): Promise<void> {
  const result = await runInit({
    cwd: options.cwd,
    useCache: options.useCache,
    force: options.force,
    yes: options.yes,
    command: options.command,
    defaultProfile: options.defaultProfile,
    profiles: options.profiles,
    cacheStore: options.cacheStore,
  });

  info(`created ${result.path}`);

  if (result.detected.length > 0) {
    info("Detected commands:");

    for (const suggestion of result.detected) {
      const label = suggestion.kind === "profile" ? `${suggestion.name}: ` : "";
      info(`  - ${label}${suggestion.command}`);
    }
  }

  if (options.useCache) {
    await options.cacheStore.save();
  }
}

async function handleDoctorCommand(options: {
  cwd: string;
  explicitConfigPath?: string;
  cacheStore: CacheStore;
  globalConfig: GlobalConfig;
  useCache: boolean;
}): Promise<void> {
  const projectConfig = await resolveProjectConfig({
    cwd: options.cwd,
    explicitConfigPath: options.explicitConfigPath,
    useCache: options.useCache,
    cacheStore: options.cacheStore,
  });
  const detectedProject = await detectProject({
    cwd: options.cwd,
    useCache: options.useCache,
    cacheStore: options.cacheStore,
  });

  info(
    renderDoctorReport({
      cwd: options.cwd,
      globalConfig: options.globalConfig,
      projectConfig,
      detectedProject,
    }),
  );

  if (options.useCache) {
    await options.cacheStore.save();
  }
}

function handleCompletionCommand(shell: string | undefined): void {
  switch (shell) {
    case "zsh":
      info(renderZshCompletion());
      return;
    case "bash":
      info(renderBashCompletion());
      return;
    default:
      throw new Error("Usage: run completion <zsh|bash>");
  }
}

async function handleRunCommand(options: {
  cwd: string;
  profileName?: string;
  explicitConfigPath?: string;
  cacheStore: CacheStore;
  globalConfig: GlobalConfig;
  useCache: boolean;
  dryRun: boolean;
}): Promise<void> {
  const resolvedConfig = await resolveProjectConfig({
    cwd: options.cwd,
    explicitConfigPath: options.explicitConfigPath,
    useCache: options.useCache,
    cacheStore: options.cacheStore,
  });

  if (!resolvedConfig) {
    const detectedProject = await detectProject({
      cwd: options.cwd,
      useCache: options.useCache,
      cacheStore: options.cacheStore,
    });

    warn(`No ${CONFIG_FILE_NAME} was found above ${options.cwd}.`);

    if (detectedProject?.suggestions.length) {
      info(`Detected project root: ${detectedProject.root}`);
      info("Suggested commands:");

      for (const suggestion of detectedProject.suggestions) {
        const label = suggestion.kind === "profile" ? `${suggestion.name}: ` : "";
        info(
          `  - ${label}${suggestion.command} (${suggestion.reason}; confidence=${suggestion.confidence})`,
        );
      }
    } else {
      warn("No runnable command could be detected automatically.");
    }

    info(`Run "run init" to choose one of the detected commands or enter your own.`);
    info(`Run "run init --command '<your command>'" to write a custom command directly.`);

    if (options.useCache) {
      await options.cacheStore.save();
    }

    process.exitCode = 1;
    return;
  }

  const profile = resolveProfile(resolvedConfig, options.profileName);
  info(
    `run ${profile.command} (profile=${profile.name} cwd=${profile.cwd} config=${profile.sourcePath}${
      resolvedConfig.cacheHit ? " cache" : ""
    })`,
  );

  const exitCode = await runResolvedProfile(profile, options.globalConfig, {
    dryRun: options.dryRun,
  });

  if (options.useCache) {
    await options.cacheStore.save();
  }

  process.exitCode = exitCode;
}

async function handleUpCommand(options: {
  cwd: string;
  profileName?: string;
  explicitConfigPath?: string;
  cacheStore: CacheStore;
  globalConfig: GlobalConfig;
  useCache: boolean;
  name?: string;
}): Promise<void> {
  const resolvedConfig = await requireResolvedConfig({
    cwd: options.cwd,
    explicitConfigPath: options.explicitConfigPath,
    cacheStore: options.cacheStore,
    useCache: options.useCache,
  });
  const profile = resolveProfile(resolvedConfig, options.profileName);
  const registry = new ProcessRegistry();
  const processRecord = await startManagedProcess({
    profile,
    globalConfig: options.globalConfig,
    registry,
    nameOverride: options.name,
  });

  info(`started ${processRecord.name}`);
  info(`  pid: ${processRecord.pid}`);
  info(`  profile: ${processRecord.profile}`);
  info(`  command: ${processRecord.command}`);
  info(`  log: ${processRecord.logPath}`);
}

async function handlePsCommand(options: {
  registry: ProcessRegistry;
  json: boolean;
}): Promise<void> {
  const snapshots = await options.registry.listSnapshots();

  if (options.json) {
    info(`${JSON.stringify(snapshots, null, 2)}\n`);
    return;
  }

  info(renderManagedProcessList(snapshots));
}

async function handleDashboardCommand(options: {
  registry: ProcessRegistry;
}): Promise<void> {
  const snapshots = await options.registry.listSnapshots();
  info(renderManagedDashboard(snapshots));
}

async function handleInspectCommand(options: {
  identifier: string;
  registry: ProcessRegistry;
  json: boolean;
}): Promise<void> {
  const processRecord = await requireProcessSnapshot(options.registry, options.identifier);

  if (options.json) {
    info(`${JSON.stringify(processRecord, null, 2)}\n`);
    return;
  }

  info(renderManagedProcessDetails(processRecord));
}

async function handlePortsCommand(options: {
  registry: ProcessRegistry;
  json: boolean;
}): Promise<void> {
  const snapshots = await options.registry.listSnapshots();
  const portRows = snapshots.map((processRecord) => ({
    name: processRecord.name,
    pid: processRecord.pid,
    status: processRecord.status,
    ports: processRecord.ports,
  }));

  if (options.json) {
    info(`${JSON.stringify(portRows, null, 2)}\n`);
    return;
  }

  if (portRows.length === 0) {
    info("No managed processes.\n");
    return;
  }

  for (const portRow of portRows) {
    info(
      `${portRow.name} pid=${portRow.pid} status=${portRow.status} ports=${
        portRow.ports.length > 0 ? portRow.ports.join(",") : "-"
      }`,
    );
  }
}

async function handleProfilesCommand(options: {
  cwd: string;
  explicitConfigPath?: string;
  cacheStore: CacheStore;
  useCache: boolean;
}): Promise<void> {
  const resolvedConfig = await requireResolvedConfig({
    cwd: options.cwd,
    explicitConfigPath: options.explicitConfigPath,
    cacheStore: options.cacheStore,
    useCache: options.useCache,
  });
  const profiles = listProfiles(resolvedConfig.config);

  for (const profile of profiles) {
    info(
      `${profile.isDefault ? "*" : " "} ${profile.name.padEnd(12)} ${profile.command}${
        profile.description ? ` - ${profile.description}` : ""
      }`,
    );
  }
}

async function handleSignalCommand(options: {
  identifier: string;
  registry: ProcessRegistry;
  signal: NodeJS.Signals;
  nextStatus: "stopped" | "exited";
  verb: string;
}): Promise<void> {
  const processRecord = await signalManagedProcess(
    options.registry,
    options.identifier,
    options.signal,
    options.nextStatus,
  );
  info(`${options.verb} ${processRecord.name}`);
}

async function handleRestartCommand(options: {
  identifier: string;
  registry: ProcessRegistry;
  globalConfig: GlobalConfig;
}): Promise<void> {
  const processRecord = await restartManagedProcess(options.registry, options.identifier, {
    globalConfig: options.globalConfig,
  });
  info(`restarted ${processRecord.name}`);
  info(`  pid: ${processRecord.pid}`);
}

async function handleLogsCommand(options: {
  identifier: string;
  registry: ProcessRegistry;
  follow: boolean;
  lines: number;
}): Promise<void> {
  const processRecord = await requireProcessSnapshot(options.registry, options.identifier);

  if (!(await pathExists(processRecord.logPath))) {
    throw new Error(`Log file not found: ${processRecord.logPath}`);
  }

  if (options.follow) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tail", ["-n", String(options.lines), "-f", processRecord.logPath], {
        stdio: "inherit",
      });

      child.on("exit", (code) => {
        if (code === 0 || code === null) {
          resolve();
          return;
        }

        reject(new Error(`tail exited with code ${code}.`));
      });

      child.on("error", reject);
    });

    return;
  }

  const content = await readTextFile(processRecord.logPath);
  const lines = content.trimEnd().split("\n").slice(-options.lines);
  info(`${lines.join("\n")}\n`);
}

async function handleConfigCommand(options: {
  action?: string;
  cwd: string;
  global: boolean;
  cacheStore: CacheStore;
  globalConfig: GlobalConfig;
  useCache: boolean;
}): Promise<void> {
  if (!options.action || !["view", "path", "edit"].includes(options.action)) {
    throw new Error("Usage: run config <view|path|edit> [--global]");
  }

  if (options.global) {
    const globalConfigPath = getGlobalConfigPath();

    if (options.action === "path") {
      info(globalConfigPath);
      return;
    }

    if (options.action === "view") {
      if (!(await pathExists(globalConfigPath))) {
        warn(`No global config found at ${globalConfigPath}.`);
        return;
      }

      info(await readTextFile(globalConfigPath));
      return;
    }

    if (!(await pathExists(globalConfigPath))) {
      await writeTextFile(globalConfigPath, renderGlobalConfig({ cache: true }));
    }

    await openInEditor(globalConfigPath, options.globalConfig);
    return;
  }

  const resolvedConfig = await requireResolvedConfig({
    cwd: options.cwd,
    cacheStore: options.cacheStore,
    useCache: options.useCache,
  });

  if (options.action === "path") {
    info(resolvedConfig.sourcePath);
    return;
  }

  if (options.action === "view") {
    info(await readTextFile(resolvedConfig.sourcePath));

    if (options.useCache) {
      await options.cacheStore.save();
    }

    return;
  }

  await openInEditor(resolvedConfig.sourcePath, options.globalConfig);

  if (options.useCache) {
    await options.cacheStore.save();
  }
}

async function requireResolvedConfig(options: {
  cwd: string;
  explicitConfigPath?: string;
  cacheStore: CacheStore;
  useCache: boolean;
}): Promise<ResolvedConfig> {
  const resolvedConfig = await resolveProjectConfig({
    cwd: options.cwd,
    explicitConfigPath: options.explicitConfigPath,
    useCache: options.useCache,
    cacheStore: options.cacheStore,
  });

  if (!resolvedConfig) {
    throw new Error(`No ${CONFIG_FILE_NAME} found above ${options.cwd}.`);
  }

  return resolvedConfig;
}

async function requireProcessSnapshot(
  registry: ProcessRegistry,
  identifier: string,
): Promise<ManagedProcessSnapshot> {
  const snapshots = await registry.listSnapshots();
  const processRecord =
    snapshots.find((entry) => entry.id === identifier || entry.name === identifier) ?? null;

  if (!processRecord) {
    throw new Error(`Managed process "${identifier}" was not found.`);
  }

  return processRecord;
}

async function requireIdentifier(
  commandName: string,
  identifier: string | undefined,
): Promise<void> {
  if (!identifier) {
    throw new Error(`Usage: run ${commandName} <name|id>`);
  }
}

async function openInEditor(targetPath: string, globalConfig: GlobalConfig): Promise<void> {
  const editor = globalConfig.editor ?? process.env.EDITOR ?? "vi";
  const shell = globalConfig.shell ?? process.env.SHELL ?? FALLBACK_SHELL;
  const command = `${editor} ${shellQuote(targetPath)}`;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(shell, ["-lc", command], {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Editor exited with code ${code ?? 1}.`));
    });

    child.on("error", reject);
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function printHelp(): void {
  info(`run - fast project launcher and lightweight local process manager

Usage:
  run [profile] [--dry-run] [--no-cache] [--config <path>] [--cwd <path>]
  run init [--force] [--yes] [--command <cmd>] [--default-profile <name>] [--profile <name=command>]
  run completion <zsh|bash>
  run profiles
  run up [profile] [--name <name>]
  run ps [--json]
  run dashboard
  run inspect <name|id> [--json]
  run logs <name|id> [--lines <n>] [--follow]
  run stop <name|id>
  run restart <name|id>
  run kill <name|id>
  run ports [--json]
  run config <view|path|edit> [--global]
  run doctor
  run help

Notes:
  - The nearest ${CONFIG_FILE_NAME} wins.
  - Plain "run" executes the effective default profile for the project.
  - "run completion" prints shell completion scripts for Bash or Zsh.
  - "run up" starts a managed background process with logs, pid, uptime, memory, and ports.
  - "run dashboard" shows the current managed process cluster in one place.`);
}
