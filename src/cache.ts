import path from "node:path";

import { CACHE_VERSION } from "./constants.ts";
import { getCacheFilePath } from "./env-paths.ts";
import { pathExists, readTextFile, statFingerprint, writeTextFile } from "./fs.ts";
import type { CacheFile, DetectionSuggestion } from "./types.ts";

function createEmptyCache(): CacheFile {
  return {
    version: CACHE_VERSION,
    configLookups: {},
    detections: {},
  };
}

export class CacheStore {
  readonly filePath: string;
  private cacheData: CacheFile | null = null;

  constructor(filePath = getCacheFilePath()) {
    this.filePath = filePath;
  }

  private async load(): Promise<CacheFile> {
    if (this.cacheData) {
      return this.cacheData;
    }

    if (!(await pathExists(this.filePath))) {
      this.cacheData = createEmptyCache();
      return this.cacheData;
    }

    try {
      const parsed = JSON.parse(await readTextFile(this.filePath)) as CacheFile;

      if (parsed.version !== CACHE_VERSION) {
        this.cacheData = createEmptyCache();
      } else {
        this.cacheData = parsed;
      }
    } catch {
      this.cacheData = createEmptyCache();
    }

    return this.cacheData;
  }

  async save(): Promise<void> {
    const cacheData = await this.load();
    await writeTextFile(this.filePath, `${JSON.stringify(cacheData, null, 2)}\n`);
  }

  async getConfigLookup(cwd: string): Promise<{ configPath: string; cacheHit: boolean } | null> {
    const cacheData = await this.load();
    const entry = cacheData.configLookups[path.resolve(cwd)];

    if (!entry) {
      return null;
    }

    const fingerprint = await statFingerprint(entry.configPath);

    if (fingerprint === null || fingerprint !== entry.configFingerprint) {
      delete cacheData.configLookups[path.resolve(cwd)];
      return null;
    }

    return {
      configPath: entry.configPath,
      cacheHit: true,
    };
  }

  async setConfigLookup(cwd: string, configPath: string): Promise<void> {
    const cacheData = await this.load();
    const fingerprint = await statFingerprint(configPath);

    if (fingerprint === null) {
      return;
    }

    cacheData.configLookups[path.resolve(cwd)] = {
      configPath,
      configFingerprint: fingerprint,
    };
  }

  async getDetection(
    projectRoot: string,
    fingerprints: Record<string, string>,
  ): Promise<{ markers: string[]; suggestions: DetectionSuggestion[]; cacheHit: boolean } | null> {
    const cacheData = await this.load();
    const entry = cacheData.detections[path.resolve(projectRoot)];

    if (!entry) {
      return null;
    }

    const keys = new Set([...Object.keys(entry.fingerprints), ...Object.keys(fingerprints)]);

    for (const key of keys) {
      if (entry.fingerprints[key] !== fingerprints[key]) {
        delete cacheData.detections[path.resolve(projectRoot)];
        return null;
      }
    }

    return {
      markers: entry.markers,
      suggestions: entry.suggestions,
      cacheHit: true,
    };
  }

  async setDetection(
    projectRoot: string,
    fingerprints: Record<string, string>,
    markers: string[],
    suggestions: DetectionSuggestion[],
  ): Promise<void> {
    const cacheData = await this.load();
    cacheData.detections[path.resolve(projectRoot)] = {
      fingerprints,
      markers,
      suggestions,
    };
  }
}
