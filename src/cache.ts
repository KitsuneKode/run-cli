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

    const lookupKeys = Object.keys(cacheData.configLookups);
    if (lookupKeys.length > 500) {
      const keysToDelete = lookupKeys.slice(0, lookupKeys.length - 500);
      for (const key of keysToDelete) {
        if (key !== undefined) {
          delete cacheData.configLookups[key];
        }
      }
    }

    const detectionKeys = Object.keys(cacheData.detections);
    if (detectionKeys.length > 500) {
      const keysToDelete = detectionKeys.slice(0, detectionKeys.length - 500);
      for (const key of keysToDelete) {
        if (key !== undefined) {
          delete cacheData.detections[key];
        }
      }
    }

    await writeTextFile(this.filePath, `${JSON.stringify(cacheData, null, 2)}\n`);
  }

  async getConfigLookup(cwd: string): Promise<{ configPath: string; cacheHit: boolean } | null> {
    const cacheData = await this.load();
    const resolvedCwd = path.resolve(cwd);
    const entry = cacheData.configLookups[resolvedCwd];

    if (!entry) {
      return null;
    }

    const fingerprint = await statFingerprint(entry.configPath);

    if (fingerprint === null || fingerprint !== entry.configFingerprint) {
      delete cacheData.configLookups[resolvedCwd];
      return null;
    }

    delete cacheData.configLookups[resolvedCwd];
    cacheData.configLookups[resolvedCwd] = entry;

    return {
      configPath: entry.configPath,
      cacheHit: true,
    };
  }

  async setConfigLookup(cwd: string, configPath: string): Promise<void> {
    const cacheData = await this.load();
    const resolvedCwd = path.resolve(cwd);
    const fingerprint = await statFingerprint(configPath);

    if (fingerprint === null) {
      return;
    }

    delete cacheData.configLookups[resolvedCwd];
    cacheData.configLookups[resolvedCwd] = {
      configPath,
      configFingerprint: fingerprint,
    };
  }

  async getDetection(
    projectRoot: string,
    fingerprints: Record<string, string>,
  ): Promise<{ markers: string[]; suggestions: DetectionSuggestion[]; cacheHit: boolean } | null> {
    const cacheData = await this.load();
    const resolvedRoot = path.resolve(projectRoot);
    const entry = cacheData.detections[resolvedRoot];

    if (!entry) {
      return null;
    }

    const keys = new Set([...Object.keys(entry.fingerprints), ...Object.keys(fingerprints)]);

    for (const key of keys) {
      if (entry.fingerprints[key] !== fingerprints[key]) {
        delete cacheData.detections[resolvedRoot];
        return null;
      }
    }

    delete cacheData.detections[resolvedRoot];
    cacheData.detections[resolvedRoot] = entry;

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
    const resolvedRoot = path.resolve(projectRoot);

    delete cacheData.detections[resolvedRoot];
    cacheData.detections[resolvedRoot] = {
      fingerprints,
      markers,
      suggestions,
    };
  }
}
