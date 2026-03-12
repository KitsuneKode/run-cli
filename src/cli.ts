import { spawn } from "node:child_process";
import path from "node:path";

import { parseArgs } from "./args.ts";
import { CacheStore } from "./cache.ts";
import {
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
import { cyan, dim, green, info, red, warn } from "./output.ts";
import type { GlobalConfig } from "./types.ts";

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const cacheStore = new CacheStore();
  const cwd = path.resolve(parsed.cwd ?? process.cwd());
  const globalConfig = await readGlobalConfig();
  const useCache = !parsed.noCache && globalConfig.cache;
  const [firstPositional, secondPositional] = parsed.positionals;

  if (parsed.help || firstPositional === "help") {
    printHelp();
    return;
  }

  try {
    if (firstPositional === "init") {
      const result = await runInit({
        cwd,
        useCache,
        force: parsed.force,
        yes: parsed.yes,
        command: parsed.command,
        profiles: parsed.profiles,
        cacheStore,
      });

      info(`${green("created")} ${result.path}`);

      if (result.detected.length > 0) {
        info(dim("Detected commands:"));

        for (const suggestion of result.detected) {
          const label = suggestion.kind === "profile" ? `${suggestion.name}: ` : "";
          info(`  - ${label}${suggestion.command}`);
        }
      }

      if (useCache) {
        await cacheStore.save();
      }

      return;
    }

    if (firstPositional === "config") {
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

    if (firstPositional === "doctor") {
      const projectConfig = await resolveProjectConfig({
        cwd,
        explicitConfigPath: parsed.configPath,
        useCache,
        cacheStore,
      });
      const detectedProject = await detectProject({
        cwd,
        useCache,
        cacheStore,
      });

      info(
        renderDoctorReport({
          cwd,
          globalConfig,
          projectConfig,
          detectedProject,
        }),
      );

      if (useCache) {
        await cacheStore.save();
      }

      return;
    }

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(red(`error: ${message}`));
    process.exitCode = 1;
  }
}

async function handleRunCommand(options: {
  cwd: string;
  profileName?: string;
  explicitConfigPath?: string;
  cacheStore: CacheStore;
  globalConfig: Awaited<ReturnType<typeof readGlobalConfig>>;
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
      info(dim(`Detected project root: ${detectedProject.root}`));
      info(dim("Suggested commands:"));

      for (const suggestion of detectedProject.suggestions) {
        const label = suggestion.kind === "profile" ? `${suggestion.name}: ` : "";
        info(
          `  - ${label}${suggestion.command} (${suggestion.reason}; confidence=${suggestion.confidence})`,
        );
      }
    } else {
      warn("No runnable command could be detected automatically.");
    }

    info(`Run ${cyan("run init")} to choose one of the detected commands or enter your own.`);
    info(`Run ${cyan("run init --command '<your command>'")} to write a custom command directly.`);

    if (options.useCache) {
      await options.cacheStore.save();
    }

    process.exitCode = 1;
    return;
  }

  const profile = resolveProfile(resolvedConfig, options.profileName);
  info(
    `${green("run")} ${profile.command} ${dim(
      `(profile=${profile.name} cwd=${profile.cwd} config=${profile.sourcePath}${
        resolvedConfig.cacheHit ? " cache" : ""
      })`,
    )}`,
  );

  const exitCode = await runResolvedProfile(profile, options.globalConfig, {
    dryRun: options.dryRun,
  });

  if (options.useCache) {
    await options.cacheStore.save();
  }

  process.exitCode = exitCode;
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

  const resolvedConfig = await resolveProjectConfig({
    cwd: options.cwd,
    useCache: options.useCache,
    cacheStore: options.cacheStore,
  });

  if (!resolvedConfig) {
    throw new Error(`No ${CONFIG_FILE_NAME} found above ${options.cwd}.`);
  }

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
  info(`run - fast project launcher with local config and smart detection

Usage:
  run [profile] [--dry-run] [--no-cache] [--config <path>] [--cwd <path>]
  run init [--force] [--yes] [--command <cmd>] [--profile <name=command>]
  run config <view|path|edit> [--global]
  run doctor
  run help

Notes:
  - The nearest ${CONFIG_FILE_NAME} wins.
  - Profiles are invoked as ${cyan("run dev")} or another profile name.
  - ${cyan("run init")} lets you choose a detected command or type your own.
  - Without config, run suggests commands and points you to ${cyan("run init")}.`);
}
