import { spawn } from "node:child_process";
import path from "node:path";

import { parseArgs } from "./args.ts";
import { CacheStore } from "./cache.ts";
import {
  renderMinimalBanner,
  renderProcessBanner,
  renderVerboseBanner,
  resolveCommandLine,
} from "./command-line.ts";
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
import { doctorReportData, renderDoctorReport } from "./doctor.ts";
import { getGlobalConfigPath } from "./env-paths.ts";
import { runResolvedProfile } from "./exec.ts";
import { pathExists, readTextFile, writeTextFile } from "./fs.ts";
import { runInit } from "./init.ts";
import {
  renderManagedDashboard,
  renderManagedProcessDetails,
  renderManagedProcessList,
} from "./managed-process-view.ts";
import { dim, info, magenta, red, warn } from "./output.ts";
import {
  restartManagedProcess,
  signalManagedProcess,
  startManagedProcess,
} from "./process-manager.ts";
import { ProcessRegistry } from "./process-registry.ts";
import type { GlobalConfig, ManagedProcessSnapshot, ResolvedConfig } from "./types.ts";

const SAFE_HEAP_LIMIT_MB = 256;

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const cacheStore = new CacheStore();
  const cwd = path.resolve(parsed.cwd ?? process.cwd());
  const [firstPositional, secondPositional] = parsed.positionals;

  if (parsed.help || firstPositional === "help") {
    printHelp();
    return;
  }

  // Fail-fast: check CLI memory usage before doing any work
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
  if (heapUsedMB > SAFE_HEAP_LIMIT_MB) {
    console.error(
      red(
        `error: run-cli heap usage ${heapUsedMB.toFixed(1)}MB exceeds safe limit ${SAFE_HEAP_LIMIT_MB}MB. Restart the CLI.`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  try {
    switch (firstPositional) {
      case "init": {
        const globalConfig = await readGlobalConfig();
        const useCache = !parsed.noCache && globalConfig.cache;
        await handleInitCommand({
          cwd,
          useCache,
          cacheStore,
          force: parsed.force,
          yes: parsed.yes,
          command: parsed.command,
          defaultProfile: parsed.defaultProfile,
          profiles: parsed.addProfiles,
          usedDeprecatedProfileFlag: parsed.deprecatedInitProfileFlagUsed,
        });
        return;
      }
      case "config": {
        const globalConfig = await readGlobalConfig();
        const useCache = !parsed.noCache && globalConfig.cache;
        await handleConfigCommand({
          action: secondPositional,
          cwd,
          global: parsed.global,
          cacheStore,
          globalConfig,
          useCache,
        });
        return;
      }
      case "completion":
        handleCompletionCommand(secondPositional);
        return;
      case "doctor": {
        const globalConfig = await readGlobalConfig();
        const useCache = !parsed.noCache && globalConfig.cache;
        await handleDoctorCommand({
          cwd,
          explicitConfigPath: parsed.configPath,
          cacheStore,
          globalConfig,
          useCache,
          json: parsed.json,
        });
        return;
      }
      case "profiles": {
        const globalConfig = await readGlobalConfig();
        const useCache = !parsed.noCache && globalConfig.cache;
        await handleProfilesCommand({
          cwd,
          explicitConfigPath: parsed.configPath,
          cacheStore,
          useCache,
          json: parsed.json,
        });
        return;
      }
      case "up": {
        const globalConfig = await readGlobalConfig();
        const useCache = !parsed.noCache && globalConfig.cache;
        await handleUpCommand({
          cwd,
          profileName: parsed.profileName,
          commandArgs: parsed.commandArgs,
          explicitConfigPath: parsed.configPath,
          cacheStore,
          globalConfig,
          useCache,
          name: parsed.name,
        });
        return;
      }
      case "ps":
        await handlePsCommand({
          registry: new ProcessRegistry(),
          json: parsed.json,
          details: parsed.details,
          watch: parsed.watch,
        });
        return;
      case "dashboard":
        await handleDashboardCommand({
          registry: new ProcessRegistry(),
        });
        return;
      case "inspect":
        await requireIdentifier("inspect", secondPositional);
        await handleInspectCommand({
          identifier: secondPositional ?? "",
          registry: new ProcessRegistry(),
          json: parsed.json,
        });
        return;
      case "logs":
        await requireIdentifier("logs", secondPositional);
        await handleLogsCommand({
          identifier: secondPositional ?? "",
          registry: new ProcessRegistry(),
          follow: parsed.follow,
          lines: parsed.lines ?? 40,
        });
        return;
      case "stop":
        await requireIdentifier("stop", secondPositional);
        await handleSignalCommand({
          identifier: secondPositional ?? "",
          registry: new ProcessRegistry(),
          signal: "SIGTERM",
          nextStatus: "stopped",
          verb: "stopped",
        });
        return;
      case "kill":
        await requireIdentifier("kill", secondPositional);
        await handleSignalCommand({
          identifier: secondPositional ?? "",
          registry: new ProcessRegistry(),
          signal: "SIGKILL",
          nextStatus: "exited",
          verb: "killed",
        });
        return;
      case "restart":
        await requireIdentifier("restart", secondPositional);
        {
          const globalConfig = await readGlobalConfig();
          await handleRestartCommand({
            identifier: secondPositional ?? "",
            registry: new ProcessRegistry(),
            globalConfig,
          });
          return;
        }
      case "prune": {
        const registry = new ProcessRegistry();
        const dryRun = parsed.dryRun;
        const { removed, kept, cleaned } = await registry.withLock(() =>
          registry.prune({ dryRun }),
        );

        if (parsed.json) {
          info(`${JSON.stringify({ removed, kept, cleaned, dryRun }, null, 2)}\n`);
        } else if (removed === 0) {
          info("Nothing to prune.");
        } else {
          const prefix = dryRun ? "Would prune" : "Pruned";
          const suffix = kept > 0 ? ` (${kept} running kept)` : "";
          info(
            `${prefix} ${removed} dead process${removed === 1 ? "" : "es"}: ${cleaned.join(", ")}${suffix}`,
          );
        }

        return;
      }
      case "ports":
        await handlePortsCommand({
          registry: new ProcessRegistry(),
          json: parsed.json,
        });
        return;
      default:
        if (firstPositional && RESERVED_COMMANDS.has(firstPositional)) {
          throw new Error(`Unknown command: ${firstPositional}`);
        }

        {
          const globalConfig = await readGlobalConfig();
          const useCache = !parsed.noCache && globalConfig.cache;
          await handleRunCommand({
            cwd,
            profileName: parsed.profileName,
            commandArgs: parsed.commandArgs,
            explicitConfigPath: parsed.configPath,
            cacheStore,
            globalConfig,
            useCache,
            dryRun: parsed.dryRun,
            verbose: parsed.verbose,
          });
        }
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
  usedDeprecatedProfileFlag: boolean;
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

  if (options.usedDeprecatedProfileFlag) {
    info(
      dim("hint: `run init --profile name=command` is deprecated; use `--add-profile` instead."),
    );
  }

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
  json: boolean;
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

  if (options.json) {
    info(
      `${JSON.stringify(
        doctorReportData({
          cwd: options.cwd,
          globalConfig: options.globalConfig,
          projectConfig,
          detectedProject,
        }),
        null,
        2,
      )}\n`,
    );
  } else {
    info(
      renderDoctorReport({
        cwd: options.cwd,
        globalConfig: options.globalConfig,
        projectConfig,
        detectedProject,
      }),
    );
  }

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
  commandArgs: string[];
  explicitConfigPath?: string;
  cacheStore: CacheStore;
  globalConfig: GlobalConfig;
  useCache: boolean;
  dryRun: boolean;
  verbose: boolean;
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

    info('Run "run init" to choose one of the detected commands or enter your own.');
    info("Run \"run init --command '<your command>'\" to write a custom command directly.");

    if (options.useCache) {
      await options.cacheStore.save();
    }

    process.exitCode = 1;
    return;
  }

  await maybeHandlePositionalProfileMigration({
    resolvedConfig,
    profileName: options.profileName,
    commandArgs: options.commandArgs,
  });

  const profile = resolveProfile(resolvedConfig, options.profileName);
  const commandLine = resolveCommandLine(profile, options.commandArgs);

  if (options.dryRun) {
    info(commandLine.shellCommand);

    if (options.verbose) {
      info(dim(`profile=${profile.name} cwd=${profile.cwd} config=${profile.sourcePath}`));
    }
  } else {
    info(renderMinimalBanner(commandLine));

    if (resolvedConfig.isLegacyPath) {
      info(
        dim(
          `hint: using legacy config ${resolvedConfig.sourcePath}. Rename it to ${CONFIG_FILE_NAME}.`,
        ),
      );
    }

    if (options.verbose) {
      const verboseBanner = renderVerboseBanner({
        profile,
        commandLine,
        cacheHit: resolvedConfig.cacheHit,
      }).split("\n")[1];

      if (verboseBanner) {
        info(dim(verboseBanner));
      }
    }
  }

  const exitCode = await runResolvedProfile(profile, options.globalConfig, {
    dryRun: options.dryRun,
    args: options.commandArgs,
  });

  if (options.useCache) {
    await options.cacheStore.save();
  }

  process.exitCode = exitCode;
}

async function maybeHandlePositionalProfileMigration(options: {
  resolvedConfig: ResolvedConfig;
  profileName?: string;
  commandArgs: string[];
}): Promise<void> {
  if (options.profileName || options.commandArgs.length === 0) {
    return;
  }

  const firstArg = options.commandArgs[0];

  if (!firstArg || firstArg === "--") {
    return;
  }

  const profiles = listProfiles(options.resolvedConfig.config);
  const matchedProfile = profiles.find((profile) => profile.name === firstArg);

  if (!matchedProfile) {
    return;
  }

  throw new Error(
    [
      "positional profiles were removed.",
      `Use: run -p ${matchedProfile.name}`,
      `To pass \"${matchedProfile.name}\" to the default command, use: run -- ${options.commandArgs.join(" ")}`,
    ].join(" "),
  );
}

async function handleUpCommand(options: {
  cwd: string;
  profileName?: string;
  commandArgs: string[];
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
    args: options.commandArgs,
    globalConfig: options.globalConfig,
    registry,
    nameOverride: options.name,
  });

  info(renderProcessBanner(processRecord));
  info(
    dim(
      `  ${dim("next:")} ${magenta("run logs")} ${processRecord.name} --follow  |  ${magenta("run inspect")} ${processRecord.name}  |  ${magenta("run ps")}`,
    ),
  );
}

async function handlePsCommand(options: {
  registry: ProcessRegistry;
  json: boolean;
  details: boolean;
  watch: boolean;
}): Promise<void> {
  const renderAndPrint = async () => {
    const snapshots = await options.registry.withLock(() =>
      options.registry.listSnapshots({
        includePorts: options.details,
        includeMemory: true,
      }),
    );

    if (options.json) {
      info(`${JSON.stringify(snapshots, null, 2)}\n`);
      return;
    }

    info(renderManagedProcessList(snapshots, { showPorts: options.details }));
  };

  if (options.watch) {
    // Clear screen and render in a loop
    process.stdout.write("\x1B[?25l"); // hide cursor
    process.on("SIGINT", () => {
      process.stdout.write("\x1B[?25h"); // show cursor
      process.exit(0);
    });

    while (true) {
      process.stdout.write("\x1B[H\x1B[2J"); // clear screen
      await renderAndPrint();
      await Bun.sleep(2000);
    }
  }

  await renderAndPrint();
}

async function handleDashboardCommand(options: {
  registry: ProcessRegistry;
}): Promise<void> {
  const snapshots = await options.registry.withLock(() =>
    options.registry.listSnapshots({
      includePorts: false,
      includeMemory: true,
    }),
  );
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
  const snapshots = await options.registry.withLock(() =>
    options.registry.listSnapshots({
      includePorts: true,
      includeMemory: false,
    }),
  );
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
  json: boolean;
}): Promise<void> {
  const resolvedConfig = await requireResolvedConfig({
    cwd: options.cwd,
    explicitConfigPath: options.explicitConfigPath,
    cacheStore: options.cacheStore,
    useCache: options.useCache,
  });
  const profiles = listProfiles(resolvedConfig.config);

  if (options.json) {
    info(`${JSON.stringify(profiles, null, 2)}\n`);
    return;
  }

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
  if (!options.action || !["view", "path", "edit", "validate"].includes(options.action)) {
    throw new Error("Usage: run config <view|path|edit|validate> [--global]");
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

  if (options.action === "validate") {
    info(`valid ${resolvedConfig.sourcePath}`);
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
  return await registry.withLock(async () => {
    const processRecord = await registry.getSnapshot(identifier);

    if (!processRecord) {
      const snapshots = await registry.listSnapshots();
      const availableNames = snapshots.map((entry) => entry.name).join(", ");
      throw new Error(
        availableNames.length > 0
          ? `Managed process "${identifier}" was not found. Available: ${availableNames}`
          : `Managed process "${identifier}" was not found.`,
      );
    }

    return processRecord;
  });
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
  run [args...] [-p <profile>] [-v] [--dry-run] [--no-cache] [--config <path>] [--cwd <path>]
  run init [--force] [--yes] [--command <cmd>] [--default-profile <name>] [--add-profile <name=command>]
  run completion <zsh|bash>
  run doctor [--json]
  run profiles [--json]
  run up [args...] [-p <profile>] [--name <name>]
  run ps [--json] [--details] [--watch]
  run dashboard
  run inspect <name|id> [--json]
  run logs <name|id> [--lines <n>] [--follow]
  run stop <name|id>
  run restart <name|id>
  run kill <name|id>
  run prune [--json] [--dry-run]
  run ports [--json]
  run config <view|path|edit|validate> [--global]
  run help

Mental model:
  - plain "run" = default command
  - "run -p <profile>" = named profile
  - "run -- <args...>" = child command args
  - built-in subcommands like "doctor", "inspect", and "ports" only apply before "--"

Examples:
  run
  run -- --watch
  run -- doctor
  run -p dev -- --port 3000
  run up -p worker
  run ps --watch
  run init --yes --add-profile dev="bun --hot index.ts"

Notes:
  - The nearest ${CONFIG_FILE_NAME} wins.
  - Plain "run" executes the effective default profile for the project.
  - Profiles are explicit: use "run -p <profile>".
  - Use "--" to pass flags through to the underlying command.
  - "run ps" shows memory by default; use "--watch" for live updates.
  - "run ps --details" adds port information.
  - "run completion" prints shell completion scripts for Bash or Zsh.
  - "run up" starts a managed background process with logs, pid, uptime, memory, and ports.
  - "run dashboard" shows the current managed process cluster in one place.`);
}
