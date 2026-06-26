import path from "node:path";
import type { FlagDefinition } from "./command.ts";
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
  invokedAs?: string;
  shellHook: boolean;
  shortcuts: boolean;
  install: boolean;
  check: boolean;
  revoke: boolean;
  list: boolean;
}

export const COMMAND_SCHEMAS: Record<
  string,
  {
    name: string;
    flags?: Record<string, FlagDefinition>;
    allowForwardedArgs?: boolean;
  }
> = {
  init: {
    name: "init",
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
  },
  config: {
    name: "config",
    flags: {
      global: { type: "boolean", description: "Operations apply to global configuration" },
    },
  },
  completion: {
    name: "completion",
    flags: {
      "shell-hook": { type: "boolean", description: "Output shell hook script" },
      install: {
        type: "boolean",
        description: "Automatically install the shell hook script to shell rc",
      },
    },
  },
  doctor: {
    name: "doctor",
    flags: {
      json: { type: "boolean", description: "Format output as JSON" },
    },
  },
  profiles: {
    name: "profiles",
    flags: {
      shortcuts: { type: "boolean", description: "Emit shortcut names for shell hook" },
      json: { type: "boolean", description: "Format output as JSON" },
    },
  },
  trust: {
    name: "trust",
    flags: {
      json: { type: "boolean", description: "Format output as JSON" },
      check: { type: "boolean", description: "Check if the current config is trusted" },
      revoke: { type: "boolean", description: "Revoke trust for the current config" },
      list: { type: "boolean", description: "List all trusted configs" },
    },
  },
  up: {
    name: "up",
    flags: {
      profile: { type: "string", short: "p", description: "Profile to run in the background" },
      name: { type: "string", description: "Override process display name" },
    },
    allowForwardedArgs: true,
  },
  ps: {
    name: "ps",
    flags: {
      json: { type: "boolean", description: "Format output as JSON" },
      details: { type: "boolean", description: "Include listening ports" },
      watch: { type: "boolean", short: "w", description: "Keep running and refreshing output" },
    },
  },
  dashboard: {
    name: "dashboard",
    flags: {
      watch: {
        type: "boolean",
        short: "w",
        description: "Keep running and refreshing dashboard",
      },
    },
  },
  inspect: {
    name: "inspect",
    flags: {
      json: { type: "boolean", description: "Format output as JSON" },
    },
  },
  logs: {
    name: "logs",
    flags: {
      follow: { type: "boolean", short: "f", description: "Stream log changes" },
      lines: { type: "number", description: "Number of trailing lines to show" },
    },
  },
  stop: {
    name: "stop",
  },
  kill: {
    name: "kill",
  },
  restart: {
    name: "restart",
  },
  prune: {
    name: "prune",
    flags: {
      "dry-run": { type: "boolean", description: "Only print what would be pruned" },
      json: { type: "boolean", description: "Format output as JSON" },
    },
  },
  ports: {
    name: "ports",
    flags: {
      json: { type: "boolean", description: "Format output as JSON" },
    },
  },
  run: {
    name: "run",
    flags: {
      profile: { type: "string", short: "p", description: "Profile to run" },
      "dry-run": { type: "boolean", description: "Print command instead of running" },
    },
    allowForwardedArgs: true,
  },
};

export function parseArgs(argv: string[]): ParsedArgs {
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
    shellHook: false,
    shortcuts: false,
    install: false,
    check: false,
    revoke: false,
    list: false,
  };

  // 1. Separate global/top-level flags
  const remaining: string[] = [];
  let idx = 0;
  while (idx < argv.length) {
    const token = argv[idx];
    if (token === undefined) {
      break;
    }
    if (token === "--") {
      parsed.passthrough = true;
      parsed.commandArgs.push(...argv.slice(idx + 1));
      break;
    }

    if (token === "--config") {
      parsed.configPath = requireValue(argv, ++idx, token);
      idx++;
    } else if (token === "--cwd") {
      parsed.cwd = requireValue(argv, ++idx, token);
      idx++;
    } else if (token === "--invoked-as") {
      parsed.invokedAs = requireValue(argv, ++idx, token);
      idx++;
    } else if (token === "--no-cache") {
      parsed.noCache = true;
      idx++;
    } else if (token === "--verbose" || token === "-v") {
      parsed.verbose = true;
      idx++;
    } else if (token === "--help" || token === "-h") {
      parsed.help = true;
      idx++;
    } else {
      remaining.push(token);
      idx++;
    }
  }

  // 2. Identify subcommand
  let subcommand: string | undefined;
  let commandTokens: string[] = [];

  if (remaining.length > 0) {
    const first = remaining[0];
    if (first && RESERVED_COMMANDS.has(first)) {
      subcommand = first;
      commandTokens = remaining.slice(1);
      parsed.positionals.push(first);
    } else {
      subcommand = undefined;
      commandTokens = remaining;
    }
  } else {
    subcommand = undefined;
    commandTokens = [];
  }

  // 3. Parse commandTokens using subcommand's schema
  const schemaName = subcommand || "run";
  const schema = COMMAND_SCHEMAS[schemaName] || COMMAND_SCHEMAS.run;
  if (!schema) {
    throw new Error(`Internal error: schema not found for ${schemaName}`);
  }

  let index = 0;
  while (index < commandTokens.length) {
    const token = commandTokens[index];
    if (token === undefined) {
      break;
    }
    if (token === "--") {
      parsed.passthrough = true;
      parsed.commandArgs.push(...commandTokens.slice(index + 1));
      break;
    }

    if (token.startsWith("-")) {
      // Find matching flag in schema
      let matchedName: string | undefined;
      let matchedDef: FlagDefinition | undefined;

      if (token.startsWith("--")) {
        const flagName = token.slice(2);
        if (schema.flags?.[flagName]) {
          matchedName = flagName;
          matchedDef = schema.flags[flagName];
        }
      } else {
        const short = token.slice(1);
        if (schema.flags) {
          for (const [name, def] of Object.entries(schema.flags)) {
            if (def.short === short) {
              matchedName = name;
              matchedDef = def;
              break;
            }
          }
        }
      }

      if (matchedName && matchedDef) {
        if (matchedDef.type === "boolean") {
          // Map to ParsedArgs properties
          mapFlagValue(parsed, schemaName, matchedName, true);
          index++;
        } else {
          const rawVal = requireValue(commandTokens, ++index, token);
          let parsedVal: string | number = rawVal;
          if (matchedDef.type === "number") {
            parsedVal = parseNumberValue(rawVal, token);
          }
          mapFlagValue(parsed, schemaName, matchedName, parsedVal);
          index++;
        }
      } else {
        if (schema.allowForwardedArgs) {
          parsed.commandArgs.push(token);
          index++;
        } else {
          throw new Error(`Unknown flag: ${token}`);
        }
      }
    } else {
      if (schema.allowForwardedArgs) {
        parsed.commandArgs.push(token);
      } else {
        parsed.positionals.push(token);
      }
      index++;
    }
  }

  // 4. Resolve default profile name suffix from binary name/invocation method if not explicitly specified
  if (!parsed.profileName) {
    let invokedName = parsed.invokedAs ?? process.env.RUN_INVOKED_AS;
    if (!invokedName && process.argv[1]) {
      invokedName = path.basename(process.argv[1]);
    }

    if (invokedName) {
      const match = invokedName.match(/^run-?([a-zA-Z0-9_-]+)$/);
      if (match) {
        const suffix = match[1];
        if (suffix && !RESERVED_COMMANDS.has(suffix) && suffix !== "js" && suffix !== "ts") {
          parsed.profileName = suffix;
        }
      }
    }
  }

  return parsed;
}

function mapFlagValue(
  parsed: ParsedArgs,
  cmdName: string,
  flagName: string,
  value: string | boolean | number,
) {
  if (cmdName === "init") {
    if (flagName === "command") parsed.command = value as string;
    else if (flagName === "default-profile") parsed.defaultProfile = value as string;
    else if (flagName === "add-profile") {
      parsed.addProfiles.push(parseProfileValue(value as string, "--add-profile"));
    } else if (flagName === "profile") {
      parsed.addProfiles.push(parseProfileValue(value as string, "--profile"));
      parsed.deprecatedInitProfileFlagUsed = true;
    } else if (flagName === "force") parsed.force = value as boolean;
    else if (flagName === "yes") parsed.yes = value as boolean;
  } else if (cmdName === "config") {
    if (flagName === "global") parsed.global = value as boolean;
  } else if (cmdName === "completion") {
    if (flagName === "shell-hook") parsed.shellHook = value as boolean;
    else if (flagName === "install") parsed.install = value as boolean;
  } else if (cmdName === "doctor") {
    if (flagName === "json") parsed.json = value as boolean;
  } else if (cmdName === "profiles") {
    if (flagName === "shortcuts") parsed.shortcuts = value as boolean;
    else if (flagName === "json") parsed.json = value as boolean;
  } else if (cmdName === "trust") {
    if (flagName === "json") parsed.json = value as boolean;
    else if (flagName === "check") parsed.check = value as boolean;
    else if (flagName === "revoke") parsed.revoke = value as boolean;
    else if (flagName === "list") parsed.list = value as boolean;
  } else if (cmdName === "up") {
    if (flagName === "profile") parsed.profileName = value as string;
    else if (flagName === "name") parsed.name = value as string;
  } else if (cmdName === "ps") {
    if (flagName === "json") parsed.json = value as boolean;
    else if (flagName === "details") parsed.details = value as boolean;
    else if (flagName === "watch") parsed.watch = value as boolean;
  } else if (cmdName === "dashboard") {
    if (flagName === "watch") parsed.watch = value as boolean;
  } else if (cmdName === "inspect") {
    if (flagName === "json") parsed.json = value as boolean;
  } else if (cmdName === "logs") {
    if (flagName === "follow") parsed.follow = value as boolean;
    else if (flagName === "lines") parsed.lines = value as number;
  } else if (cmdName === "prune") {
    if (flagName === "dry-run") parsed.dryRun = value as boolean;
    else if (flagName === "json") parsed.json = value as boolean;
  } else if (cmdName === "ports") {
    if (flagName === "json") parsed.json = value as boolean;
  } else if (cmdName === "run") {
    if (flagName === "profile") parsed.profileName = value as string;
    else if (flagName === "dry-run") parsed.dryRun = value as boolean;
  }
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
