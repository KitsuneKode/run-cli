import type { WorkspaceContext } from "../context.ts";
import type { ParsedArgs } from "../args.ts";
import type { Command } from "./types.ts";
import os from "node:os";
import path from "node:path";
import { info, warn } from "../output.ts";
import {
  renderBashCompletion,
  renderBashShellHook,
  renderZshCompletion,
  renderZshShellHook,
} from "../completion.ts";
import { pathExists, readTextFile, writeTextFile } from "../fs.ts";

export const completionCommand: Command = {
  name: "completion",
  description: "Generate or install shell completion scripts",
  flags: {
    "shell-hook": { type: "boolean", description: "Output shell hook script" },
    install: {
      type: "boolean",
      description: "Automatically install the shell hook script to shell rc",
    },
  },
  execute: async (ctx, parsed) => {
    const shell = parsed.positionals[1];
    const shellHook = parsed.shellHook;
    const install = parsed.install;

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
  },
};

async function installShellHook(shell: "zsh" | "bash"): Promise<void> {
  const homeDir = os.homedir();
  const rcFileName = shell === "zsh" ? ".zshrc" : ".bashrc";
  const rcFilePath = path.join(homeDir, rcFileName);

  const hookComment = "# run-cli completion hook";
  const hookSnippet = `eval "$(run completion ${shell} --shell-hook)"`;
  const appendSnippet = `\\n${hookComment}\\n${hookSnippet}\\n`;

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
