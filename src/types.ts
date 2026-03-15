export type PrimitiveEnvValue = string | number | boolean;
export type EnvMap = Record<string, PrimitiveEnvValue>;

export interface ProfileConfig {
  command: string;
  cwd?: string;
  env?: EnvMap;
  description?: string;
}

export interface RunConfigFile {
  version: number;
  command?: string;
  cwd?: string;
  env?: EnvMap;
  defaultProfile?: string;
  profiles?: Record<string, Partial<ProfileConfig>>;
}

export interface ResolvedProfile {
  name: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  sourcePath: string;
  configDir: string;
  description?: string;
}

export interface ResolvedCommand {
  command: string;
  args: string[];
  shellCommand: string;
}

export interface GlobalConfig {
  version: number;
  shell?: string;
  editor?: string;
  cache: boolean;
  detection: "suggest";
}

export interface ResolvedConfig {
  config: RunConfigFile;
  sourcePath: string;
  configDir: string;
  cacheHit: boolean;
  isLegacyPath: boolean;
}

export interface DetectionSuggestion {
  kind: "default" | "profile";
  name: string;
  command: string;
  reason: string;
  ecosystem: "javascript" | "python" | "go" | "rust" | "make" | "generic";
  confidence: "high" | "medium" | "low";
}

export interface DetectedProject {
  root: string;
  markers: string[];
  suggestions: DetectionSuggestion[];
  cacheHit: boolean;
}

export interface CacheFile {
  version: number;
  configLookups: Record<
    string,
    {
      configPath: string;
      configFingerprint: string;
    }
  >;
  detections: Record<
    string,
    {
      fingerprints: Record<string, string>;
      markers: string[];
      suggestions: DetectionSuggestion[];
    }
  >;
}

export type ManagedProcessStatus = "running" | "stopped" | "exited";

export interface ManagedProcessRecord {
  id: string;
  name: string;
  projectName: string;
  projectRoot: string;
  configPath: string;
  profile: string;
  baseCommand: string;
  commandArgs: string[];
  command: string;
  cwd: string;
  pid: number;
  shell: string;
  env: Record<string, string>;
  status: ManagedProcessStatus;
  logPath: string;
  startedAt: string;
  stoppedAt?: string;
  updatedAt: string;
  restartCount: number;
  lastExitCode?: number;
  lastSignal?: NodeJS.Signals;
}

export interface ManagedProcessRegistryFile {
  version: number;
  processes: ManagedProcessRecord[];
}

export interface ManagedProcessSnapshot extends ManagedProcessRecord {
  uptimeMs: number;
  memoryRssKb: number | null;
  ports: number[];
}
