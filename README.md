# run-cli

`run-cli` is a Bun-native CLI that gives every project a small, explicit launcher with fast local lookup, named profiles, and smart suggestions when config is missing.

## Why it exists

Jumping between Bun, Node, Python, Go, Rust, and one-off scripts usually means remembering a different command for every repo. `run` keeps the command surface tiny:

- `run` starts the default project command
- `run dev` starts the `dev` profile
- `run up` starts a managed background process
- `run ps` and `run dashboard` show what is running across projects
- `run init` writes a local config from detected project signals
- `run doctor` shows exactly what the CLI resolved and why

The tool is intentionally lightweight:

- Bun runtime
- local `.run.config.toml`
- no runtime dependencies
- small disk cache for config and detection metadata

It also stays explicit:

- detect and suggest, but do not silently manage your runtime environment
- let `run init` choose a detected command or accept a custom one
- keep the final project command in versioned config

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

## Quickstart

Inside a project:

```bash
run init
run
run dev
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
run [profile] [--dry-run] [--no-cache] [--config <path>] [--cwd <path>]
run init [--force] [--yes] [--command <cmd>] [--default-profile <name>] [--profile <name=command>]
run profiles
run up [profile] [--name <name>]
run ps [--json]
run dashboard
run inspect <name|id> [--json]
run logs <name|id> [--lines <n>] [--follow]
run stop <name|id>
run restart <name|id>
run kill <name|id>
run ports [--json]
run config <view|path|edit> [--global]
run doctor
run help
```

### Common flows

Preview what would run:

```bash
run --dry-run
run dev --dry-run
```

Create config without prompts:

```bash
run init --yes
run init --yes --command "python exp.py"
run init --yes --default-profile dev --profile dev="bun run dev"
run init --yes --profile dev="python -m uvicorn app:app --reload"
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
run config edit
run config path --global
```

Manage long-running processes:

```bash
run up
run up dev
run ps
run inspect my-app:dev
run logs my-app:dev --follow
run stop my-app:dev
run dashboard
```

## Config lookup

`run` walks upward from the current directory until it finds the nearest `.run.config.toml`.

That means:

- a monorepo package can have its own config
- a repo root config can serve nested folders
- execution defaults to the directory that contains the config file

Only the nearest project config is used in v1. Ancestor configs are not merged.

Plain `run` resolves the effective default profile for the project.

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
- pid
- uptime
- memory usage
- listening ports
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

## Current scope

- Bun is required to run the CLI.
- v1 targets macOS and Linux shell behavior.
- Windows support is intentionally deferred.
