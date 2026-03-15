# AGENTS

## Repo contract

- The canonical project config file is `.run.toml`.
- `.run.config.toml` is legacy and should only be touched for migration compatibility.
- Plain `run` means: execute the default profile command and forward remaining args.
- Profiles are explicit: use `run -p <profile>`.
- `run up` mirrors the same contract for managed processes.
- `--` ends CLI parsing and forwards the rest to the child command untouched.

## Required companion updates

When changing CLI semantics, command output, config lookup, or profile behavior, always update these in the same change:

- parser and unit tests
- CLI integration tests
- shell completions
- `README.md`
- `docs/config-reference.md`
- `docs/architecture.md`
- `docs/contributing.md`
- `CLAUDE.md`
- this file

## Implementation guidance

- Keep startup fast and dependencies minimal.
- Prefer explicit behavior over heuristic magic.
- Keep the default banner compact and polished.
- Put richer execution detail behind `--verbose`.
- Reuse the shared command-construction path for foreground runs, managed runs, dry-run output, inspect output, and dashboard-adjacent surfaces.
- Preserve deterministic text output so humans and agents can reason about the CLI cheaply.

## Migration guidance

- If a legacy behavior is removed, prefer a direct guided error over silent fallback when ambiguity could run the wrong command.
- If legacy config is still supported, nudge users toward `.run.toml` with a short contextual hint.
- Avoid long-lived compatibility layers that make the CLI ambiguous.
