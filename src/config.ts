import path from "node:path";

import type { CacheStore } from "./cache.ts";
import {
  GLOBAL_CONFIG_VERSION,
  LEGACY_CONFIG_FILE_NAME,
  PROJECT_CONFIG_FILE_NAMES,
  PROJECT_CONFIG_VERSION,
  RESERVED_COMMANDS,
} from "./constants.ts";
import { getGlobalConfigPath } from "./env-paths.ts";
import { parseToml, pathExists, readTextFile, walkUpDirectories } from "./fs.ts";
import type {
  EnvMap,
  GlobalConfig,
  ResolvedConfig,
  ResolvedProfile,
  RunConfigFile,
} from "./types.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertEnvMap(value: unknown, fieldName: string): EnvMap | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new Error(`${fieldName} must be a table of string, number, or boolean values.`);
  }

  const envEntries: EnvMap = {};

  for (const [key, entryValue] of Object.entries(value)) {
    if (
      typeof entryValue !== "string" &&
      typeof entryValue !== "number" &&
      typeof entryValue !== "boolean"
    ) {
      throw new Error(`${fieldName}.${key} must be a string, number, or boolean.`);
    }

    envEntries[key] = entryValue;
  }

  return envEntries;
}

function parseProjectConfig(rawText: string, sourcePath: string): RunConfigFile {
  let parsed: unknown;

  try {
    parsed = parseToml(rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${sourcePath}: ${message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`${sourcePath} must contain a TOML object.`);
  }

  const allowedProjectKeys = new Set([
    "version",
    "default_profile",
    "command",
    "cwd",
    "env",
    "profiles",
  ]);

  for (const key of Object.keys(parsed)) {
    if (!allowedProjectKeys.has(key)) {
      throw new Error(`${sourcePath} contains unknown configuration key "${key}".`);
    }
  }

  const version = parsed.version;

  if (version !== PROJECT_CONFIG_VERSION) {
    throw new Error(`${sourcePath} must set version = ${PROJECT_CONFIG_VERSION}.`);
  }

  const config: RunConfigFile = {
    version,
  };

  const defaultProfileValue = parsed.default_profile;

  if (defaultProfileValue !== undefined) {
    if (typeof defaultProfileValue !== "string" || defaultProfileValue.trim() === "") {
      throw new Error(`${sourcePath} default_profile must be a non-empty string.`);
    }

    config.defaultProfile = defaultProfileValue;
  }

  if (parsed.command !== undefined) {
    if (typeof parsed.command !== "string" || parsed.command.trim() === "") {
      throw new Error(`${sourcePath} command must be a non-empty string.`);
    }

    config.command = parsed.command;
  }

  if (parsed.cwd !== undefined) {
    if (typeof parsed.cwd !== "string" || parsed.cwd.trim() === "") {
      throw new Error(`${sourcePath} cwd must be a non-empty string.`);
    }

    config.cwd = parsed.cwd;
  }

  config.env = assertEnvMap(parsed.env, "env");

  if (parsed.profiles !== undefined) {
    if (!isPlainObject(parsed.profiles)) {
      throw new Error(`${sourcePath} profiles must be a TOML table.`);
    }

    config.profiles = {};

    for (const [profileName, profileValue] of Object.entries(parsed.profiles)) {
      if (RESERVED_COMMANDS.has(profileName)) {
        throw new Error(`${sourcePath} profile name "${profileName}" is reserved.`);
      }

      if (!isPlainObject(profileValue)) {
        throw new Error(`${sourcePath} profiles.${profileName} must be a TOML table.`);
      }

      const allowedProfileKeys = new Set(["command", "cwd", "env", "description", "alias"]);

      for (const key of Object.keys(profileValue)) {
        if (!allowedProfileKeys.has(key)) {
          throw new Error(
            `${sourcePath} profiles.${profileName} contains unknown profile key "${key}".`,
          );
        }
      }

      const profile: {
        command?: string;
        cwd?: string;
        env?: EnvMap;
        description?: string;
        alias?: string | string[];
      } = {};

      if (profileValue.command !== undefined) {
        if (typeof profileValue.command !== "string" || profileValue.command.trim() === "") {
          throw new Error(
            `${sourcePath} profiles.${profileName}.command must be a non-empty string.`,
          );
        }

        profile.command = profileValue.command;
      }

      if (profileValue.cwd !== undefined) {
        if (typeof profileValue.cwd !== "string" || profileValue.cwd.trim() === "") {
          throw new Error(`${sourcePath} profiles.${profileName}.cwd must be a non-empty string.`);
        }

        profile.cwd = profileValue.cwd;
      }

      if (profileValue.description !== undefined) {
        if (
          typeof profileValue.description !== "string" ||
          profileValue.description.trim() === ""
        ) {
          throw new Error(
            `${sourcePath} profiles.${profileName}.description must be a non-empty string.`,
          );
        }

        profile.description = profileValue.description;
      }

      if (profileValue.alias !== undefined) {
        if (typeof profileValue.alias === "string") {
          if (profileValue.alias.trim() === "") {
            throw new Error(
              `${sourcePath} profiles.${profileName}.alias must be a non-empty string.`,
            );
          }
          profile.alias = profileValue.alias;
        } else if (Array.isArray(profileValue.alias)) {
          const list: string[] = [];
          for (const item of profileValue.alias) {
            if (typeof item !== "string" || item.trim() === "") {
              throw new Error(
                `${sourcePath} profiles.${profileName}.alias array must contain only non-empty strings.`,
              );
            }
            list.push(item);
          }
          profile.alias = list;
        } else {
          throw new Error(
            `${sourcePath} profiles.${profileName}.alias must be a string or an array of strings.`,
          );
        }
      }

      profile.env = assertEnvMap(profileValue.env, `profiles.${profileName}.env`);
      config.profiles[profileName] = profile;
    }
  }

  if (config.defaultProfile) {
    if (config.defaultProfile === "default" && config.command) {
      // allow legacy command-only default
    } else if (!config.profiles?.[config.defaultProfile]) {
      throw new Error(
        `${sourcePath} default_profile "${config.defaultProfile}" must exist in profiles.`,
      );
    }
  }

  if (config.command === undefined && Object.keys(config.profiles ?? {}).length === 0) {
    throw new Error(`${sourcePath} must define command or at least one profile.`);
  }

  return config;
}

export async function readGlobalConfig(): Promise<GlobalConfig> {
  const configPath = getGlobalConfigPath();

  if (!(await pathExists(configPath))) {
    return {
      version: GLOBAL_CONFIG_VERSION,
      cache: true,
      detection: "suggest",
    };
  }

  const parsed = parseToml(await readTextFile(configPath));

  if (!isPlainObject(parsed)) {
    throw new Error(`${configPath} must contain a TOML object.`);
  }

  const allowedGlobalKeys = new Set(["version", "shell", "editor", "cache", "detection"]);

  for (const key of Object.keys(parsed)) {
    if (!allowedGlobalKeys.has(key)) {
      throw new Error(`${configPath} contains unknown configuration key "${key}".`);
    }
  }

  if (
    parsed.version !== undefined &&
    (typeof parsed.version !== "number" || parsed.version !== GLOBAL_CONFIG_VERSION)
  ) {
    throw new Error(`${configPath} version must be ${GLOBAL_CONFIG_VERSION}.`);
  }

  if (parsed.shell !== undefined && typeof parsed.shell !== "string") {
    throw new Error(`${configPath} shell must be a string.`);
  }

  if (parsed.editor !== undefined && typeof parsed.editor !== "string") {
    throw new Error(`${configPath} editor must be a string.`);
  }

  if (parsed.cache !== undefined && typeof parsed.cache !== "boolean") {
    throw new Error(`${configPath} cache must be a boolean.`);
  }

  if (parsed.detection !== undefined && parsed.detection !== "suggest") {
    throw new Error(`${configPath} detection currently only supports "suggest".`);
  }

  return {
    version: typeof parsed.version === "number" ? parsed.version : GLOBAL_CONFIG_VERSION,
    shell: typeof parsed.shell === "string" ? parsed.shell : undefined,
    editor: typeof parsed.editor === "string" ? parsed.editor : undefined,
    cache: typeof parsed.cache === "boolean" ? parsed.cache : true,
    detection: "suggest",
  };
}

async function parseConfigAt(sourcePath: string): Promise<ResolvedConfig> {
  const config = parseProjectConfig(await readTextFile(sourcePath), sourcePath);
  const configDir = path.dirname(sourcePath);

  return {
    config,
    sourcePath,
    configDir,
    cacheHit: false,
    isLegacyPath: path.basename(sourcePath) === LEGACY_CONFIG_FILE_NAME,
  };
}

export async function resolveProjectConfig(options: {
  cwd: string;
  explicitConfigPath?: string;
  useCache: boolean;
  cacheStore: CacheStore;
}): Promise<ResolvedConfig | null> {
  const { cacheStore, cwd, explicitConfigPath, useCache } = options;
  const walkedDirectories = walkUpDirectories(cwd);

  if (explicitConfigPath) {
    const resolvedPath = path.resolve(cwd, explicitConfigPath);

    if (!(await pathExists(resolvedPath))) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }

    return await parseConfigAt(resolvedPath);
  }

  if (useCache) {
    const cachedConfig = await cacheStore.getConfigLookup(cwd);

    if (cachedConfig) {
      const cachedDirectory = path.dirname(cachedConfig.configPath);
      let shouldUseCache = true;

      for (const directory of walkedDirectories) {
        if (directory === cachedDirectory) {
          break;
        }

        if (await findConfigPath(directory)) {
          shouldUseCache = false;
          break;
        }
      }

      if (shouldUseCache) {
        const parsed = await parseConfigAt(cachedConfig.configPath);
        parsed.cacheHit = true;
        return parsed;
      }
    }
  }

  for (const directory of walkedDirectories) {
    const candidatePath = await findConfigPath(directory);

    if (!candidatePath) {
      continue;
    }

    const parsed = await parseConfigAt(candidatePath);

    if (useCache) {
      await cacheStore.setConfigLookup(cwd, candidatePath);
    }

    return parsed;
  }

  return null;
}

async function findConfigPath(directory: string): Promise<string | null> {
  for (const fileName of PROJECT_CONFIG_FILE_NAMES) {
    const candidatePath = path.join(directory, fileName);

    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

export function resolveProfile(
  resolvedConfig: ResolvedConfig,
  profileName: string | undefined,
  overrideCwd?: string,
): ResolvedProfile {
  const { config, configDir, sourcePath } = resolvedConfig;
  let selectedName = profileName ?? config.defaultProfile ?? "default";

  if (profileName && config.profiles && !config.profiles[selectedName]) {
    for (const [key, profile] of Object.entries(config.profiles)) {
      if (profile.alias) {
        const aliases = Array.isArray(profile.alias) ? profile.alias : [profile.alias];
        if (aliases.includes(profileName)) {
          selectedName = key;
          break;
        }
      }
    }
  }

  const profileEntry = config.profiles?.[selectedName];

  if (!profileEntry?.command && !(selectedName === "default" && config.command)) {
    throw new Error(`Profile "${selectedName}" is not defined in ${sourcePath}.`);
  }

  const command = profileEntry?.command ?? config.command;

  if (!command) {
    throw new Error(`No command is defined for profile "${selectedName}" in ${sourcePath}.`);
  }

  const relativeCwd = overrideCwd ?? profileEntry?.cwd ?? config.cwd ?? ".";
  const mergedEnv = {
    ...(config.env ?? {}),
    ...(profileEntry?.env ?? {}),
  };

  return {
    name: selectedName,
    command,
    cwd: path.resolve(configDir, relativeCwd),
    env: Object.fromEntries(Object.entries(mergedEnv).map(([key, value]) => [key, String(value)])),
    sourcePath,
    configDir,
    description: profileEntry?.description,
  };
}

export function renderProjectConfig(config: RunConfigFile): string {
  const lines: string[] = [`version = ${PROJECT_CONFIG_VERSION}`];

  if (config.command) {
    lines.push(`command = ${toTomlString(config.command)}`);
  }

  if (config.defaultProfile) {
    lines.push(`default_profile = ${toTomlString(config.defaultProfile)}`);
  }

  if (config.cwd) {
    lines.push(`cwd = ${toTomlString(config.cwd)}`);
  }

  if (config.env && Object.keys(config.env).length > 0) {
    lines.push("");
    lines.push("[env]");

    for (const [key, value] of Object.entries(config.env)) {
      lines.push(`${key} = ${toTomlValue(value)}`);
    }
  }

  if (config.profiles) {
    for (const [profileName, profile] of Object.entries(config.profiles)) {
      lines.push("");
      lines.push(`[profiles.${profileName}]`);

      if (profile.command) {
        lines.push(`command = ${toTomlString(profile.command)}`);
      }

      if (profile.cwd) {
        lines.push(`cwd = ${toTomlString(profile.cwd)}`);
      }

      if (profile.description) {
        lines.push(`description = ${toTomlString(profile.description)}`);
      }

      if (profile.alias) {
        if (Array.isArray(profile.alias)) {
          const list = profile.alias.map(toTomlString).join(", ");
          lines.push(`alias = [${list}]`);
        } else {
          lines.push(`alias = ${toTomlString(profile.alias)}`);
        }
      }

      if (profile.env && Object.keys(profile.env).length > 0) {
        lines.push(`[profiles.${profileName}.env]`);

        for (const [key, value] of Object.entries(profile.env)) {
          lines.push(`${key} = ${toTomlValue(value)}`);
        }
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function listProfiles(config: RunConfigFile): Array<{
  name: string;
  command: string;
  description?: string;
  alias?: string | string[];
  isDefault: boolean;
}> {
  const profiles = new Map<
    string,
    {
      name: string;
      command: string;
      description?: string;
      alias?: string | string[];
      isDefault: boolean;
    }
  >();

  // Top-level command is a shorthand for profiles.default
  if (config.command) {
    profiles.set("default", {
      name: "default",
      command: config.command,
      description: undefined,
      alias: undefined,
      isDefault: !config.defaultProfile || config.defaultProfile === "default",
    });
  }

  // Profile entries override or supplement the default
  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    if (!profile.command) {
      continue;
    }

    const _existingIsDefault = profiles.get("default")?.isDefault ?? false;
    profiles.set(name, {
      name,
      command: profile.command,
      description: profile.description,
      alias: profile.alias,
      isDefault: config.defaultProfile ? config.defaultProfile === name : name === "default",
    });

    // If a profile named "default" exists, it takes over as the default
    if (name === "default") {
      const entry = profiles.get("default");
      if (entry) {
        entry.isDefault = true;
      }
    }
  }

  return [...profiles.values()].sort((left, right) => {
    if (left.isDefault && !right.isDefault) {
      return -1;
    }

    if (!left.isDefault && right.isDefault) {
      return 1;
    }

    return left.name.localeCompare(right.name);
  });
}

/**
 * Pattern for valid shortcut suffixes. Must be alphanumeric + dash/underscore,
 * starting with a letter or digit, max 60 chars (leaving room for "run" prefix).
 * This is validated both here and in the shell hook script for defence-in-depth.
 */
const SHORTCUT_SUFFIX_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/;

/**
 * Compute every shell function name that the shell hook should register for the
 * current project config. Returns names like "rund", "run-d", "rundev", "run-dev".
 *
 * Rules:
 * - Every profile name that is not "default" becomes run<name> and run-<name>
 * - Every alias on a profile becomes run<alias> and run-<alias>
 * - Names colliding with RESERVED_COMMANDS are silently skipped
 * - Suffixes not matching SHORTCUT_SUFFIX_RE are silently skipped
 * - Results are deduplicated and sorted
 */
export function listShortcutNames(config: RunConfigFile): string[] {
  const suffixes = new Set<string>();

  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    if (!profile.command) continue;

    // Profile name itself is an implicit suffix (except "default" which is too
    // generic to be a useful command name)
    if (name !== "default" && SHORTCUT_SUFFIX_RE.test(name)) {
      suffixes.add(name);
    }

    // Declared aliases
    if (profile.alias) {
      const aliases = Array.isArray(profile.alias) ? profile.alias : [profile.alias];
      for (const alias of aliases) {
        if (typeof alias === "string" && SHORTCUT_SUFFIX_RE.test(alias)) {
          suffixes.add(alias);
        }
      }
    }
  }

  const names: string[] = [];

  for (const suffix of suffixes) {
    // Skip suffixes that would produce names shadowing reserved commands
    if (RESERVED_COMMANDS.has(suffix)) continue;

    // Both dash-separated and concatenated forms
    const dashForm = `run-${suffix}`;
    const concatForm = `run${suffix}`;

    names.push(dashForm, concatForm);
  }

  return [...new Set(names)].sort();
}

export function renderGlobalConfig(config: Partial<GlobalConfig>): string {
  const lines = [`version = ${GLOBAL_CONFIG_VERSION}`];

  if (config.shell) {
    lines.push(`shell = ${toTomlString(config.shell)}`);
  }

  if (config.editor) {
    lines.push(`editor = ${toTomlString(config.editor)}`);
  }

  if (typeof config.cache === "boolean") {
    lines.push(`cache = ${String(config.cache)}`);
  }

  lines.push('detection = "suggest"');
  return `${lines.join("\n")}\n`;
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

function toTomlValue(value: string | number | boolean): string {
  return typeof value === "string" ? toTomlString(value) : String(value);
}
