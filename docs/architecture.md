# Architecture

## Runtime shape

`run-cli` is a Bun-native CLI with a small TypeScript module graph:

- `src/cli.ts`: command routing and user-facing flows
- `src/config.ts`: TOML parsing, validation, config lookup, and profile resolution
- `src/detect.ts`: project-root detection and suggestion heuristics
- `src/cache.ts`: lightweight JSON cache for config and detection metadata
- `src/exec.ts`: shell-based process execution with signal forwarding
- `src/init.ts`: interactive and non-interactive config creation
- `src/process-registry.ts`: XDG-backed managed process registry
- `src/process-manager.ts`: background process lifecycle operations
- `src/process-metrics.ts`: on-demand pid, memory, and port inspection
- `src/doctor.ts`: diagnostics rendering

The runtime deliberately avoids a heavy CLI framework. Argument parsing is small enough to keep in-repo and keeps startup overhead predictable.

## Resolution flow

Normal `run` execution follows this order:

1. Parse flags and select working directory.
2. Load global defaults.
3. Resolve the nearest `.run.config.toml`, optionally through the positive lookup cache.
4. If config exists, resolve the requested profile and execute it from the config directory.
5. If config does not exist, detect the project root, rank runnable suggestions, and point the user to `run init`.

Only the nearest project config is active. Ancestor project configs are not merged in v1.

Foreground execution remains the fast path. Managed-process features are only loaded when commands such as `run up`, `run ps`, `run inspect`, `run logs`, `run stop`, `run restart`, `run kill`, `run ports`, and `run dashboard` are used.

## Detection heuristics

The detector walks upward until it finds a directory with recognizable project markers. Suggestions are then ranked roughly like this:

1. `package.json` scripts
2. common JS/TS entrypoints
3. Go markers
4. Rust markers
5. Python entrypoints
6. `Makefile`

The detector is allowed to be helpful, but not magical: it suggests commands and seeds `run init`; it does not silently execute inferred commands in v1.

For Python specifically, the detector prefers project-native launch commands in this order:

1. `uv run python ...`
2. `pipenv run python ...`
3. `poetry run python ...`
4. local `.venv/bin/python ...` or `venv/bin/python ...`
5. plain `python ...`

`run` still does not activate or mutate environments on its own. It only suggests the command that should be persisted.

## Cache model

The cache stores only cheap, invalidatable metadata:

- working directory -> resolved config path + fingerprint
- project root -> marker fingerprints + ranked suggestions

There is no negative caching for missing configs, because a new config file can appear at any time and should be picked up immediately.

## Execution model

Commands execute through the selected POSIX shell:

- global config `shell`
- then `$SHELL`
- then `/bin/sh`

Execution uses inherited stdio, forwards common termination signals, and returns the child exit code unchanged. `--dry-run` prints the resolved command and exits without spawning.

## Managed processes

Managed processes are intentionally local and lightweight:

- only processes started by `run up` are tracked
- metadata is stored in XDG state paths
- memory and port details are sampled on demand instead of continuously
- display names default to project name plus profile

The registry stores enough information to support:

- `run ps`
- `run inspect`
- `run logs`
- `run stop`
- `run restart`
- `run kill`
- `run ports`
- `run dashboard`
