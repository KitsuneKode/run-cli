import { runInit } from "../init.ts";
import { dim, info } from "../output.ts";
import type { Command } from "./types.ts";

export const initCommand: Command = {
  name: "init",
  description: "Initialize or add to local configurations",
  usage:
    "[--force] [--yes] [--command <cmd>] [--default-profile <name>] [--add-profile <name=command>]",
  flags: {
    command: { type: "string", description: "Default command to write to config" },
    "default-profile": { type: "string", description: "Name of the default profile" },
    "add-profile": {
      type: "string",
      multiple: true,
      description: "Add a profile in name=command format",
    },
    profile: { type: "string", multiple: true, description: "Deprecated profile specifier" },
    force: { type: "boolean", description: "Overwrite existing config" },
    yes: { type: "boolean", description: "Answer yes to prompts" },
  },
  execute: async (ctx, parsed) => {
    const useCache = await ctx.useCache();
    const result = await runInit({
      cwd: ctx.cwd,
      useCache,
      force: parsed.force,
      yes: parsed.yes,
      command: parsed.command,
      defaultProfile: parsed.defaultProfile,
      profiles: parsed.addProfiles,
      cacheStore: ctx.cacheStore,
    });

    info(`created ${result.path}`);

    if (parsed.deprecatedInitProfileFlagUsed) {
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
  },
};
