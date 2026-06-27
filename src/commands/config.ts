import { spawn } from "node:child_process";
import { renderGlobalConfig } from "../config.ts";
import { CONFIG_FILE_NAME, FALLBACK_SHELL } from "../constants.ts";
import { getGlobalConfigPath } from "../env-paths.ts";
import { pathExists, readTextFile, writeTextFile } from "../fs.ts";
import { info, warn } from "../output.ts";
import type { GlobalConfig } from "../types.ts";
import type { Command } from "./types.ts";

export const configCommand: Command = {
  name: "config",
  description: "View, edit, or validate local/global configurations",
  usage: "<view|path|edit|validate> [--global]",
  flags: {
    global: { type: "boolean", description: "Operations apply to global configuration" },
  },
  execute: async (ctx, parsed) => {
    const action = parsed.positionals[1];
    if (!action || !["view", "path", "edit", "validate"].includes(action)) {
      throw new Error("Usage: run config <view|path|edit|validate> [--global]");
    }

    const globalConfig = await ctx.getGlobalConfig();

    if (parsed.global) {
      const globalConfigPath = getGlobalConfigPath();

      if (action === "path") {
        info(globalConfigPath);
        return;
      }

      if (action === "view") {
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

    const resolvedConfig = await ctx.getProjectConfig();
    if (!resolvedConfig) {
      throw new Error(`No ${CONFIG_FILE_NAME} found above ${ctx.cwd}.`);
    }

    if (action === "path") {
      info(resolvedConfig.sourcePath);
      return;
    }

    if (action === "view") {
      info(await readTextFile(resolvedConfig.sourcePath));
      await ctx.saveCacheIfNeeded();
      return;
    }

    if (action === "validate") {
      info(`valid ${resolvedConfig.sourcePath}`);
      return;
    }

    await openInEditor(resolvedConfig.sourcePath, globalConfig);
    await ctx.saveCacheIfNeeded();
  },
};

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

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            `Editor '${editor}' was not found. Set a different editor with: run config edit --global`,
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
