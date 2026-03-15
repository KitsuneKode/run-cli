# AGENTS

## Quick orientation

`run-cli` is a Bun-native project launcher and lightweight local process manager. Start here, then read `docs/architecture.md` for depth.

**Key files:** `src/cli.ts` (command routing), `src/process-manager.ts` (process lifecycle), `src/process-registry.ts` (registry + locking), `src/completion.ts` (shell completions), `src/config.ts` (TOML config resolution).

**Commands:** `bun test` (tests), `bun run lint` (biome + markdownlint), `bun run build` (bundle), `bun run check` (all three).

## Repo contract

- Config: `.run.toml` (canonical). `.run.config.toml` is legacy migration only.
- `run [args...]` executes the default profile command, forwarding args.
- `run -p <profile>` selects a named profile. Never positional profile guessing.
- `run up` mirrors the same contract for managed background processes.
- `--` ends CLI parsing; everything after goes to the child command untouched.

## Required companion updates

When changing CLI semantics, command output, config lookup, or profile behavior, always update **all** of these in the same change:

- parser and unit tests
- CLI integration tests
- shell completions (`src/completion.ts` — both zsh and bash)
- `README.md`
- `docs/config-reference.md`, `docs/architecture.md`, `docs/contributing.md`
- `CLAUDE.md` and this file

## Process management internals

When modifying process management code, understand these safety invariants:

- **Locking:** All registry read-modify-write cycles must be wrapped in `registry.withLock()`. The lock is non-reentrant — internal methods (`upsert`, `listSnapshots`, etc.) are unlocked; callers are responsible for acquiring the lock. See `src/file-lock.ts` for the lockfile implementation.
- **Atomic writes:** Registry writes use write-to-temp-then-rename. Do not use `writeTextFile` for the registry.
- **Termination:** Use `terminateProcess()` for process shutdown. It escalates SIGTERM → SIGKILL → error. Use `trySendSignal()` for TOCTOU-safe signal delivery (process may exit between liveness check and signal).
- **PID reuse:** `isProcessRunning(pid, processStartTime?)` accepts an optional start time to detect PID reuse. Always pass `processRecord.processStartTime` when checking liveness of a managed process. Start time is captured from `ps -o lstart=` at spawn.
- **Batched metrics:** `listSnapshots` uses `getBatchMetrics` and `getBatchPorts` (2 forks total for all PIDs). Single-process paths (`getSnapshot`) use per-PID calls. When adding new metrics, add both a per-PID function and a batch variant.
- **Shell completions:** The zsh completion script must NOT call `compinit` — only use `compdef` if available. Use `${(j: :)array}` to join arrays in `_arguments` specs, `${line[1]}` (not `${words[2]}`) for subcommand dispatch after `*::arg:->args`.

## Implementation guidance

- Keep startup fast and dependencies minimal.
- Prefer explicit behavior over heuristic magic.
- Keep the default banner compact; put detail behind `--verbose`.
- Reuse the shared command-construction path (`src/command-line.ts`) for all execution surfaces.
- Preserve deterministic text output so humans and agents can reason about the CLI cheaply.
- When adding diagnostics, keep a stable machine-readable path (`--json`) where practical.
- Keep overview commands (`ps`, `dashboard`) lightweight; defer expensive probing to `inspect` and `ports`.
- Prefer first-principles documentation that teaches the current contract.

## Migration guidance

- Prefer a direct guided error over silent fallback when ambiguity could run the wrong command.
- Nudge users toward `.run.toml` with a short contextual hint.
- Avoid long-lived compatibility layers that make the CLI ambiguous.
