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

// Hardcoded set of reserved subcommand names.
// These must stay in sync with the command objects in src/commands/index.ts.
// Using a static Set breaks the circular dependency:
//   constants.ts → commands/index.ts → args.ts → constants.ts
// which caused a Node.js ESM "require is not defined" crash when
// the old LazyReservedCommandsSet used require() to defer the import.
export const RESERVED_COMMANDS = new Set<string>([
  "init",
  "config",
  "completion",
  "doctor",
  "trust",
  "up",
  "ps",
  "dashboard",
  "inspect",
  "logs",
  "stop",
  "restart",
  "kill",
  "prune",
  "ports",
  "profiles",
  "help",
]);

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
