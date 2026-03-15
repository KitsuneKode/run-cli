import path from "node:path";

import type { CacheStore } from "./cache.ts";
import {
  CONFIG_FILE_NAME,
  GLOBAL_CONFIG_VERSION,
  LEGACY_CONFIG_FILE_NAME,
  PROJECT_CONFIG_FILE_NAMES,
  PROJECT_CONFIG_VERSION,
  RESERVED_COMMANDS,
} from "./constants.ts";
import { getGlobalConfigPath } from "./env-paths.ts";
import { pathExists, readTextFile, walkUpDirectories } from "./fs.ts";
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
    parsed = Bun.TOML.parse(rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${sourcePath}: ${message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`${sourcePath} must contain a TOML object.`);
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

      const profile: {
        command?: string;
        cwd?: string;
        env?: EnvMap;
        description?: string;
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

  const parsed = Bun.TOML.parse(await readTextFile(configPath));

  if (!isPlainObject(parsed)) {
    throw new Error(`${configPath} must contain a TOML object.`);
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
      const parsed = await parseConfigAt(cachedConfig.configPath);
      parsed.cacheHit = true;
      return parsed;
    }
  }

  for (const directory of walkUpDirectories(cwd)) {
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
  const selectedName =
    profileName ?? config.defaultProfile ?? (config.profiles?.default ? "default" : "default");
  const profileDefaults = {
    command: config.command,
    cwd: config.cwd,
    env: config.env ?? {},
    description: undefined,
  };
  const profileOverride =
    selectedName === "default" && !profileName && !config.profiles?.default
      ? undefined
      : config.profiles?.[selectedName];

  if (
    (profileName || config.defaultProfile) &&
    !profileOverride &&
    !(selectedName === "default" && config.command)
  ) {
    throw new Error(`Profile "${selectedName}" is not defined in ${sourcePath}.`);
  }

  const command = profileOverride?.command ?? profileDefaults.command;

  if (!command) {
    throw new Error(`No command is defined for profile "${selectedName}" in ${sourcePath}.`);
  }

  const relativeCwd = overrideCwd ?? profileOverride?.cwd ?? profileDefaults.cwd ?? ".";
  const mergedEnv = {
    ...(profileDefaults.env ?? {}),
    ...(profileOverride?.env ?? {}),
  };

  return {
    name: selectedName,
    command,
    cwd: path.resolve(configDir, relativeCwd),
    env: Object.fromEntries(Object.entries(mergedEnv).map(([key, value]) => [key, String(value)])),
    sourcePath,
    configDir,
    description: profileOverride?.description,
  };
}

export function renderProjectConfig(config: RunConfigFile): string {
  const lines: string[] = [`version = ${PROJECT_CONFIG_VERSION}`];

  if (config.defaultProfile) {
    lines.push(`default_profile = ${toTomlString(config.defaultProfile)}`);
  }

  if (config.command) {
    lines.push(`command = ${toTomlString(config.command)}`);
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
  isDefault: boolean;
}> {
  const profiles = new Map<
    string,
    {
      name: string;
      command: string;
      description?: string;
      isDefault: boolean;
    }
  >();

  if (config.command) {
    profiles.set("default", {
      name: "default",
      command: config.command,
      isDefault: !config.defaultProfile || config.defaultProfile === "default",
    });
  }

  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    const command = profile.command ?? (name === "default" ? config.command : undefined);

    if (!command) {
      continue;
    }

    profiles.set(name, {
      name,
      command,
      description: profile.description,
      isDefault: config.defaultProfile ? config.defaultProfile === name : name === "default",
    });
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
