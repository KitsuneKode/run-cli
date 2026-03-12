export const CONFIG_FILE_NAME = ".run.config.toml";
export const GLOBAL_CONFIG_RELATIVE_PATH = "run/config.toml";
export const CACHE_FILE_RELATIVE_PATH = "run/cache.json";
export const CACHE_VERSION = 1;
export const GLOBAL_CONFIG_VERSION = 1;
export const PROJECT_CONFIG_VERSION = 1;
export const FALLBACK_SHELL = "/bin/sh";

export const RESERVED_COMMANDS = new Set(["config", "doctor", "help", "init"]);

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
