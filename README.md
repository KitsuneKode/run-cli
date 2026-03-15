# run-cli

`run-cli` is a Bun-native launcher that gives each project one small, explicit entrypoint with named profiles, config lookup, light process management, and helpful migration guidance when the contract changes.

## Why it exists

Jumping between Bun, Node, Python, Go, Rust, and one-off scripts usually means remembering a different command surface for every repo. `run` keeps the interface small:

- `run` starts the default project command
- `run -p dev` starts the `dev` profile explicitly
- `run -- --watch` forwards args to the default command
- `run doctor --json` exposes machine-readable diagnostics
- `run ps` and `run dashboard` stay lightweight; memory and port probing are deferred to `run inspect` and `run ports`
- `run up` starts a managed background process
- `run ps` and `run dashboard` show what is running across projects
- `run init` writes a local config from detected project signals
- `run doctor` shows exactly what the CLI resolved and why

The tool is intentionally lightweight:

- Bun runtime
- local `.run.toml`
- no runtime dependencies
- small disk cache for config and detection metadata

It also stays explicit:

- detect and suggest, but do not silently manage your runtime environment
- let `run init` choose a detected command or accept a custom one
- keep the final project command in versioned config
- make profile selection explicit with `-p` instead of positional guessing

## Install

Prerequisite: Bun `>= 1.3.9`

```bash
bun install
bun run build
bun link
```

That exposes:

- `run`
- `runx`

`runx` is the fallback alias if `run` ever collides with something in your shell.

If you update the CLI locally and want to refresh the global link cleanly:

```bash
bun run relink:global
```

### Shell completion

Generate the script directly from the CLI:

```bash
run completion zsh > ~/.config/zsh/run.zsh
run completion bash > ~/.config/bash/run.bash
```

For Zsh, source it the same way you were doing before:

```bash
[[ ! -f ~/.config/zsh/run.zsh ]] || source ~/.config/zsh/run.zsh
```

There are also checked-in loader scripts in `completions/run.zsh` and `completions/run.bash` if you prefer to source those directly.

## Quickstart

Inside a project:

```bash
run init
run
run -p dev
run -- --watch
```

Or create the config directly:

```toml
version = 1
default_profile = "default"

[profiles.default]
command = "bun run index.ts"

[profiles.dev]
command = "bun --hot index.ts"
```

## CLI overview

```text
run [args...] [-p <profile>] [-v] [--dry-run] [--no-cache] [--config <path>] [--cwd <path>]
run init [--force] [--yes] [--command <cmd>] [--default-profile <name>] [--add-profile <name=command>]
run completion <zsh|bash>
run doctor [--json]
run profiles [--json]
run up [args...] [-p <profile>] [--name <name>]
run ps [--json]
run dashboard
run inspect <name|id> [--json]
run logs <name|id> [--lines <n>] [--follow]
run stop <name|id>
run restart <name|id>
run kill <name|id>
run ports [--json]
run config <view|path|edit|validate> [--global]
run help
```

### Common flows

Preview what would run:

```bash
run --dry-run
run -p dev --dry-run
run -- --watch --dry-run
```

Create config without prompts:

```bash
run init --yes
run init --yes --command "python exp.py"
run init --yes --default-profile dev --add-profile dev="bun run dev"
run init --yes --add-profile worker="go run ."
```

Interactive init is designed for ambiguous repos too:

- it lists detected commands with reasons
- you can pick one by number
- or type a custom command directly
- or add extra named profiles before the config is written

Inspect config:

```bash
run config path
run config view
run config validate
run config edit
run config path --global
```

Manage long-running processes:

```bash
run up
run up -p worker -- --port 4000
run ps
run inspect my-app:worker
run logs my-app:worker --follow
run stop my-app:worker
run dashboard
```

## Config lookup

`run` walks upward from the current directory until it finds the nearest `.run.toml`.

Current resolution rules:

- `.run.toml` is preferred
- legacy `.run.config.toml` still resolves for migration compatibility
- execution defaults to the directory that contains the config file

Only the nearest project config is used in v1. Ancestor configs are not merged.

Plain `run` resolves the effective default profile for the project. Profiles are selected explicitly with `run -p <name>`.

## Banner and migration UX

`run` aims to feel polished without adding overhead:

- default execution prints a compact banner with the resolved command
- `-v` / `--verbose` adds profile, cwd, config, and cache details
- `--dry-run` prints the exact final shell command
- migration hints appear only when they help

Examples:

- old `run dev` profile usage now fails with a hint to use `run -p dev`
- legacy `.run.config.toml` usage prints a hint to rename it to `.run.toml`

## Examples

### Bun / TypeScript

```toml
version = 1
default_profile = "dev"

[profiles.default]
command = "bun run src/index.ts"

[profiles.dev]
command = "bun --hot src/index.ts"
```

### Node / JavaScript

```toml
version = 1

[profiles.default]
command = "node index.js"
```

### Python

```toml
version = 1

[profiles.default]
command = "python exp.py"

[profiles.dev]
command = "python -m uvicorn app:app --reload"
```

If project-specific tooling is present, `run init` prefers explicit commands such as:

- `uv run python main.py`
- `pipenv run python main.py`
- `poetry run python main.py`
- `.venv/bin/python main.py`

It suggests those commands, but still lets the user override them before writing config.

### Go

```toml
version = 1

[profiles.default]
command = "go run ."
```

## Managed processes

`run up` stores a lightweight registry for managed processes and exposes:

- project name
- profile
- full command and forwarded args
- pid
- uptime
- memory usage
- listening ports on demand through `run ports` and `run inspect`
- logs
- cwd and config path

This stays intentionally local and lightweight: `run` only manages processes that it starts itself.

## Global config

Global defaults live at:

- `$XDG_CONFIG_HOME/run/config.toml`
- fallback: `~/.config/run/config.toml`

Global config is intentionally limited to defaults such as:

- `shell`
- `editor`
- `cache`
- `detection`

It does not define project commands or profiles.

Example:

```toml
version = 1
shell = "/bin/zsh"
editor = "code -w"
cache = true
detection = "suggest"
```

## Caching

Cache data is written to:

- `$XDG_CACHE_HOME/run/cache.json`
- fallback: `~/.cache/run/cache.json`

The cache stores:

- resolved config paths for known working directories
- detection results for known project roots

Entries are invalidated when the relevant file mtime or size changes. Use `--no-cache` to bypass cache reads and writes.

## Quality workflow

```bash
bun run format
bun run lint
bun test
```

Git hooks:

- `pre-commit`: `lint-staged`
- `commit-msg`: Commitlint with Conventional Commits

## Docs

- `docs/architecture.md`
- `docs/config-reference.md`
- `docs/contributing.md`
- `AGENTS.md`

## Current scope

- Bun is required to run the CLI.
- v1 targets macOS and Linux shell behavior.
- Windows support is intentionally deferred.
