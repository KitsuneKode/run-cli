import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { parseArgs } from "./args.ts";
import {
  renderMinimalBanner,
  renderProcessBanner,
  renderVerboseBanner,
  resolveCommandLine,
} from "./command-line.ts";
import {
  renderBashCompletion,
  renderBashShellHook,
  renderZshCompletion,
  renderZshShellHook,
} from "./completion.ts";
import { listProfiles, listShortcutNames, renderGlobalConfig, resolveProfile } from "./config.ts";
import { CONFIG_FILE_NAME, FALLBACK_SHELL, RESERVED_COMMANDS } from "./constants.ts";
import { WorkspaceContext } from "./context.ts";
import { detectProject } from "./detect.ts";
import { doctorReportData, renderDoctorReport } from "./doctor.ts";
import { getGlobalConfigPath } from "./env-paths.ts";
import { runResolvedProfile } from "./exec.ts";
import { pathExists, readTextFile, sleep, writeTextFile } from "./fs.ts";
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
import {
  findNearestExistingConfig,
  isConfigTrusted,
  listTrustedConfigs,
  revokeConfigTrust,
  trustConfig,
} from "./trust.ts";
import type { GlobalConfig, ManagedProcessSnapshot, ResolvedConfig } from "./types.ts";

const SAFE_HEAP_LIMIT_MB = 256;

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const ctx = new WorkspaceContext({
    cwd: parsed.cwd ?? process.cwd(),
    explicitConfigPath: parsed.configPath,
    noCache: parsed.noCache,
  });
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
        await handleInitCommand(ctx, {
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
        await handleConfigCommand(ctx, {
          action: secondPositional,
          global: parsed.global,
        });
        return;
      }
      case "completion":
        await handleCompletionCommand(secondPositional, parsed.shellHook, parsed.install);
        return;
      case "doctor": {
        await handleDoctorCommand(ctx, {
          json: parsed.json,
        });
        return;
      }
      case "profiles": {
        // --shortcuts flag: print one shortcut name per line for shell hook
        if (parsed.shortcuts) {
          await handleProfileShortcutsCommand(ctx);
          return;
        }
        await handleProfilesCommand(ctx, {
          json: parsed.json,
        });
        return;
      }
      case "trust": {
        await handleTrustCommand(ctx, {
          action: secondPositional,
          check: parsed.check,
          revoke: parsed.revoke,
          list: parsed.list,
          json: parsed.json,
        });
        return;
      }
      case "up": {
        await handleUpCommand(ctx, {
          profileName: parsed.profileName,
          commandArgs: parsed.commandArgs,
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
          watch: parsed.watch,
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
          await handleRestartCommand(ctx, {
            identifier: secondPositional ?? "",
            registry: new ProcessRegistry(),
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
          await handleRunCommand(ctx, {
            profileName: parsed.profileName,
            commandArgs: parsed.commandArgs,
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

async function handleInitCommand(
  ctx: WorkspaceContext,
  options: {
    force: boolean;
    yes: boolean;
    command?: string;
    defaultProfile?: string;
    profiles: Array<{ name: string; command: string }>;
    usedDeprecatedProfileFlag: boolean;
  },
): Promise<void> {
  const useCache = await ctx.useCache();
  const result = await runInit({
    cwd: ctx.cwd,
    useCache,
    force: options.force,
    yes: options.yes,
    command: options.command,
    defaultProfile: options.defaultProfile,
    profiles: options.profiles,
    cacheStore: ctx.cacheStore,
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

  await ctx.saveCacheIfNeeded();
}

async function handleDoctorCommand(
  ctx: WorkspaceContext,
  options: {
    json: boolean;
  },
): Promise<void> {
  const projectConfig = await ctx.getProjectConfig();
  const useCache = await ctx.useCache();
  const detectedProject = await detectProject({
    cwd: ctx.cwd,
    useCache,
    cacheStore: ctx.cacheStore,
  });
  const globalConfig = await ctx.getGlobalConfig();

  if (options.json) {
    info(
      `${JSON.stringify(
        doctorReportData({
          cwd: ctx.cwd,
          globalConfig,
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
        cwd: ctx.cwd,
        globalConfig,
        projectConfig,
        detectedProject,
      }),
    );
  }

  await ctx.saveCacheIfNeeded();
}

async function handleCompletionCommand(
  shell: string | undefined,
  shellHook = false,
  install = false,
): Promise<void> {
  if (install) {
    if (shell !== "zsh" && shell !== "bash") {
      throw new Error("Usage: run completion <zsh|bash> --install");
    }
    await installShellHook(shell);
    return;
  }
  switch (shell) {
    case "zsh":
      info(shellHook ? renderZshShellHook() : renderZshCompletion());
      return;
    case "bash":
      info(shellHook ? renderBashShellHook() : renderBashCompletion());
      return;
    default:
      throw new Error("Usage: run completion <zsh|bash> [--shell-hook] [--install]");
  }
}

async function installShellHook(shell: "zsh" | "bash"): Promise<void> {
  const homeDir = os.homedir();
  const rcFileName = shell === "zsh" ? ".zshrc" : ".bashrc";
  const rcFilePath = path.join(homeDir, rcFileName);

  const hookComment = "# run-cli completion hook";
  const hookSnippet = `eval "$(run completion ${shell} --shell-hook)"`;
  const appendSnippet = `\n${hookComment}\n${hookSnippet}\n`;

  let content = "";
  if (await pathExists(rcFilePath)) {
    content = await readTextFile(rcFilePath);
  }

  if (
    content.includes("run completion") &&
    (content.includes("shell-hook") || content.includes("completion"))
  ) {
    info(`Shell hook is already present in ~/${rcFileName}.`);
    return;
  }

  await writeTextFile(rcFilePath, content + appendSnippet);
  info(`Successfully installed shell hook to ~/${rcFileName}.`);
  warn(`Please run: source ~/${rcFileName} (or restart your terminal) to enable completions.`);
}

async function handleRunCommand(
  ctx: WorkspaceContext,
  options: {
    profileName?: string;
    commandArgs: string[];
    dryRun: boolean;
    verbose: boolean;
  },
): Promise<void> {
  const resolvedConfig = await ctx.getProjectConfig();

  if (!resolvedConfig) {
    const useCache = await ctx.useCache();
    const detectedProject = await detectProject({
      cwd: ctx.cwd,
      useCache,
      cacheStore: ctx.cacheStore,
    });

    warn(`No ${CONFIG_FILE_NAME} was found above ${ctx.cwd}.`);

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

    await ctx.saveCacheIfNeeded();

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

  const globalConfig = await ctx.getGlobalConfig();
  const exitCode = await runResolvedProfile(profile, globalConfig, {
    dryRun: options.dryRun,
    args: options.commandArgs,
  });

  await ctx.saveCacheIfNeeded();

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

async function handleUpCommand(
  ctx: WorkspaceContext,
  options: {
    profileName?: string;
    commandArgs: string[];
    name?: string;
  },
): Promise<void> {
  const resolvedConfig = await requireResolvedConfig(ctx);
  const profile = resolveProfile(resolvedConfig, options.profileName);
  const registry = new ProcessRegistry();
  const globalConfig = await ctx.getGlobalConfig();
  const processRecord = await startManagedProcess({
    profile,
    args: options.commandArgs,
    globalConfig,
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
      await sleep(2000);
    }
  }

  await renderAndPrint();
}

async function handleDashboardCommand(options: {
  registry: ProcessRegistry;
  watch: boolean;
}): Promise<void> {
  const renderAndPrint = async () => {
    const snapshots = await options.registry.withLock(() =>
      options.registry.listSnapshots({
        includePorts: false,
        includeMemory: true,
      }),
    );
    info(renderManagedDashboard(snapshots));
  };

  if (options.watch) {
    process.stdout.write("\x1B[?25l"); // hide cursor
    process.on("SIGINT", () => {
      process.stdout.write("\x1B[?25h"); // show cursor
      process.exit(0);
    });

    while (true) {
      process.stdout.write("\x1B[H\x1B[2J"); // clear screen
      await renderAndPrint();
      await sleep(2000);
    }
  }

  await renderAndPrint();
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

async function handleProfilesCommand(
  ctx: WorkspaceContext,
  options: {
    json: boolean;
  },
): Promise<void> {
  const resolvedConfig = await requireResolvedConfig(ctx);
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

async function handleProfileShortcutsCommand(ctx: WorkspaceContext): Promise<void> {
  const resolvedConfig = await requireResolvedConfig(ctx);
  const names = listShortcutNames(resolvedConfig.config);
  for (const name of names) {
    info(name);
  }
}

async function handleTrustCommand(
  ctx: WorkspaceContext,
  options: {
    action: string | undefined;
    check: boolean;
    revoke: boolean;
    list: boolean;
    json: boolean;
  },
): Promise<void> {
  const isCheck = options.check || options.action === "check" || options.action === "--check";
  const isRevoke = options.revoke || options.action === "revoke" || options.action === "--revoke";
  const isList = options.list || options.action === "list" || options.action === "--list";
  const isDefault = options.action === "trust" || options.action === undefined;

  if (isCheck) {
    const configPath = await findNearestExistingConfig(ctx.cwd);
    if (!configPath) {
      process.exitCode = 1;
      return;
    }
    const trusted = await isConfigTrusted(configPath);
    if (!trusted) {
      process.exitCode = 1;
    }
    return;
  }

  if (isRevoke) {
    const configPath = await findNearestExistingConfig(ctx.cwd);
    if (!configPath) {
      throw new Error(`No .run.toml found above ${ctx.cwd}.`);
    }
    const removed = await revokeConfigTrust(configPath);
    if (removed) {
      info(`Revoked trust for ${configPath}`);
    } else {
      info(`${configPath} was not trusted.`);
    }
    return;
  }

  if (isList) {
    const entries = await listTrustedConfigs();
    if (options.json) {
      info(`${JSON.stringify(entries, null, 2)}\n`);
      return;
    }
    if (entries.length === 0) {
      info("No trusted configs.");
      return;
    }
    for (const entry of entries) {
      info(`${entry.configPath}`);
      info(`  sha256:     ${entry.sha256}`);
      info(`  trusted at: ${entry.trustedAt}`);
    }
    return;
  }

  if (isDefault) {
    const configPath = await findNearestExistingConfig(ctx.cwd);
    if (!configPath) {
      throw new Error(`No .run.toml found above ${ctx.cwd}. Nothing to trust.`);
    }
    const entry = await trustConfig(configPath);
    info(`Trusted ${configPath}`);
    info(`  sha256: ${entry.sha256}`);
    info(`  trusted at: ${entry.trustedAt}`);
    return;
  }

  throw new Error(
    `Unknown trust action: "${options.action}". Use: run trust | run trust --check | run trust --revoke | run trust --list`,
  );
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

async function handleRestartCommand(
  ctx: WorkspaceContext,
  options: {
    identifier: string;
    registry: ProcessRegistry;
  },
): Promise<void> {
  const globalConfig = await ctx.getGlobalConfig();
  const processRecord = await restartManagedProcess(options.registry, options.identifier, {
    globalConfig,
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

async function handleConfigCommand(
  ctx: WorkspaceContext,
  options: {
    action?: string;
    global: boolean;
  },
): Promise<void> {
  if (!options.action || !["view", "path", "edit", "validate"].includes(options.action)) {
    throw new Error("Usage: run config <view|path|edit|validate> [--global]");
  }

  const globalConfig = await ctx.getGlobalConfig();

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

    await openInEditor(globalConfigPath, globalConfig);
    return;
  }

  const resolvedConfig = await requireResolvedConfig(ctx);

  if (options.action === "path") {
    info(resolvedConfig.sourcePath);
    return;
  }

  if (options.action === "view") {
    info(await readTextFile(resolvedConfig.sourcePath));
    await ctx.saveCacheIfNeeded();
    return;
  }

  if (options.action === "validate") {
    info(`valid ${resolvedConfig.sourcePath}`);
    return;
  }

  await openInEditor(resolvedConfig.sourcePath, globalConfig);
  await ctx.saveCacheIfNeeded();
}

async function requireResolvedConfig(ctx: WorkspaceContext): Promise<ResolvedConfig> {
  const resolvedConfig = await ctx.getProjectConfig();

  if (!resolvedConfig) {
    throw new Error(`No ${CONFIG_FILE_NAME} found above ${ctx.cwd}.`);
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
  const editor = globalConfig.editor ?? process.env.VISUAL ?? process.env.EDITOR ?? "vi";
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
  run completion <zsh|bash> [--shell-hook]
  run trust [--check | --revoke | --list]
  run doctor [--json]
  run profiles [--json]
  run up [args...] [-p <profile>] [--name <name>]
  run ps [--json] [--details] [--watch]
  run dashboard [--watch]
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
  rund -- --port 3000                 # (if alias="d" and shell hook is installed)
  run-worker                          # (if profile="worker" and shell hook is installed)
  run up -p worker
  run ps --watch
  run init --yes --add-profile dev="bun --hot index.ts"
  eval "$(run completion --shell-hook zsh)"  # Install shell hook

Notes:
  - The nearest \${CONFIG_FILE_NAME} wins.
  - Plain "run" executes the effective default profile for the project.
  - Profiles are explicit: use "run -p <profile>".
  - Use "--" to pass flags through to the underlying command.
  - "run ps" shows memory by default; use "--watch" for live updates.
  - "run ps --details" adds port information.
  - "run completion" prints shell completion scripts for Bash or Zsh.
  - "run up" starts a managed background process with logs, pid, uptime, memory, and ports.
  - "run dashboard" shows the current managed process cluster in one place. Use "--watch" to refresh live.`);
}
