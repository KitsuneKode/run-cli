import { parseArgs } from "./args.ts";
import { renderMinimalBanner, renderVerboseBanner, resolveCommandLine } from "./command-line.ts";
import { commands } from "./commands/index.ts";
import { listProfiles, resolveProfile } from "./config.ts";
import { CONFIG_FILE_NAME, RESERVED_COMMANDS } from "./constants.ts";
import { WorkspaceContext } from "./context.ts";
import { detectProject } from "./detect.ts";
import { runResolvedProfile } from "./exec.ts";
import { dim, info, red, setForceNoColor, warn } from "./output.ts";
import type { ResolvedConfig } from "./types.ts";

const SAFE_HEAP_LIMIT_MB = 256;

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const ctx = new WorkspaceContext({
    cwd: parsed.cwd ?? process.cwd(),
    explicitConfigPath: parsed.configPath,
    noCache: parsed.noCache,
  });
  const [firstPositional] = parsed.positionals;

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
    const targetCmd = commands.find((c) => c.name === firstPositional);
    if (targetCmd) {
      await targetCmd.execute(ctx, parsed);
      await ctx.saveCacheIfNeeded();
      return;
    }

    if (firstPositional && RESERVED_COMMANDS.has(firstPositional)) {
      throw new Error(`Unknown command: ${firstPositional}`);
    }

    await handleRunCommand(ctx, {
      profileName: parsed.profileName,
      commandArgs: parsed.commandArgs,
      dryRun: parsed.dryRun,
      verbose: parsed.verbose,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(red(`error: ${message}`));
    process.exitCode = 1;
  }
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

  const globalConfig = await ctx.getGlobalConfig();
  const profile = resolveProfile(resolvedConfig, options.profileName, undefined, globalConfig);

  if (profile.no_color) {
    setForceNoColor(true);
  }

  const commandLine = resolveCommandLine(profile, options.commandArgs);

  if (options.dryRun) {
    info(commandLine.shellCommand);

    if (options.verbose) {
      info(dim(`profile=${profile.name} cwd=${profile.cwd} config=${profile.sourcePath}`));
    }
  } else {
    if (!profile.no_banner) {
      info(renderMinimalBanner(commandLine));
    }

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
      `To pass "${matchedProfile.name}" to the default command, use: run -- ${options.commandArgs.join(" ")}`,
    ].join(" "),
  );
}

function printHelp(): void {
  const usageLines = commands
    .map((c) => {
      const usageStr = c.usage ? ` ${c.usage}` : "";
      return `  run ${c.name}${usageStr}`;
    })
    .join("\n");

  info(`run - fast project launcher and lightweight local process manager

Usage:
  run [args...] [-p <profile>] [-v] [--dry-run] [--no-cache] [--config <path>] [--cwd <path>]
${usageLines}
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
  if command -v run >/dev/null 2>&1; then eval "$(run completion --shell-hook zsh)"; fi  # Install shell hook

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
