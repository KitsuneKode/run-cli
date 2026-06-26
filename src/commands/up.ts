import type { ParsedArgs } from "../args.ts";
import { renderProcessBanner } from "../command-line.ts";
import { resolveProfile } from "../config.ts";
import { CONFIG_FILE_NAME } from "../constants.ts";
import type { WorkspaceContext } from "../context.ts";
import { dim, info, magenta } from "../output.ts";
import { startManagedProcess } from "../process-manager.ts";
import { ProcessRegistry } from "../process-registry.ts";
import type { Command } from "./types.ts";

export const upCommand: Command = {
  name: "up",
  description: "Start a managed process in the background",
  usage: "[args...] [-p <profile>] [--name <name>]",
  flags: {
    profile: { type: "string", short: "p", description: "Profile to run in the background" },
    name: { type: "string", description: "Override process display name" },
  },
  allowForwardedArgs: true,
  execute: async (ctx, parsed) => {
    const resolvedConfig = await ctx.getProjectConfig();
    if (!resolvedConfig) {
      throw new Error(`No ${CONFIG_FILE_NAME} found above ${ctx.cwd}.`);
    }
    const profile = resolveProfile(resolvedConfig, parsed.profileName);
    const registry = new ProcessRegistry();
    const globalConfig = await ctx.getGlobalConfig();
    const processRecord = await startManagedProcess({
      profile,
      args: parsed.commandArgs,
      globalConfig,
      registry,
      nameOverride: parsed.name,
    });

    info(renderProcessBanner(processRecord));
    info(
      dim(
        `  ${dim("next:")} ${magenta("run logs")} ${processRecord.name} --follow  |  ${magenta("run inspect")} ${processRecord.name}  |  ${magenta("run ps")}`,
      ),
    );
  },
};
