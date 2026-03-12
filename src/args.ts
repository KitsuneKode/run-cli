import { RESERVED_COMMANDS } from "./constants.ts";

export interface ParsedArgs {
  positionals: string[];
  configPath?: string;
  cwd?: string;
  dryRun: boolean;
  noCache: boolean;
  help: boolean;
  global: boolean;
  force: boolean;
  yes: boolean;
  command?: string;
  profiles: Array<{ name: string; command: string }>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    positionals: [],
    dryRun: false,
    noCache: false,
    help: false,
    global: false,
    force: false,
    yes: false,
    profiles: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case "--config":
        parsed.configPath = requireValue(argv, ++index, token);
        continue;
      case "--cwd":
        parsed.cwd = requireValue(argv, ++index, token);
        continue;
      case "--command":
        parsed.command = requireValue(argv, ++index, token);
        continue;
      case "--profile":
        parsed.profiles.push(parseProfileValue(requireValue(argv, ++index, token)));
        continue;
      case "--dry-run":
        parsed.dryRun = true;
        continue;
      case "--no-cache":
        parsed.noCache = true;
        continue;
      case "--global":
        parsed.global = true;
        continue;
      case "--force":
        parsed.force = true;
        continue;
      case "--yes":
        parsed.yes = true;
        continue;
      case "--help":
      case "-h":
        parsed.help = true;
        continue;
      default:
        parsed.positionals.push(token);
    }
  }

  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function parseProfileValue(rawValue: string): { name: string; command: string } {
  const [name, ...commandParts] = rawValue.split("=");
  const command = commandParts.join("=");

  if (!name || !command) {
    throw new Error(`Invalid profile "${rawValue}". Use --profile name=command.`);
  }

  if (RESERVED_COMMANDS.has(name)) {
    throw new Error(`Profile "${name}" is reserved.`);
  }

  return {
    name,
    command,
  };
}

export function isCommand(token: string | undefined): token is string {
  return typeof token === "string" && RESERVED_COMMANDS.has(token);
}
