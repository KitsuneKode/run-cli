# Contributing

## Local setup

```bash
bun install
bun run build
bun test
```

Optional global linking during development:

```bash
bun run link:global
bun run relink:global
```

## Project principles

This repo is intentionally small and explicit.

When contributing, optimize for:

- predictable CLI behavior
- low startup overhead
- minimal dependencies
- deterministic text output
- clear docs that match the real contract

The canonical user contract is:

- `.run.toml` is the project config
- plain `run` executes the default profile command
- profiles are explicit via `-p` / `--profile`
- `--` forwards remaining args to the child command untouched
- `run up` mirrors the same contract for managed processes

## Repo workflow

Quality commands:

```bash
bun run format
bun run lint
bun test
bun run build
bun run check
```

Git hooks are managed with Husky:

- `pre-commit` runs `lint-staged`
- `commit-msg` runs Commitlint

## Expectations for code changes

### CLI semantics

If you change CLI semantics, command output, config lookup, profile behavior, or process UX, update all of these in the same change:

- parser and unit tests
- CLI integration tests
- shell completions
- `README.md`
- `docs/config-reference.md`
- `docs/architecture.md`
- `docs/contributing.md`
- `CLAUDE.md`
- `AGENTS.md`

### Output and diagnostics

Keep the CLI easy for both humans and tools to reason about.

- default output should stay compact
- richer explanation belongs behind explicit flags like `--verbose`
- keep `--dry-run` trustworthy
- preserve machine-readable diagnostics like `run doctor --json`
- document any new `--json` schema fields when you change them
- avoid decorative output that becomes noisy in logs

### Shared execution path

Do not duplicate command assembly logic.

Foreground runs, managed runs, dry-run output, inspect output, and dashboard-adjacent surfaces should all reflect the same resolved command construction path.

### Performance

Protect the cheap path.

- startup should remain fast
- avoid loading expensive subsystems unless needed
- keep overview commands lightweight
- defer expensive process probing and per-process metrics to explicit commands when possible

## Testing guidance

At minimum, validate changes at two layers when behavior is user-facing:

- direct module behavior
- CLI-level behavior through the entrypoint

Examples of things that should usually get tests:

- argument parsing
- config lookup precedence
- profile resolution
- dry-run output
- managed process metadata
- help text or diagnostics when the wording is contract-relevant

## Release expectations

Before a release or tag:

1. `bun run check`
2. `bun run build`
3. confirm `run help` still teaches the current contract clearly
4. confirm `run doctor` and `run doctor --json` still behave deterministically
5. confirm `run config validate` still works on valid configs
6. confirm `bun link` exposes both `run` and `runx`

## Documentation guidance

Prefer first-principles documentation over migration-heavy documentation.

Good docs in this repo should answer:

- what `run` means
- when to use `-p`
- when to use `--`
- what is a built-in subcommand vs a child argument
- where config lives
- which commands are cheap overviews vs expensive detail views

If a contributor has to infer the mental model from code, the docs are incomplete.
