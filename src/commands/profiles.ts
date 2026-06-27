import { listProfiles, listShortcutNames } from "../config.ts";
import { CONFIG_FILE_NAME } from "../constants.ts";
import { info } from "../output.ts";
import type { Command } from "./types.ts";

export const profilesCommand: Command = {
  name: "profiles",
  description: "List available execution profiles",
  usage: "[--json] [--shortcuts]",
  flags: {
    shortcuts: { type: "boolean", description: "Emit shortcut names for shell hook" },
    json: { type: "boolean", description: "Format output as JSON" },
  },
  execute: async (ctx, parsed) => {
    const resolvedConfig = await ctx.getProjectConfig();
    if (!resolvedConfig) {
      throw new Error(`No ${CONFIG_FILE_NAME} found above ${ctx.cwd}.`);
    }

    if (parsed.shortcuts) {
      const names = listShortcutNames(resolvedConfig.config);
      for (const name of names) {
        info(name);
      }
      return;
    }

    const profiles = listProfiles(resolvedConfig.config);

    if (parsed.json) {
      info(`${JSON.stringify(profiles, null, 2)}\n`);
      return;
    }

    // Compute dynamic name column width (including alias suffix)
    const nameWidth = Math.max(
      12,
      ...profiles.map((p) => {
        const aliasSuffix = p.alias
          ? ` [${Array.isArray(p.alias) ? p.alias.join(",") : p.alias}]`
          : "";
        return p.name.length + aliasSuffix.length;
      }),
    );

    for (const profile of profiles) {
      const marker = profile.isDefault ? "*" : " ";
      const aliasSuffix = profile.alias
        ? ` [${Array.isArray(profile.alias) ? profile.alias.join(",") : profile.alias}]`
        : "";
      const nameCell = `${profile.name}${aliasSuffix}`.padEnd(nameWidth);
      const descSuffix = profile.description ? ` - ${profile.description}` : "";
      info(`${marker} ${nameCell}  ${profile.command}${descSuffix}`);
    }
  },
};
