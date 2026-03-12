import os from "node:os";
import path from "node:path";

import {
  CACHE_FILE_RELATIVE_PATH,
  GLOBAL_CONFIG_RELATIVE_PATH,
  PROCESS_LOGS_RELATIVE_PATH,
  PROCESS_REGISTRY_RELATIVE_PATH,
  STATE_DIR_RELATIVE_PATH,
} from "./constants.ts";

export function getGlobalConfigPath(): string {
  const baseDir = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(baseDir, GLOBAL_CONFIG_RELATIVE_PATH);
}

export function getCacheFilePath(): string {
  const baseDir = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(baseDir, CACHE_FILE_RELATIVE_PATH);
}

export function getStateDirPath(): string {
  const baseDir = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(baseDir, STATE_DIR_RELATIVE_PATH);
}

export function getProcessRegistryPath(): string {
  const baseDir = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(baseDir, PROCESS_REGISTRY_RELATIVE_PATH);
}

export function getProcessLogsDirPath(): string {
  const baseDir = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(baseDir, PROCESS_LOGS_RELATIVE_PATH);
}
