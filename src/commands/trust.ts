import { info } from "../output.ts";
import {
  findNearestExistingConfig,
  isConfigTrusted,
  listTrustedConfigs,
  revokeConfigTrust,
  trustConfig,
} from "../trust.ts";
import type { Command } from "./types.ts";

export const trustCommand: Command = {
  name: "trust",
  description: "Manage config file trust registration",
  usage: "[--check | --revoke | --list] [--json]",
  flags: {
    json: { type: "boolean", description: "Format output as JSON" },
    check: { type: "boolean", description: "Check if the current config is trusted" },
    revoke: { type: "boolean", description: "Revoke trust for the current config" },
    list: { type: "boolean", description: "List all trusted configs" },
  },
  execute: async (ctx, parsed) => {
    const action = parsed.positionals[1];
    const isCheck = parsed.check || action === "check" || action === "--check";
    const isRevoke = parsed.revoke || action === "revoke" || action === "--revoke";
    const isList = parsed.list || action === "list" || action === "--list";
    const isDefault = action === "trust" || action === undefined;

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
      if (parsed.json) {
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
      `Unknown trust action: "${action}". Use: run trust | run trust --check | run trust --revoke | run trust --list`,
    );
  },
};
