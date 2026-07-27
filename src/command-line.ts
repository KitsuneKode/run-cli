import { blue, bold, dim, green } from "./output.ts";
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
  return `${bold(blue("run"))} ${dim("->")} ${commandLine.shellCommand}`;
}

export function renderVerboseBanner(input: {
  profile: ResolvedProfile;
  commandLine: ResolvedCommand;
  cacheHit: boolean;
}): string {
  const cacheIndicator = input.cacheHit ? ` ${dim("(cached)")}` : "";
  return [
    renderMinimalBanner(input.commandLine),
    `  ${dim("profile=")}${input.profile.name}  ${dim("cwd=")}${input.profile.cwd}  ${dim("config=")}${input.profile.sourcePath}${cacheIndicator}`,
  ].join("\n");
}

export function renderProcessBanner(processRecord: {
  name: string;
  command: string;
  logPath: string;
}): string {
  return [
    `${bold(blue("run"))} ${green("started")} ${processRecord.name}`,
    `  ${dim("command:")} ${processRecord.command}`,
    `  ${dim("log:")} ${processRecord.logPath}`,
  ].join("\n");
}
