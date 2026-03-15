# Config Reference

## Project config

Preferred file name: `.run.toml`

Legacy file name still supported for migration: `.run.config.toml`

Required:

```toml
version = 1
```

### Top-level fields

```toml
version = 1
default_profile = "default"
command = "bun run src/index.ts"
cwd = "."

[env]
NODE_ENV = "production"
PORT = 3000

[profiles.default]
command = "bun run src/index.ts"
```

Fields:

- `version`: required integer, currently `1`
- `command`: default command used by `run`
- `cwd`: optional path relative to the config file directory
- `env`: optional table of string, number, or boolean values
- `default_profile`: optional profile name used by plain `run`

### Named profiles

```toml
version = 1
default_profile = "dev"

[profiles.default]
command = "bun run src/index.ts"
description = "stable default entrypoint"

[profiles.dev]
command = "bun --hot src/index.ts"
description = "local development server"

[profiles.worker]
command = "bun run src/worker.ts"
cwd = "services/worker"

[profiles.worker.env]
QUEUE_NAME = "jobs"
DEBUG = true
```

Rules:

- plain `run` executes `default_profile` when set
- if `default_profile` is omitted, `profiles.default` or legacy top-level `command` is used
- invoke profiles as `run -p <name>`
- pass runtime args as `run -- <args...>` or `run -p <name> -- <args...>`
- top-level `cwd` and `env` act as defaults for profiles
- profile names cannot be `init`, `config`, `doctor`, or `help`
- only the nearest project config is used

## Global config

Path:

- `$XDG_CONFIG_HOME/run/config.toml`
- fallback `~/.config/run/config.toml`

Example:

```toml
version = 1
shell = "/bin/zsh"
editor = "code -w"
cache = true
detection = "suggest"
```

Fields:

- `version`: optional integer, currently `1`
- `shell`: preferred POSIX shell for command execution
- `editor`: command used by `run config edit`
- `cache`: enables or disables cache reads and writes
- `detection`: currently only `"suggest"`

Global config never defines project commands.

## Init behavior

`run init` tries to detect:

- a default runnable command
- a separate `dev` command when available

During interactive setup it can also:

- list multiple detected commands with reasons
- accept a custom command instead of a detected one
- add custom named profiles in `name=command` form

Non-interactive examples:

```bash
run init --yes
run init --yes --command "python exp.py"
run init --yes --default-profile dev --add-profile dev="bun run dev"
run init --yes --add-profile worker="go run ."
```

Compatibility note:

- `run init --profile name=command` is accepted temporarily as a deprecated alias for `--add-profile`

## Output modes

- default execution prints a compact banner and the resolved command
- `--verbose` / `-v` adds profile, cwd, config path, and cache details
- `--dry-run` prints the exact final shell command without spawning the child process

## Validation and diagnostics

- `run config validate` confirms that the nearest project config parses and resolves
- `run doctor --json` prints a machine-readable resolution report for scripts, editors, and agents

### `run doctor --json` fields

Top-level fields:

- `cwd`: effective working directory
- `configLookup`: resolved config metadata or `null`
- `globalConfigPath`: global config path
- `cacheFilePath`: cache file path
- `shell`: effective shell
- `cacheEnabled`: boolean
- `detectedProject`: detected project metadata or `null`

`configLookup` fields:

- `sourcePath`
- `cacheHit`
- `legacy`

`detectedProject` fields:

- `root`
- `markers`
- `cacheHit`
- `suggestions`

## Managed process commands

Managed processes are started with `run up` and inspected with:

- `run ps`
- `run ps --details`
- `run inspect <name|id>`
- `run logs <name|id>`
- `run stop <name|id>`
- `run restart <name|id>`
- `run kill <name|id>`
- `run prune [--json] [--dry-run]`
- `run ports`
- `run dashboard`

`run up` follows the same profile and arg model as foreground execution:

- `run up`
- `run up -p worker`
- `run up -- --port 4000`

Performance note:

- `run ps` and `run dashboard` avoid memory and port probing by default to keep overview commands lightweight
- `run ps --details` opts into richer overview output while keeping the default `run ps` cheap
- `run prune` removes all dead processes from the registry to keep `run ps` clean
- use `run ports` or `run inspect <name>` when you need listening-port or per-process metric details
