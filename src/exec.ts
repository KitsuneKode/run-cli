import { spawn } from "node:child_process";

import { resolveCommandLine } from "./command-line.ts";
import { FALLBACK_SHELL } from "./constants.ts";
import type { GlobalConfig, ResolvedProfile } from "./types.ts";

export interface ExecutionOptions {
  dryRun: boolean;
  args?: string[];
}

export async function runResolvedProfile(
  profile: ResolvedProfile,
  globalConfig: GlobalConfig,
  options: ExecutionOptions,
): Promise<number> {
  if (options.dryRun) {
    return 0;
  }

  const shell = globalConfig.shell ?? process.env.SHELL ?? FALLBACK_SHELL;
  const commandLine = resolveCommandLine(profile, options.args ?? []);

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(shell, ["-lc", commandLine.shellCommand], {
      cwd: profile.cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        ...profile.env,
      },
    });

    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
    const handlers = signals.map((signal) => {
      const handler = () => {
        if (!child.killed) {
          child.kill(signal);
        }
      };

      process.on(signal, handler);
      return [signal, handler] as const;
    });

    child.on("error", (error) => {
      cleanupHandlers();
      reject(error);
    });

    child.on("exit", (code, signal) => {
      cleanupHandlers();

      if (signal) {
        resolve(1);
        return;
      }

      resolve(code ?? 0);
    });

    function cleanupHandlers(): void {
      for (const [signal, handler] of handlers) {
        process.off(signal, handler);
      }
    }
  });
}
