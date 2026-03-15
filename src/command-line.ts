import { blue, bold, dim } from "./output.ts";
import type { ResolvedCommand, ResolvedProfile } from "./types.ts";

function shellQuote(value: string): string {
  if (value === "") {
    return "''";
  }

  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function resolveCommandLine(
  profile: Pick<ResolvedProfile, "command">,
  args: string[],
): ResolvedCommand {
  const normalizedArgs = args.filter((arg) => arg.length > 0);
  const shellCommand = [profile.command, ...normalizedArgs.map(shellQuote)].join(" ");

  return {
    command: profile.command,
    args: normalizedArgs,
    shellCommand,
  };
}

export function renderMinimalBanner(commandLine: ResolvedCommand): string {
  return `${bold(blue("run"))} ${dim("//")} ${commandLine.shellCommand}`;
}

export function renderVerboseBanner(input: {
  profile: ResolvedProfile;
  commandLine: ResolvedCommand;
  cacheHit: boolean;
}): string {
  return [
    renderMinimalBanner(input.commandLine),
    `  profile=${input.profile.name} cwd=${input.profile.cwd} config=${input.profile.sourcePath}${input.cacheHit ? " cache" : ""}`,
  ].join("\n");
}
