export type PrimitiveEnvValue = string | number | boolean;
export type EnvMap = Record<string, PrimitiveEnvValue>;

export interface ProfileConfig {
  command: string;
  cwd?: string;
  env?: EnvMap;
}

export interface RunConfigFile {
  version: number;
  command?: string;
  cwd?: string;
  env?: EnvMap;
  profiles?: Record<string, Partial<ProfileConfig>>;
}

export interface ResolvedProfile {
  name: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  sourcePath: string;
  configDir: string;
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
