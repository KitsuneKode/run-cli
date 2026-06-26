export const CONFIG_FILE_NAME = ".run.toml";
export const LEGACY_CONFIG_FILE_NAME = ".run.config.toml";
export const PROJECT_CONFIG_FILE_NAMES = [CONFIG_FILE_NAME, LEGACY_CONFIG_FILE_NAME] as const;
export const GLOBAL_CONFIG_RELATIVE_PATH = "run/config.toml";
export const CACHE_FILE_RELATIVE_PATH = "run/cache.json";
export const STATE_DIR_RELATIVE_PATH = "run";
export const PROCESS_REGISTRY_RELATIVE_PATH = "run/processes.json";
export const PROCESS_LOGS_RELATIVE_PATH = "run/logs";
export const TRUST_REGISTRY_RELATIVE_PATH = "run/trusted-configs.json";
export const CACHE_VERSION = 1;
export const TRUST_REGISTRY_VERSION = 1;
export const GLOBAL_CONFIG_VERSION = 1;
export const PROJECT_CONFIG_VERSION = 1;
export const PROCESS_REGISTRY_VERSION = 1;
export const FALLBACK_SHELL = "/bin/sh";

class LazyReservedCommandsSet extends Set<string> {
  private _initialized = false;

  private _init() {
    if (this._initialized) return;
    this._initialized = true;
    const { commands } = require("./commands/index.ts");
    for (const cmd of commands) {
      this.add(cmd.name);
    }
    this.add("help");
  }

  override has(value: string): boolean {
    this._init();
    return super.has(value);
  }
}

export const RESERVED_COMMANDS = new LazyReservedCommandsSet();

export const ENTRYPOINT_CANDIDATES = [
  "index.ts",
  "src/index.ts",
  "main.ts",
  "src/main.ts",
  "app.ts",
  "src/app.ts",
  "index.js",
  "src/index.js",
  "main.js",
  "src/main.js",
];

export const PYTHON_ENTRYPOINTS = [
  "main.py",
  "app.py",
  "run.py",
  "exp.py",
  "manage.py",
  "src/main.py",
];

export const MARKER_FILES = [
  "package.json",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "pyproject.toml",
  "uv.lock",
  "Pipfile",
  "poetry.lock",
  "requirements.txt",
  ".venv/bin/python",
  "venv/bin/python",
  "go.mod",
  "main.go",
  "Cargo.toml",
  "Makefile",
  ...ENTRYPOINT_CANDIDATES,
  ...PYTHON_ENTRYPOINTS,
];
