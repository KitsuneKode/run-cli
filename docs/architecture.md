# Architecture

## Runtime shape

`run-cli` is a Bun-native CLI with a small TypeScript module graph:

- `src/cli.ts`: command routing, migration guidance, banners, and user-facing flows
- `src/args.ts`: low-overhead argument parsing with explicit profile flags and passthrough args
- `src/config.ts`: TOML parsing, validation, config lookup, and profile resolution
- `src/command-line.ts`: shared command construction and banner rendering
- `src/detect.ts`: project-root detection and suggestion heuristics
- `src/cache.ts`: lightweight JSON cache for config and detection metadata
- `src/exec.ts`: shell-based process execution with signal forwarding
- `src/init.ts`: interactive and non-interactive config creation
- `src/file-lock.ts`: lockfile-based mutual exclusion for registry writes
- `src/process-registry.ts`: XDG-backed managed process registry with file locking and atomic writes
- `src/process-manager.ts`: background process lifecycle operations with SIGKILL escalation
- `src/process-metrics.ts`: on-demand pid, memory, port inspection, PID reuse detection, and batched metric collection
- `src/doctor.ts`: diagnostics rendering

The runtime deliberately avoids a heavy CLI framework. Argument parsing stays in-repo to keep startup overhead predictable.

## Resolution flow

Normal `run` execution follows this order:

1. Parse flags and select working directory.
2. Load global defaults.
3. Resolve the nearest `.run.toml`, optionally through the positive lookup cache.
4. Fall back to legacy `.run.config.toml` only when `.run.toml` is absent.
5. If config exists, resolve the requested profile and append forwarded args.
6. Print a compact banner, or a full explanation behind `--verbose`.
7. If config does not exist, detect the project root, rank runnable suggestions, and point the user to `run init`.

Only the nearest project config is active. Ancestor project configs are not merged in v1.

Foreground execution remains the fast path. Managed-process features are only loaded when commands such as `run up`, `run ps`, `run inspect`, `run logs`, `run stop`, `run restart`, `run kill`, `run prune`, `run ports`, and `run dashboard` are used.

## CLI model

The active invocation model is intentionally strict:

- `run [args...]` forwards args to the effective default command
- `run -p <profile> [args...]` selects a named profile explicitly
- `run up` mirrors the same contract for managed processes
- `--` ends CLI parsing and forwards all remaining args untouched

This avoids ambiguous positional profile behavior and keeps the launcher predictable.

The README is expected to teach this mental model directly, not just list flags and commands.

## Migration behavior

The CLI includes a small migration layer for trust and clarity:

- if `run dev` matches an existing profile, the CLI fails with a guided message instead of silently treating it as a positional profile
- if legacy `.run.config.toml` is resolved, the CLI nudges the user to rename it to `.run.toml`

Migration hints are intentionally short and contextual.

## Diagnostics surfaces

The CLI keeps both human and agent-facing diagnostics deterministic:

- `run doctor` is the human-readable report
- `run doctor --json` is the machine-readable report
- `run config validate` is the cheapest validation path for config-only checks

The `doctor --json` shape should stay stable enough for tooling to consume without scraping the text report.

## Detection heuristics

The detector walks upward until it finds a directory with recognizable project markers. Suggestions are then ranked roughly like this:

1. `package.json` scripts
2. common JS/TS entrypoints
3. Go markers
4. Rust markers
5. Python entrypoints
6. `Makefile`

The detector is allowed to be helpful, but not magical: it suggests commands and seeds `run init`; it does not silently execute inferred commands.

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

Execution uses inherited stdio, forwards common termination signals, and returns the child exit code unchanged.

`src/command-line.ts` is the single source of truth for:

- appending forwarded args safely
- rendering dry-run output
- rendering the compact startup banner
- keeping foreground and managed execution consistent

## Managed processes

Managed processes are intentionally local and lightweight:

- only processes started by `run up` are tracked
- metadata is stored in XDG state paths
- memory and port details are sampled on demand instead of continuously
- `run ps` and `run dashboard` skip memory and port probing to stay cheap; `run ports` and `run inspect` opt into that extra work
- `run ps --details` is the opt-in richer overview path when the user explicitly wants more than the cheap default
- display names default to project name plus profile
- stored metadata includes both the base command and forwarded args

The registry stores enough information to support:

- `run ps`
- `run inspect`
- `run logs`
- `run stop`
- `run restart`
- `run kill`
- `run prune`
- `run ports`
- `run dashboard`

`run prune` removes all non-running processes from the registry, keeping `run ps` output clean over time.

The dashboard stays compact, while `inspect` exposes the full command context when processes differ only by forwarded args.

## Process safety

The process management layer includes several hardening measures:

- **File locking:** All registry read-modify-write operations are wrapped in a lockfile-based mutex (`src/file-lock.ts`). The lock uses `O_CREAT | O_EXCL` for atomic creation, with stale lock detection and configurable retry. Callers in `process-manager.ts` and `cli.ts` hold the lock across full cycles (e.g., find + modify + upsert) to prevent race conditions between concurrent `run` instances.
- **Atomic writes:** Registry writes go through a temp file + rename pattern to prevent partial writes from corrupting `processes.json`. Corrupted reads emit a warning rather than silently returning an empty registry.
- **Termination escalation:** `terminateProcess` sends SIGTERM, polls for exit (default 2s), escalates to SIGKILL if needed (default 1s), and throws if the process still won't die. Signal delivery uses a TOCTOU-safe wrapper to handle processes that exit between the liveness check and signal.
- **PID reuse detection:** Each managed process stores a `processStartTime` captured from `ps -o lstart=` at spawn time. All liveness checks compare the stored start time against the current process at that PID, preventing false positives when a PID is reused by an unrelated process after reboot.
- **Batched metrics:** `listSnapshots` pre-fetches all process metrics with a single `ps` call and a single `lsof` call (2 forks total), instead of spawning per-process (3N forks). Single-process paths like `getSnapshot` still use per-PID calls since there's no batching benefit.
