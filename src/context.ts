import path from "node:path";
import { CacheStore } from "./cache.ts";
import { readGlobalConfig, resolveProjectConfig } from "./config.ts";
import type { GlobalConfig, ResolvedConfig } from "./types.ts";

export class WorkspaceContext {
  public readonly cwd: string;
  public readonly explicitConfigPath?: string;
  public readonly noCache: boolean;

  private _cacheStore?: CacheStore;
  private _globalConfig?: GlobalConfig;
  private _projectConfig: ResolvedConfig | null = null;
  private _projectConfigResolved = false;

  constructor(options: { cwd: string; explicitConfigPath?: string; noCache?: boolean }) {
    this.cwd = path.resolve(options.cwd);
    this.explicitConfigPath = options.explicitConfigPath;
    this.noCache = options.noCache ?? false;
  }

  public get cacheStore(): CacheStore {
    if (!this._cacheStore) {
      this._cacheStore = new CacheStore();
    }
    return this._cacheStore;
  }

  public async getGlobalConfig(): Promise<GlobalConfig> {
    if (!this._globalConfig) {
      this._globalConfig = await readGlobalConfig();
    }
    return this._globalConfig;
  }

  public async useCache(): Promise<boolean> {
    if (this.noCache) {
      return false;
    }
    const globalConfig = await this.getGlobalConfig();
    return globalConfig.cache;
  }

  public async getProjectConfig(): Promise<ResolvedConfig | null> {
    if (!this._projectConfigResolved) {
      const useCache = await this.useCache();
      this._projectConfig = await resolveProjectConfig({
        cwd: this.cwd,
        explicitConfigPath: this.explicitConfigPath,
        useCache,
        cacheStore: this.cacheStore,
      });
      this._projectConfigResolved = true;
    }
    return this._projectConfig;
  }

  public async saveCacheIfNeeded(): Promise<void> {
    if (this._cacheStore && (await this.useCache())) {
      await this._cacheStore.save();
    }
  }
}
