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
  defaultProfile?: string;
  name?: string;
  json: boolean;
  details: boolean;
  follow: boolean;
  watch: boolean;
  lines?: number;
  addProfiles: Array<{ name: string; command: string }>;
  profileName?: string;
  commandArgs: string[];
  verbose: boolean;
  passthrough: boolean;
  deprecatedInitProfileFlagUsed: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const firstToken = argv[0];
  const defaultMode = !firstToken || !RESERVED_COMMANDS.has(firstToken);
  const subcommand = defaultMode ? undefined : firstToken;
  const parsed: ParsedArgs = {
    positionals: [],
    dryRun: false,
    noCache: false,
    help: false,
    global: false,
    force: false,
    yes: false,
    json: false,
    details: false,
    follow: false,
    watch: false,
    addProfiles: [],
    commandArgs: [],
    verbose: false,
    passthrough: false,
    deprecatedInitProfileFlagUsed: false,
  };

  const isInit = subcommand === "init";
  const isUp = subcommand === "up";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === undefined) {
      break;
    }

    if (token === "--") {
      parsed.passthrough = true;
      parsed.commandArgs.push(...argv.slice(index + 1));
      break;
    }

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
      case "--default-profile":
        parsed.defaultProfile = requireValue(argv, ++index, token);
        continue;
      case "--add-profile":
        parsed.addProfiles.push(parseProfileValue(requireValue(argv, ++index, token), token));
        continue;
      case "--profile": {
        const value = requireValue(argv, ++index, token);

        if (isInit && value.includes("=")) {
          parsed.addProfiles.push(parseProfileValue(value, token));
          parsed.deprecatedInitProfileFlagUsed = true;
          continue;
        }

        parsed.profileName = value;
        continue;
      }
      case "-p":
        parsed.profileName = requireValue(argv, ++index, token);
        continue;
      case "--name":
        parsed.name = requireValue(argv, ++index, token);
        continue;
      case "--lines":
        parsed.lines = parseNumberValue(requireValue(argv, ++index, token), token);
        continue;
      case "--dry-run":
        parsed.dryRun = true;
        continue;
      case "--no-cache":
        parsed.noCache = true;
        continue;
      case "--json":
      case "-j":
        parsed.json = true;
        continue;
      case "--details":
        parsed.details = true;
        continue;
      case "--follow":
      case "-f":
        parsed.follow = true;
        continue;
      case "--watch":
      case "-w":
        parsed.watch = true;
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
      case "--verbose":
      case "-v":
        parsed.verbose = true;
        continue;
      case "--help":
      case "-h":
        parsed.help = true;
        continue;
      default:
        if (defaultMode && index === 0 && RESERVED_COMMANDS.has(token)) {
          parsed.positionals.push(token);
          continue;
        }

        if (defaultMode) {
          parsed.commandArgs.push(token);
          continue;
        }

        if (isUp && index > 0) {
          parsed.commandArgs.push(token);
          continue;
        }

        parsed.positionals.push(token);
    }
  }

  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];

  if (!value || value === "--") {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function parseNumberValue(rawValue: string, flag: string): number {
  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${flag} requires a non-negative integer.`);
  }

  return parsedValue;
}

function parseProfileValue(rawValue: string, flag: string): { name: string; command: string } {
  const [name, ...commandParts] = rawValue.split("=");
  const command = commandParts.join("=");

  if (!name || !command) {
    throw new Error(`Invalid profile "${rawValue}". Use ${flag} name=command.`);
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
