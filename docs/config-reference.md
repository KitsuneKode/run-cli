# Config Reference

## Project config

File name: `.run.config.toml`

Required:

```toml
version = 1
```

### Top-level fields

```toml
version = 1
command = "bun run src/index.ts"
cwd = "."

[env]
NODE_ENV = "production"
PORT = 3000
```

Fields:

- `version`: required integer, currently `1`
- `command`: default command used by `run`
- `cwd`: optional path relative to the config file directory
- `env`: optional table of string, number, or boolean values

### Named profiles

```toml
version = 1
command = "bun run src/index.ts"

[profiles.dev]
command = "bun --hot src/index.ts"

[profiles.worker]
command = "bun run src/worker.ts"
cwd = "services/worker"

[profiles.worker.env]
QUEUE_NAME = "jobs"
DEBUG = true
```

Rules:

- invoke profiles as `run <name>`
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
run init --yes --profile dev="go run ."
```
